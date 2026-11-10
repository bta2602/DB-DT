import { randomUUID } from 'node:crypto';
import { mkdir, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backup, DatabaseSync } from 'node:sqlite';
import { Client } from 'pg';
import { closeDatabase, getDatabase, postgresSchema } from '../database/connection.mjs';
import {
  migratePostgresAcademic,
  migrateSqliteAcademic,
} from '../database/migrations/academic-data.mjs';
import { migratePostgresAcademic as migratePostgresAcademicRules } from '../database/migrations/academic-rules.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

export function parseAcademicTarget(args) {
  if (args.length === 3 && args[0] === '--sqlite-dir' && args[2] === '--apply') {
    if (!isAbsolute(args[1])) throw new Error('--sqlite-dir должен быть абсолютным путём.');
    return { dialect: 'sqlite', directory: resolve(args[1]) };
  }
  if (
    args.length === 4 &&
    args[0] === '--postgres' &&
    args[1] === '--host' &&
    args[3] === '--apply'
  ) {
    const connectionString = process.env.STUDYHUB_ACADEMIC_TEST_DATABASE_URL;
    let url;
    try {
      url = new URL(connectionString);
    } catch {
      throw new Error('Задайте отдельную тестовую базу в STUDYHUB_ACADEMIC_TEST_DATABASE_URL.');
    }
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      url.hostname !== args[2] ||
      url.hostname.includes('-pooler.')
    ) {
      throw new Error('Нужен прямой PostgreSQL URL с хостом, совпадающим с --host.');
    }
    return { dialect: 'postgres', connectionString };
  }
  throw new Error(
    'Укажите --sqlite-dir <абсолютный каталог тестовой базы> --apply или --postgres --host <тестовый прямой хост> --apply.',
  );
}

function outside(parent, child) {
  const path = relative(parent, child);
  return path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path);
}

// These commands deliberately never load .env.local or fall back to DATABASE_URL.
export async function prepareAcademicDatabase(target) {
  if (target.dialect === 'sqlite') {
    if (!outside(resolve(root), target.directory)) {
      throw new Error('Тестовую базу и приватные пароли нужно хранить вне репозитория.');
    }
    await mkdir(target.directory, { recursive: true, mode: 0o700 });
    target.directory = await realpath(target.directory);
    if (!outside(await realpath(root), target.directory)) {
      throw new Error('Каталог через ссылку ведёт внутрь репозитория.');
    }
    const filename = resolve(target.directory, 'auth.sqlite');
    if (existsSync(filename)) {
      const backupDirectory = resolve(target.directory, 'backups');
      await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
      const backupFile = resolve(backupDirectory, `before-academic-${randomUUID()}.sqlite`);
      const reader = new DatabaseSync(filename, { readOnly: true });
      try {
        await backup(reader, backupFile);
      } finally {
        reader.close();
      }
      console.log(`Резервная копия: ${backupFile}`);
    }
    process.env.DATABASE_URL = '';
    process.env.STUDYHUB_DATA_DIR = target.directory;
    // Bootstrap only the existing base schema; the academic migration is explicit below.
    await getDatabase();
    await closeDatabase();
    const sqlite = new DatabaseSync(filename);
    try {
      sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
      return migrateSqliteAcademic(sqlite);
    } finally {
      sqlite.close();
    }
  }
  const client = new Client({
    connectionString: target.connectionString,
    connectionTimeoutMillis: 15000,
  });
  try {
    await client.connect();
    const { rows } = await client.query("SELECT to_regclass('auth_users') AS existing");
    if (!rows[0].existing) {
      await client.query('BEGIN');
      try {
        await client.query(postgresSchema);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    await migratePostgresAcademicRules(client);
    const result = await migratePostgresAcademic(client);
    process.env.DATABASE_URL = target.connectionString;
    return result;
  } finally {
    await client.end();
  }
}

export function reportAcademicError(error) {
  const message = String(error instanceof Error ? error.message : error).replace(
    /postgres(?:ql)?:\/\/[^\s"']+/gi,
    '[database URL]',
  );
  console.error(message);
  process.exitCode = 1;
}
