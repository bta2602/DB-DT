import { refreshPostgresArchiveTriggers, refreshSqliteArchiveTriggers } from './academic-data.mjs';

export const lessonArchiveMigrationKey = 'lesson_archive_v1';

// A nullable timestamp keeps existing lessons visible. No rows or links are removed.
export const lessonArchiveIndexes = `
  CREATE INDEX IF NOT EXISTS school_lessons_visible_time
    ON school_lessons(starts_at,ends_at) WHERE archived_at IS NULL AND status='scheduled';
  CREATE INDEX IF NOT EXISTS school_lessons_visible_practice
    ON school_lessons(practice_id) WHERE archived_at IS NULL;
`;

export function migrateSqliteLessonArchive(db) {
  if (db.isTransaction) throw new Error('Lesson archive migration requires its own transaction.');
  db.exec('BEGIN IMMEDIATE');
  try {
    const columns = db.prepare('PRAGMA table_info(school_lessons)').all();
    if (!columns.length) throw new Error('Run the base StudyHUB migrations first.');
    const exists = columns.some((column) => column.name === 'archived_at');
    const marker = db
      .prepare('SELECT 1 FROM studyhub_settings WHERE key=?')
      .get(lessonArchiveMigrationKey);
    if (marker) {
      if (!exists) throw new Error('Lesson archive marker does not match the schema.');
      db.exec('COMMIT');
      return { migrated: false };
    }
    if (!exists) db.exec('ALTER TABLE school_lessons ADD COLUMN archived_at TEXT');
    db.exec(lessonArchiveIndexes);
    if (db.prepare("SELECT 1 FROM studyhub_settings WHERE key='academic_data_v1'").get()) {
      refreshSqliteArchiveTriggers(db);
    }
    if (db.prepare('PRAGMA foreign_key_check').all().length) {
      throw new Error('Foreign key check failed; lesson archive migration rolled back.');
    }
    db.prepare('INSERT INTO studyhub_settings(key,value) VALUES (?,?)').run(
      lessonArchiveMigrationKey,
      '1',
    );
    db.exec('COMMIT');
    return { migrated: true };
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* Preserve the original failure. */
    }
    throw error;
  }
}

// Explicit maintenance command only. Application startup never changes PostgreSQL schema.
export async function migratePostgresLessonArchive(client) {
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout='10s'");
    await client.query('SELECT pg_advisory_xact_lock(62846321)');
    await client.query('LOCK TABLE school_lessons, school_assignments IN ACCESS EXCLUSIVE MODE');
    const marker = await client.query('SELECT 1 FROM studyhub_settings WHERE key=$1', [
      lessonArchiveMigrationKey,
    ]);
    if (marker.rows.length) {
      const columns = await client.query(
        "SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='school_lessons' AND column_name='archived_at'",
      );
      if (!columns.rows.length) throw new Error('Lesson archive marker does not match the schema.');
      await client.query('COMMIT');
      return { migrated: false };
    }
    await client.query('ALTER TABLE school_lessons ADD COLUMN IF NOT EXISTS archived_at TEXT');
    await client.query(lessonArchiveIndexes);
    const academic = await client.query(
      "SELECT 1 FROM studyhub_settings WHERE key='academic_data_v1'",
    );
    if (academic.rows.length) await refreshPostgresArchiveTriggers(client);
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    await client.query('INSERT INTO studyhub_settings(key,value) VALUES ($1,$2)', [
      lessonArchiveMigrationKey,
      '1',
    ]);
    await client.query('COMMIT');
    return { migrated: true };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* Preserve the original failure. */
    }
    throw error;
  }
}
