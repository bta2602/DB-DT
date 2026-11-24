import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { authSchema, schoolSchema, periodMarksSchema } from '../database/schema.mjs';
import {
  migrateSqlitePeriodMarks,
  migratePostgresPeriodMarks,
  periodExamScoreUpgrade,
} from '../database/migrations/period-marks.mjs';
import { validatePeriodMarks } from '../lib/studyhub/period-marks.mjs';
import { main as migrateCommand } from '../scripts/migrate-period-marks.mjs';

const entry = {
  groupId: 'group',
  subjectId: 'subject',
  studentId: 'student',
  academicYear: 2026,
  semester: 1,
  rk1: 0,
  r1: 82.25,
  rk2: 100,
  r2: null,
  version: 0,
};

test('Period marks preserve zero, hundredths and unset scores and validate each independent field', () => {
  assert.deepEqual(validatePeriodMarks(entry), entry);
  assert.equal(validatePeriodMarks({ ...entry, r1: 0.29 }).r1, 0.29);
  for (const field of ['rk1', 'r1', 'rk2', 'r2', 'examScore']) {
    for (const value of [-0.01, 100.01, 70.001, '80', '', undefined, NaN, Infinity, true])
      assert.throws(
        () => validatePeriodMarks({ ...entry, [field]: value }),
        (error) => error.status === 422,
      );
  }
  assert.equal(validatePeriodMarks({ ...entry, examScore: 0 }).examScore, 0);
  assert.equal(validatePeriodMarks({ ...entry, examScore: 99.99 }).examScore, 99.99);
  assert.equal(validatePeriodMarks({ ...entry, examScore: null }).examScore, null);
  for (const value of [-1, 1.1, null, '0'])
    assert.throws(() => validatePeriodMarks({ ...entry, version: value }));
  assert.throws(() => validatePeriodMarks({ ...entry, semester: 3 }));
  assert.throws(() => validatePeriodMarks({ ...entry, academicYear: '2026' }));
  assert.throws(() => validatePeriodMarks({ ...entry, studentId: '' }));
});

test('Legacy SQLite upgrade is additive and repeatable and stores exact hundredths', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(authSchema + schoolSchema);
    db.exec(`CREATE TABLE preserved_history (value TEXT);
      INSERT INTO preserved_history VALUES ('original');
      INSERT INTO auth_users(id,email,name,password_hash,role,created_at)
      VALUES ('student','student@example.test','Student','hash','student',0);
      INSERT INTO school_groups(id,name,name_key,course) VALUES ('group','Group','group',1);
      INSERT INTO school_subjects(id,name,name_key) VALUES ('subject','Subject','subject');`);
    assert.deepEqual(migrateSqlitePeriodMarks(db), { created: true });
    db.prepare(
      `INSERT INTO school_period_marks(group_id,subject_id,student_id,academic_year,semester,rk1,r1,rk2,r2)
      VALUES ('group','subject','student',2026,1,0,8225,10000,NULL)`,
    ).run();
    db.exec('ALTER TABLE school_period_marks DROP COLUMN exam_score');
    assert.deepEqual(migrateSqlitePeriodMarks(db), { created: false });
    assert.equal(db.prepare('SELECT exam_score FROM school_period_marks').get().exam_score, null);
    db.exec('UPDATE school_period_marks SET exam_score=0');
    assert.deepEqual(migrateSqlitePeriodMarks(db), { created: false });
    assert.equal(db.prepare('SELECT exam_score FROM school_period_marks').get().exam_score, 0);
    assert.equal(db.prepare('SELECT value FROM preserved_history').get().value, 'original');
    assert.deepEqual(
      { ...db.prepare('SELECT rk1,r1,rk2,r2,version FROM school_period_marks').get() },
      {
        rk1: 0,
        r1: 8225,
        rk2: 10000,
        r2: null,
        version: 1,
      },
    );
    assert.throws(() => db.prepare('UPDATE school_period_marks SET r1=2.5').run(), /CHECK/);
    assert.throws(() => db.prepare('UPDATE school_period_marks SET rk1=10001').run(), /CHECK/);
    assert.throws(
      () => db.prepare('UPDATE school_period_marks SET exam_score=10001').run(),
      /CHECK/,
    );
  } finally {
    db.close();
  }
});

test('PostgreSQL migration uses the shared schema and commits or rolls back explicitly', async () => {
  const queries = [];
  const client = {
    async query(sql) {
      queries.push(sql);
      return { rows: [{ existing: null }] };
    },
  };
  assert.deepEqual(await migratePostgresPeriodMarks(client), { created: true });
  assert.equal(queries[0], 'BEGIN');
  assert.ok(queries.includes(periodMarksSchema));
  assert.ok(queries.includes(periodExamScoreUpgrade));
  assert.equal(queries.at(-1), 'COMMIT');
  const failure = new Error('migration failure');
  client.query = async (sql) => {
    queries.push(sql);
    if (sql === periodMarksSchema) throw failure;
    return { rows: [{ existing: 'school_period_marks' }] };
  };
  await assert.rejects(migratePostgresPeriodMarks(client), failure);
  assert.equal(queries.at(-1), 'ROLLBACK');
});

test('PostgreSQL migration command rejects missing consent or a mismatched direct host', async () => {
  await assert.rejects(migrateCommand([], {}), /--host/);
  await assert.rejects(
    migrateCommand(['--host', 'qa.example', '--apply'], {}),
    /DATABASE_URL_UNPOOLED/,
  );
  await assert.rejects(
    migrateCommand(['--host', 'qa.example', '--apply'], {
      DIRECT_DATABASE_URL: 'postgresql://test:secret@production.example/test',
    }),
    /совпадающим/,
  );
  await assert.rejects(
    migrateCommand(['--host', 'qa-pooler.example', '--apply'], {
      DIRECT_DATABASE_URL: 'postgresql://test:secret@qa-pooler.example/test',
    }),
    /прямой/,
  );
});
