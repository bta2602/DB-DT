import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync, chmodSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { authSchema, schoolSchema, learningSchema } from './schema.mjs';
import { migrateSqliteGrading } from './migrations/grading-100.mjs';
import { migrateSqliteAcademic as migrateSqliteAcademicRules } from './migrations/academic-rules.mjs';
import { migrateSqliteEveningSlots } from './migrations/evening-slots.mjs';

// Deliberate entry points for maintenance commands; neither runs on connection.
export { migrateSqliteAcademic, migratePostgresAcademic } from './migrations/academic-data.mjs';

// Next.js can load server modules more than once; keep one pool per database/process.
const runtimeKey = Symbol.for('studyhub.database.runtime');
const runtime = (globalThis[runtimeKey] ||= {
  connections: new Map(),
  activeTransaction: new AsyncLocalStorage(),
});
const { connections, activeTransaction } = runtime;

// Log only error classes; SQL, credentials, cookies and user data never enter this object.
export function databaseErrorInfo(error) {
  const message = error instanceof Error ? error.message : '';
  return {
    name: error instanceof Error ? error.name : 'UnknownError',
    code:
      typeof error?.code === 'string' && /^[A-Z0-9_]{1,60}$/i.test(error.code)
        ? error.code
        : 'UNKNOWN',
    reason: /connection.*timeout|timeout.*connection/i.test(message)
      ? 'connection_timeout'
      : /timeout|timed out/i.test(message)
        ? 'timeout'
        : /connection terminated|connection ended|socket|ECONN/i.test(message)
          ? 'connection_closed'
          : 'other',
  };
}

// Existing SQL uses ? parameters. Convert only placeholders outside quoted values.
export function postgresSql(sql) {
  let parameter = 0;
  return sql
    .replace(/'(''|[^'])*'|"(""|[^"])*"|(\?)/g, (token, _single, _double, placeholder) =>
      placeholder ? `$${++parameter}` : token,
    )
    .replace(/\bAS\s+([a-z][a-zA-Z]*[A-Z][a-zA-Z]*)\b/g, 'AS "$1"');
}

export const postgresSchema = [
  authSchema
    .replace(/PRAGMA[^;]*;/g, '')
    .replace(/created_at INTEGER/g, 'created_at BIGINT')
    .replace(/expires_at INTEGER/g, 'expires_at BIGINT')
    .replace(/resets_at INTEGER/g, 'resets_at BIGINT'),
  schoolSchema,
  'ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS group_id TEXT REFERENCES school_groups(id);',
  learningSchema.replace(/\bBLOB\b/g, 'BYTEA').replace(/created_at INTEGER/g, 'created_at BIGINT'),
].join('\n');

function normalizeError(error) {
  const codes = {
    23505: 'SQLITE_CONSTRAINT_UNIQUE',
    23503: 'SQLITE_CONSTRAINT_FOREIGNKEY',
    23514: 'SQLITE_CONSTRAINT_CHECK',
    23502: 'SQLITE_CONSTRAINT_NOTNULL',
  };
  if (codes[error.code]) {
    error.postgresCode = error.code;
    error.code = codes[error.code];
  }
  return error;
}

function wrapper(dialect, query, exec, key) {
  return {
    dialect,
    key,
    exec,
    prepare(sql) {
      const run = async (args) => {
        try {
          return await query(
            sql,
            args.map((value) => (value instanceof Uint8Array ? Buffer.from(value) : value)),
          );
        } catch (error) {
          throw normalizeError(error);
        }
      };
      return {
        async all(...args) {
          return (await run(args)).rows;
        },
        async get(...args) {
          return (await run(args)).rows[0];
        },
        async run(...args) {
          const result = await run(args);
          return { changes: result.rowCount };
        },
      };
    },
  };
}

function serialQueue() {
  let previous = Promise.resolve();
  return async (action) => {
    const ready = previous;
    let release;
    previous = new Promise((resolve) => {
      release = resolve;
    });
    await ready;
    try {
      return await action();
    } finally {
      release();
    }
  };
}

async function connect(key) {
  if (process.env.DATABASE_URL) {
    const { Pool } = await import('pg');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 3,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 15000,
      allowExitOnIdle: true,
    });
    // pg removes the idle client itself; handling the event keeps the server alive.
    pool.on('error', (error) =>
      console.error('[StudyHUB DB] Idle connection failed:', databaseErrorInfo(error)),
    );
    const db = wrapper(
      'postgres',
      (sql, args) => pool.query(postgresSql(sql), args),
      (sql) => pool.query(sql),
      key,
    );
    db.transaction = async (action) => {
      const client = await pool.connect();
      let discardClient = false;
      const tx = wrapper(
        'postgres',
        (sql, args) => client.query(postgresSql(sql), args),
        (sql) => client.query(sql),
        key,
      );
      try {
        await client.query('BEGIN');
        // Serializes the small application's writes, including version and schedule checks.
        await client.query('SELECT pg_advisory_xact_lock(62846321)');
        const result = await activeTransaction.run(tx, () => action(tx));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Keep the original error and remove the broken connection from the pool.
          discardClient = true;
        }
        throw normalizeError(error);
      } finally {
        client.release(discardClient);
      }
    };
    db.close = () => pool.end();
    return db;
  }
  if (process.env.VERCEL) throw new Error('DATABASE_URL is required on Vercel.');
  const directory = resolve(
    /* turbopackIgnore: true */ process.env.STUDYHUB_DATA_DIR || '.studyhub',
  );
  if (process.env.STUDYHUB_DEMO_MODE === 'true' && !process.env.STUDYHUB_DATA_DIR)
    throw Object.assign(
      new Error('An explicit STUDYHUB_DATA_DIR is required for local sample data.'),
      { code: 'DEMO_STORAGE_REQUIRED', status: 503 },
    );
  const publicRelative = relative(resolve('public'), directory);
  if (!(
    publicRelative === '..' ||
    publicRelative.startsWith(`..${sep}`) ||
    isAbsolute(publicRelative)
  ))
    throw new Error('Database must stay outside public.');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const { DatabaseSync } = await import('node:sqlite');
  const filename = resolve(directory, 'auth.sqlite');
  const sqlite = new DatabaseSync(filename);
  sqlite.exec(authSchema + schoolSchema);
  const columns = sqlite.prepare('PRAGMA table_info(auth_users)').all();
  if (!columns.some((row) => row.name === 'group_id'))
    sqlite.exec('ALTER TABLE auth_users ADD COLUMN group_id TEXT REFERENCES school_groups(id)');
  if (!columns.some((row) => row.name === 'is_demo'))
    sqlite.exec(
      'ALTER TABLE auth_users ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0 CHECK(is_demo IN (0,1))',
    );
  sqlite.exec(learningSchema);
  migrateSqliteGrading(sqlite);
  migrateSqliteAcademicRules(sqlite);
  migrateSqliteEveningSlots(sqlite);
  chmodSync(filename, 0o600);
  const queue = serialQueue();
  const query = (sql, args) => {
    const statement = sqlite.prepare(sql);
    if (statement.columns().length) {
      const rows = statement.all(...args);
      return { rows, rowCount: rows.length };
    }
    const result = statement.run(...args);
    return { rows: [], rowCount: Number(result.changes) };
  };
  const execute = (action) =>
    activeTransaction.getStore()?.key === key ? Promise.resolve(action()) : queue(action);
  const db = wrapper(
    'sqlite',
    (sql, args) => execute(() => query(sql, args)),
    (sql) => execute(() => sqlite.exec(sql)),
    key,
  );
  db.transaction = (action) =>
    queue(async () => {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const result = await activeTransaction.run(db, () => action(db));
        sqlite.exec('COMMIT');
        return result;
      } catch (error) {
        try {
          sqlite.exec('ROLLBACK');
        } catch {
          // A failed rollback must not hide the error that interrupted the write.
        }
        throw error;
      }
    });
  db.close = async () => {
    sqlite.close();
  };
  return db;
}

export async function getDatabase() {
  if (activeTransaction.getStore()) return activeTransaction.getStore();
  const key =
    process.env.DATABASE_URL ||
    resolve(/* turbopackIgnore: true */ process.env.STUDYHUB_DATA_DIR || '.studyhub');
  if (!connections.has(key))
    connections.set(
      key,
      connect(key).catch((error) => {
        connections.delete(key);
        throw error;
      }),
    );
  return connections.get(key);
}
export async function runTransaction(action) {
  const current = activeTransaction.getStore();
  if (current) return action(current);
  return (await getDatabase()).transaction(action);
}
export async function closeDatabase() {
  for (const connection of connections.values()) await (await connection).close();
  connections.clear();
}
