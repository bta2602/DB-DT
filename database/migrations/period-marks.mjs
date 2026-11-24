import { periodMarksSchema, periodExamScoreColumn } from '../schema.mjs';

export const periodExamScoreUpgrade = `ALTER TABLE school_period_marks ADD COLUMN IF NOT EXISTS ${periodExamScoreColumn}`;

export function migrateSqlitePeriodMarks(db) {
  if (db.isTransaction) throw new Error('Period mark migration requires its own transaction.');
  db.exec('BEGIN IMMEDIATE');
  try {
    const existed = Boolean(
      db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='school_period_marks'")
        .get(),
    );
    db.exec(periodMarksSchema);
    if (
      !db
        .prepare('PRAGMA table_info(school_period_marks)')
        .all()
        .some((column) => column.name === 'exam_score')
    )
      db.exec(`ALTER TABLE school_period_marks ADD COLUMN ${periodExamScoreColumn}`);
    db.exec('COMMIT');
    return { created: !existed };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** PostgreSQL upgrades run only through an explicit maintenance command. */
export async function migratePostgresPeriodMarks(client) {
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout='10s'");
    await client.query('SELECT pg_advisory_xact_lock(62846321)');
    const existed = await client.query("SELECT to_regclass('school_period_marks') AS existing");
    await client.query(periodMarksSchema);
    await client.query(periodExamScoreUpgrade);
    await client.query('COMMIT');
    return { created: !existed.rows[0].existing };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}
