import { gradesSchema, submissionsSchema, learningSchema } from '../schema.mjs';

export const gradingMigrationKey = 'grading_scale_v2';

// История посещаемости остаётся на месте. Числовая оценка имеет приоритет.
const attendanceMarks = `
  INSERT INTO school_grades(lesson_id,student_id,grade,status)
  SELECT lesson_id,student_id,NULL,'absent'
  FROM school_attendance WHERE status IN ('absent','excused')
  ON CONFLICT(lesson_id,student_id) DO UPDATE SET
    status=excluded.status,version=school_grades.version+1
  WHERE school_grades.grade IS NULL AND school_grades.status <> excluded.status;
`;

/** Automatic migration for local SQLite databases; never opens a remote database. */
export function migrateSqliteGrading(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    if (db.prepare('SELECT 1 FROM studyhub_settings WHERE key=?').get(gradingMigrationKey)) {
      db.exec('COMMIT');
      return { migrated: false };
    }
    const legacy = !db
      .prepare('PRAGMA table_info(school_grades)')
      .all()
      .some((row) => row.name === 'status');
    if (legacy) {
      // SQLite cannot replace a CHECK constraint, so rebuild only these two child tables.
      db.exec(gradesSchema.replaceAll('school_grades', 'school_grades_100'));
      db.exec(`INSERT INTO school_grades_100(lesson_id,student_id,grade,status,version)
        SELECT lesson_id,student_id,grade * 20,
          CASE WHEN grade IS NULL THEN 'unmarked' ELSE 'graded' END,
          version + CASE WHEN grade IS NULL THEN 0 ELSE 1 END
        FROM school_grades;
        DROP TABLE school_grades;
        ALTER TABLE school_grades_100 RENAME TO school_grades;`);
      db.exec(submissionsSchema.replaceAll('school_submissions', 'school_submissions_100'));
      db.exec(`INSERT INTO school_submissions_100(id,assignment_id,student_id,file_id,status,submitted_at,grade,comment,version)
        SELECT id,assignment_id,student_id,file_id,status,submitted_at,grade * 20,comment,
          version + CASE WHEN grade IS NULL THEN 0 ELSE 1 END
        FROM school_submissions;
        DROP TABLE school_submissions;
        ALTER TABLE school_submissions_100 RENAME TO school_submissions;`);
      db.exec(attendanceMarks);
      // Recreate the indexes belonging to the replaced tables.
      db.exec(learningSchema);
    }
    db.prepare('INSERT INTO studyhub_settings(key,value) VALUES (?,?)').run(
      gradingMigrationKey,
      '100',
    );
    db.exec('COMMIT');
    return { migrated: legacy };
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* Keep the original migration error. */
    }
    throw error;
  }
}

/** Run explicitly with a direct PostgreSQL client, first on an isolated QA branch. */
export async function migratePostgresGrading(client) {
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(62846321)');
    const marker = await client.query('SELECT 1 FROM studyhub_settings WHERE key=$1', [
      gradingMigrationKey,
    ]);
    if (marker.rows.length) {
      await client.query('COMMIT');
      return { migrated: false };
    }
    const column = await client.query(
      "SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='school_grades' AND column_name='status'",
    );
    const legacy = column.rows.length === 0;
    if (legacy) {
      await client.query(`
        ALTER TABLE school_grades DROP CONSTRAINT IF EXISTS school_grades_grade_check;
        ALTER TABLE school_submissions DROP CONSTRAINT IF EXISTS school_submissions_grade_check;
        ALTER TABLE school_grades ADD COLUMN status TEXT NOT NULL DEFAULT 'unmarked';
        UPDATE school_grades SET grade=grade*20,status='graded',version=version+1 WHERE grade IS NOT NULL;
        UPDATE school_submissions SET grade=grade*20,version=version+1 WHERE grade IS NOT NULL;
        ${attendanceMarks}
        ALTER TABLE school_grades ADD CONSTRAINT school_grades_status_check
          CHECK(status IN ('graded','not_required','absent','unmarked'));
        ALTER TABLE school_grades ADD CONSTRAINT school_grades_grade_check CHECK(
          (status='graded' AND grade IS NOT NULL AND grade BETWEEN 0 AND 100)
          OR (status<>'graded' AND grade IS NULL)
        );
        ALTER TABLE school_submissions ADD CONSTRAINT school_submissions_grade_check CHECK(grade BETWEEN 0 AND 100);
      `);
    }
    await client.query('INSERT INTO studyhub_settings(key,value) VALUES ($1,$2)', [
      gradingMigrationKey,
      '100',
    ]);
    await client.query('COMMIT');
    return { migrated: legacy };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* Keep the original migration error. */
    }
    throw error;
  }
}
