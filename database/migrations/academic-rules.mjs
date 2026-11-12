import { academicRelationsSchema, lessonsSchema } from '../schema.mjs';

export const academicMigrationKey = 'academic_rules_v1';

const extraColumns = {
  school_groups: {
    program: "TEXT CHECK(program IN ('IS','VTIPO','DS'))",
    intake_year: 'INTEGER CHECK(intake_year BETWEEN 1900 AND 9999)',
    language: "TEXT CHECK(language IN ('kk','ru'))",
  },
  school_rooms: {
    number: 'TEXT',
    floor: 'INTEGER CHECK(floor BETWEEN 1 AND 100)',
    type: "TEXT CHECK(type IN ('computer','lecture','laboratory','ordinary'))",
  },
  school_assignments: {
    lesson_id: 'TEXT REFERENCES school_lessons(id) ON DELETE RESTRICT',
  },
};

const academicIndexes = `
  CREATE INDEX IF NOT EXISTS school_lessons_practice ON school_lessons(practice_id);
  CREATE INDEX IF NOT EXISTS school_assignments_lesson ON school_assignments(lesson_id);
`;

/** Local startup migration. No seed data, permissions or historical records are changed. */
export function migrateSqliteAcademic(db) {
  if (db.isTransaction) {
    throw new Error('Academic migration must run outside an existing transaction.');
  }
  if (db.prepare('SELECT 1 FROM studyhub_settings WHERE key=?').get(academicMigrationKey)) {
    return { migrated: false };
  }
  const foreignKeys = db.prepare('PRAGMA foreign_keys').get().foreign_keys;
  // Rebuilding a referenced parent table requires FK checks off BEFORE the transaction.
  db.exec('PRAGMA foreign_keys=OFF');
  if (db.prepare('PRAGMA foreign_keys').get().foreign_keys !== 0) {
    throw new Error('Academic migration must run outside an existing transaction.');
  }
  try {
    db.exec('BEGIN IMMEDIATE');
    // Another process may have completed the migration while this connection waited.
    if (db.prepare('SELECT 1 FROM studyhub_settings WHERE key=?').get(academicMigrationKey)) {
      db.exec('COMMIT');
      return { migrated: false };
    }
    let migrated = false;
    for (const [table, fields] of Object.entries(extraColumns)) {
      const columns = new Set(
        db
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .map((row) => row.name),
      );
      for (const [name, definition] of Object.entries(fields)) {
        if (columns.has(name)) continue;
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
        migrated = true;
      }
    }

    const columns = db.prepare('PRAGMA table_info(school_lessons)').all();
    const names = new Set(columns.map((row) => row.name));
    const definition = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='school_lessons'")
      .get().sql;
    if (
      !names.has('practice_id') ||
      !names.has('slot_id') ||
      columns.some(
        (row) => ['room_id', 'starts_at', 'ends_at'].includes(row.name) && row.notnull,
      ) ||
      !definition.includes('school_lessons_activity_check')
    ) {
      const targetNames = [
        'id',
        'group_id',
        'subject_id',
        'teacher_id',
        'room_id',
        'starts_at',
        'ends_at',
        'kind',
        'status',
        'note',
        'version',
        'attendance_version',
        'practice_id',
        'slot_id',
      ];
      if (columns.some((row) => !targetNames.includes(row.name))) {
        throw new Error(
          'Unknown lesson columns: review the academic migration before replacing the table.',
        );
      }
      const objects = db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE tbl_name='school_lessons' AND type IN ('index','trigger') AND sql IS NOT NULL",
        )
        .all();
      db.exec(
        lessonsSchema.replace(
          'CREATE TABLE IF NOT EXISTS school_lessons',
          'CREATE TABLE school_lessons_academic',
        ),
      );
      const select = targetNames.map((name) => (names.has(name) ? name : 'NULL')).join(',');
      db.exec(`INSERT INTO school_lessons_academic(${targetNames.join(',')}) SELECT ${select} FROM school_lessons;
        DROP TABLE school_lessons;
        ALTER TABLE school_lessons_academic RENAME TO school_lessons;`);
      for (const object of objects) db.exec(object.sql);
      migrated = true;
    }

    db.exec(academicRelationsSchema + academicIndexes);
    const broken = db.prepare('PRAGMA foreign_key_check').all();
    if (broken.length)
      throw new Error('Academic migration found invalid foreign keys; changes rolled back.');
    db.prepare('INSERT INTO studyhub_settings(key,value) VALUES (?,?)').run(
      academicMigrationKey,
      '1',
    );
    db.exec('COMMIT');
    return { migrated };
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* Keep the original error. */
    }
    throw error;
  } finally {
    db.exec(`PRAGMA foreign_keys=${foreignKeys ? 'ON' : 'OFF'}`);
  }
}

/** Explicit migration using a direct PostgreSQL client, first on an isolated test database. */
export async function migratePostgresAcademic(client) {
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(62846321)');
    const marker = await client.query('SELECT 1 FROM studyhub_settings WHERE key=$1', [
      academicMigrationKey,
    ]);
    if (marker.rows.length) {
      await client.query('COMMIT');
      return { migrated: false };
    }
    for (const [table, fields] of Object.entries(extraColumns)) {
      for (const [name, definition] of Object.entries(fields)) {
        await client.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${name} ${definition}`);
      }
    }
    await client.query(`
      ALTER TABLE school_lessons ADD COLUMN IF NOT EXISTS practice_id TEXT REFERENCES school_lessons(id) ON DELETE RESTRICT;
      ALTER TABLE school_lessons ADD COLUMN IF NOT EXISTS slot_id TEXT;
      ALTER TABLE school_lessons ALTER COLUMN room_id DROP NOT NULL;
      ALTER TABLE school_lessons ALTER COLUMN starts_at DROP NOT NULL;
      ALTER TABLE school_lessons ALTER COLUMN ends_at DROP NOT NULL;
    `);
    const checks = {
      school_lessons_activity_check: `
        (kind='srsp' AND practice_id IS NOT NULL AND practice_id<>id
          AND room_id IS NULL AND starts_at IS NULL AND ends_at IS NULL AND slot_id IS NULL)
        OR (kind<>'srsp' AND practice_id IS NULL AND room_id IS NOT NULL
          AND starts_at IS NOT NULL AND ends_at IS NOT NULL AND ends_at>starts_at)`,
      school_lessons_slot_id_check:
        "slot_id IS NULL OR slot_id IN ('p1','p2','p3','p4','p5','p6','p7','p8','p9','p10','p11','p12')",
    };
    for (const [name, condition] of Object.entries(checks)) {
      const exists = await client.query(
        "SELECT 1 FROM pg_constraint WHERE conrelid='school_lessons'::regclass AND conname=$1",
        [name],
      );
      if (!exists.rows.length) {
        await client.query(`ALTER TABLE school_lessons ADD CONSTRAINT ${name} CHECK(${condition})`);
      }
    }
    await client.query(academicRelationsSchema + academicIndexes);
    await client.query('INSERT INTO studyhub_settings(key,value) VALUES ($1,$2)', [
      academicMigrationKey,
      '1',
    ]);
    await client.query('COMMIT');
    return { migrated: true };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* Keep the original error. */
    }
    throw error;
  }
}
