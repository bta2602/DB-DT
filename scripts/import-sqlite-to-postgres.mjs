import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { closeDatabase, getDatabase, postgresSchema } from '../database/connection.mjs';
import { academicSeedMapSchema } from '../database/schema.mjs';
import {
  academicMigrationKey,
  installPostgresAcademicDataObjects,
} from '../database/migrations/academic-data.mjs';

const markerKey = 'sqlite_import_v1';
const batchRows = 500;
const batchBytes = 4 * 1024 * 1024;
const importedTables = [
  'auth_users',
  'school_groups',
  'school_subjects',
  'school_rooms',
  'school_teacher_subjects',
  'school_teacher_languages',
  'school_group_subjects',
  'school_teaching_assignments',
  'school_lessons',
  'school_files',
  'school_assignments',
  'school_submissions',
  'school_grades',
  'school_attendance',
  'school_materials',
  'school_announcements',
  'school_demo_seeds',
  'studyhub_settings',
];
const temporaryTables = ['auth_sessions', 'auth_limits'];
// Backend-only databases do not have the explicit academic data extension yet.
const optionalTables = ['school_academic_seed_map'];
const allTables = [...importedTables, ...optionalTables, ...temporaryTables];

function snapshotTableNames(tables) {
  return [...importedTables, ...optionalTables.filter((name) => tables[name])];
}

class ImportError extends Error {}

function identifier(name) {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    throw new ImportError('В исходной схеме найдено неподдерживаемое имя столбца.');
  }
  return `"${name}"`;
}

function normalizedValue(value, column) {
  if (value === null) return null;
  if (/INT/i.test(column.type)) {
    const number = Number(value);
    if (!Number.isSafeInteger(number)) {
      throw new ImportError('Числовое значение выходит за допустимый диапазон.');
    }
    return number;
  }
  if (/BLOB/i.test(column.type)) {
    if (!(value instanceof Uint8Array)) {
      throw new ImportError('Двоичное содержимое файла не прошло проверку.');
    }
    return { base64: Buffer.from(value).toString('base64') };
  }
  return value;
}

function tableHash(rows, columns) {
  const values = rows.map((row) =>
    JSON.stringify(columns.map((column) => normalizedValue(row[column.name], column))),
  );
  // JavaScript sorting gives SQLite and PostgreSQL the same order regardless of locale.
  values.sort();
  const hash = createHash('sha256');
  hash.update(JSON.stringify(columns.map((column) => column.name)) + '\n');
  for (const row of values) hash.update(row + '\n');
  return hash.digest('hex');
}

function manifest(tables) {
  const counts = {};
  const hashes = {};
  for (const name of snapshotTableNames(tables)) {
    counts[name] = tables[name].rows.length;
    hashes[name] = tableHash(tables[name].rows, tables[name].columns);
  }
  return {
    version: 1,
    snapshotHash: createHash('sha256').update(JSON.stringify(hashes)).digest('hex'),
    counts,
    hashes,
  };
}

export async function readSqliteSnapshot(filename) {
  if (!isAbsolute(filename) || !(await stat(filename)).isFile()) {
    throw new ImportError('--source должен содержать абсолютный путь к файлу SQLite.');
  }
  const source = new DatabaseSync(filename, { readOnly: true });
  try {
    source.exec('PRAGMA query_only = ON; BEGIN;');
    const check = source.prepare('PRAGMA quick_check').all();
    if (check.length !== 1 || Object.values(check[0])[0] !== 'ok') {
      throw new ImportError('Исходная SQLite-база не прошла проверку целостности.');
    }
    if (source.prepare('PRAGMA foreign_key_check').all().length) {
      throw new ImportError('В исходной базе нарушены связи между записями.');
    }
    const names = source
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((row) => row.name);
    if (
      names.some((name) => !allTables.includes(name)) ||
      [...importedTables, ...temporaryTables].some((name) => !names.includes(name))
    ) {
      throw new ImportError('Состав таблиц исходной базы не соответствует текущей схеме StudyHUB.');
    }
    const tables = {};
    for (const name of [
      ...importedTables,
      ...optionalTables.filter((name) => names.includes(name)),
    ]) {
      const columns = source.prepare(`PRAGMA table_info(${identifier(name)})`).all();
      const selected = columns.map((column) => identifier(column.name)).join(',');
      tables[name] = {
        columns,
        rows: source.prepare(`SELECT ${selected} FROM ${identifier(name)}`).all(),
      };
    }
    if (!tables.school_grades.columns.some((column) => column.name === 'status')) {
      throw new ImportError(
        'Сначала обновите рабочую копию SQLite текущей версией приложения до шкалы 0–100. Исходную резервную копию сохраните; порядок описан в database/README.md.',
      );
    }
    if (tables.studyhub_settings.rows.some((row) => row.key === markerKey)) {
      throw new ImportError('В исходной базе уже есть служебный маркер облачного переноса.');
    }
    if (
      tables.studyhub_settings.rows.some((row) => row.key === academicMigrationKey) &&
      (!tables.school_academic_seed_map ||
        ['academic_year', 'semester'].some(
          (name) => !tables.school_lessons.columns.some((column) => column.name === name),
        ))
    ) {
      throw new ImportError('Маркер академической миграции не соответствует исходной схеме.');
    }
    const skipped = Object.fromEntries(
      temporaryTables.map((name) => [
        name,
        source.prepare(`SELECT count(*) AS count FROM ${identifier(name)}`).get().count,
      ]),
    );
    source.exec('COMMIT;');
    return { tables, manifest: manifest(tables), skipped };
  } finally {
    source.close();
  }
}

function* batches(rows, columns) {
  let batch = [];
  let bytes = 0;
  for (const row of rows) {
    const size = columns.reduce((total, column) => {
      const value = row[column.name];
      return total + (value instanceof Uint8Array ? value.byteLength : String(value).length * 2);
    }, 0);
    if (batch.length && (batch.length >= batchRows || bytes + size > batchBytes)) {
      yield batch;
      batch = [];
      bytes = 0;
    }
    batch.push(row);
    bytes += size;
  }
  if (batch.length) yield batch;
}

async function insertTable(db, name, table) {
  const columns = table.columns.map((column) => column.name);
  // Insert parent practices before linked SRSP records, including across batches.
  const orderedRows =
    name === 'school_lessons'
      ? [
          ...table.rows.filter((row) => row.kind !== 'srsp'),
          ...table.rows.filter((row) => row.kind === 'srsp'),
        ]
      : table.rows;
  for (const rows of batches(orderedRows, table.columns)) {
    const values = rows.flatMap((row) =>
      columns.map((column) =>
        name === 'auth_users' && column === 'group_id' ? null : row[column],
      ),
    );
    const placeholders = rows.map(() => `(${columns.map(() => '?').join(',')})`).join(',');
    await db
      .prepare(
        `INSERT INTO ${identifier(name)} (${columns.map(identifier).join(',')}) VALUES ${placeholders}`,
      )
      .run(...values);
  }
}

async function restoreUserGroups(db, rows) {
  const users = rows.filter((row) => row.group_id !== null);
  for (let offset = 0; offset < users.length; offset += batchRows) {
    const batch = users.slice(offset, offset + batchRows);
    const cases = batch.map(() => 'WHEN ? THEN ?').join(' ');
    await db
      .prepare(
        `UPDATE auth_users SET group_id=CASE id ${cases} END WHERE id IN (${batch.map(() => '?').join(',')})`,
      )
      .run(...batch.flatMap((row) => [row.id, row.group_id]), ...batch.map((row) => row.id));
  }
}

async function rowCounts(db) {
  const counts = {};
  for (const name of allTables) {
    counts[name] = Number(
      (await db.prepare(`SELECT count(*) AS count FROM ${identifier(name)}`).get()).count,
    );
  }
  return counts;
}

async function verifyTarget(db, snapshot) {
  const tables = {};
  for (const name of snapshotTableNames(snapshot.tables)) {
    const columns = snapshot.tables[name].columns;
    const selected = columns.map((column) => identifier(column.name)).join(',');
    const filter = name === 'studyhub_settings' ? ' WHERE key<>?' : '';
    tables[name] = {
      columns,
      rows: await db
        .prepare(`SELECT ${selected} FROM ${identifier(name)}${filter}`)
        .all(...(filter ? [markerKey] : [])),
    };
  }
  const target = manifest(tables);
  if (
    target.snapshotHash !== snapshot.manifest.snapshotHash ||
    JSON.stringify(target.counts) !== JSON.stringify(snapshot.manifest.counts)
  ) {
    throw new ImportError('Число или содержимое целевых записей отличается от исходного снимка.');
  }
  for (const name of optionalTables.filter((name) => !snapshot.tables[name])) {
    if (
      Number((await db.prepare(`SELECT count(*) AS count FROM ${identifier(name)}`).get()).count)
    ) {
      throw new ImportError(
        'В целевой базе появились академические данные, отсутствующие в снимке.',
      );
    }
  }
}

export async function importSqliteSnapshot(db, snapshot) {
  if (db.dialect !== 'postgres') {
    throw new ImportError('Для переноса необходима PostgreSQL-база в DATABASE_URL.');
  }
  // CREATE IF NOT EXISTS adds schema objects; it never clears existing records.
  await db.exec(postgresSchema);
  return db.transaction(async (tx) => {
    await tx.exec(academicSeedMapSchema);
    const marker = await tx
      .prepare('SELECT value FROM studyhub_settings WHERE key=?')
      .get(markerKey);
    if (marker) {
      let previous;
      try {
        previous = JSON.parse(marker.value);
      } catch {
        throw new ImportError('Служебный маркер переноса повреждён; повторный импорт отклонён.');
      }
      if (JSON.stringify(previous) !== JSON.stringify(snapshot.manifest)) {
        throw new ImportError('Эта база уже получила другой снимок; повторный импорт отклонён.');
      }
      await verifyTarget(tx, snapshot);
      return { imported: false, counts: await rowCounts(tx), skipped: snapshot.skipped };
    }

    const initialCounts = await rowCounts(tx);
    if (Object.values(initialCounts).some((count) => count !== 0)) {
      throw new ImportError('Целевая база не пуста; перенос без точного маркера запрещён.');
    }
    // A previously initialized but empty backend schema may predate the data extension.
    // Add its nullable lesson fields only after verifying that this target is empty.
    await tx.exec(`
      ALTER TABLE school_lessons ADD COLUMN IF NOT EXISTS academic_year INTEGER CHECK(academic_year BETWEEN 1900 AND 9999);
      ALTER TABLE school_lessons ADD COLUMN IF NOT EXISTS semester INTEGER CHECK(semester IN (1,2));
    `);
    for (const name of snapshotTableNames(snapshot.tables)) {
      await insertTable(tx, name, snapshot.tables[name]);
      if (name === 'school_groups') await restoreUserGroups(tx, snapshot.tables.auth_users.rows);
    }
    await verifyTarget(tx, snapshot);
    // Copy historical rows before enabling write-time rules; a copied migration marker
    // must never stand in for the views and triggers it describes on the source database.
    if (snapshot.tables.studyhub_settings.rows.some((row) => row.key === academicMigrationKey)) {
      await installPostgresAcademicDataObjects({ query: (sql) => tx.exec(sql) });
    }
    await tx
      .prepare('INSERT INTO studyhub_settings(key,value) VALUES (?,?)')
      .run(markerKey, JSON.stringify(snapshot.manifest));
    const counts = await rowCounts(tx);
    if (temporaryTables.some((name) => counts[name] !== 0)) {
      throw new ImportError(
        'Облачные сессии и ограничения входа должны начинаться с пустых таблиц.',
      );
    }
    return { imported: true, counts, skipped: snapshot.skipped };
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--source' || !isAbsolute(args[1])) {
    throw new ImportError(
      'Использование: node --env-file-if-exists=.env.local scripts/import-sqlite-to-postgres.mjs --source <абсолютный путь к SQLite>',
    );
  }
  if (!process.env.DATABASE_URL) {
    throw new ImportError('Задайте DATABASE_URL для целевой PostgreSQL-базы.');
  }
  const snapshot = await readSqliteSnapshot(args[1]);
  const result = await importSqliteSnapshot(await getDatabase(), snapshot);
  console.log(
    result.imported ? 'Перенос завершён.' : 'Этот снимок уже перенесён; записи не изменены.',
  );
  console.log(JSON.stringify({ ...result, snapshotHash: snapshot.manifest.snapshotHash }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    // Driver messages may contain email addresses, file names or connection details.
    console.error(
      error instanceof ImportError
        ? error.message
        : 'Перенос не завершён. Данные транзакции отменены; исходная SQLite-база не изменена.',
    );
    process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
}
