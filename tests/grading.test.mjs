import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import {
  authSchema,
  schoolSchema,
  learningSchema,
  gradesSchema,
  submissionsSchema,
} from '../database/schema.mjs';
import { migrateSqliteGrading, gradingMigrationKey } from '../database/migrations/grading-100.mjs';
import { validateGradeInput, validateReviewInput } from '../lib/studyhub/policy.mjs';
import { createDemoData } from '../database/seeds/demo-data.mjs';
import { createMoreDemoData } from '../database/seeds/demo-more-data.mjs';
import { createCampusData } from '../database/seeds/campus-data.mjs';

function fixture(legacy) {
  const db = new DatabaseSync(':memory:');
  db.exec(authSchema + schoolSchema);
  db.exec('ALTER TABLE auth_users ADD COLUMN group_id TEXT REFERENCES school_groups(id)');
  const oldGrades = `CREATE TABLE school_grades (
    lesson_id TEXT NOT NULL REFERENCES school_lessons(id),student_id TEXT NOT NULL REFERENCES auth_users(id),
    grade INTEGER CHECK(grade IN (2,3,4,5)),version INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(lesson_id,student_id));`;
  const oldSubmissions = submissionsSchema.replace(
    'grade INTEGER CONSTRAINT school_submissions_grade_check CHECK(grade BETWEEN 0 AND 100 AND grade = CAST(grade AS INTEGER))',
    'grade INTEGER CHECK(grade IN (2,3,4,5))',
  );
  db.exec(
    legacy
      ? learningSchema.replace(gradesSchema, oldGrades).replace(submissionsSchema, oldSubmissions)
      : learningSchema,
  );
  db.exec(`INSERT INTO auth_users(id,email,name,password_hash,role,created_at) VALUES
    ('teacher','teacher@example.test','Teacher','hash','teacher',1),
    ('student','student@example.test','Student','hash','student',1);
    INSERT INTO school_groups(id,name,name_key,course,curator_id) VALUES ('group','Group','group',1,'teacher');
    UPDATE auth_users SET group_id='group' WHERE id='student';
    INSERT INTO school_subjects(id,name,name_key) VALUES ('subject','Subject','subject');
    INSERT INTO school_rooms(id,name,name_key,capacity) VALUES ('room','Room','room',20);
    INSERT INTO school_files(id,name,mime_type,contents,bytes) VALUES ('file','saved.sql','text/plain',X'53454C45435420313B',9);`);
  for (const id of ['2', '3', '4', '5', 'null', 'absent', 'excused']) {
    db.prepare(
      "INSERT INTO school_lessons(id,group_id,subject_id,teacher_id,room_id,starts_at,ends_at,kind,status) VALUES (?,'group','subject','teacher','room','2026-01-01T08:30:00Z','2026-01-01T09:50:00Z','Practice','scheduled')",
    ).run(id);
  }
  return db;
}

test('Legacy SQLite grades and submissions migrate once, retaining files and attendance', () => {
  const db = fixture(true);
  try {
    for (const grade of [2, 3, 4, 5]) {
      db.prepare("INSERT INTO school_grades VALUES (?,'student',?,4)").run(String(grade), grade);
      db.prepare(
        "INSERT INTO school_assignments(id,subject_id,group_id,teacher_id,title,type,description,steps_json,due_at) VALUES (?,'subject','group','teacher','Task','Practice','Text','[]','2026-01-02T00:00:00Z')",
      ).run(String(grade));
      db.prepare(
        "INSERT INTO school_submissions(id,assignment_id,student_id,file_id,status,submitted_at,grade,comment,version) VALUES (?,?,'student','file','reviewed','2026-01-01T10:00:00Z',?,'Keep this comment',6)",
      ).run(String(grade), String(grade), grade);
    }
    db.exec(`INSERT INTO school_grades VALUES ('null','student',NULL,3);
      INSERT INTO school_attendance VALUES ('2','student','absent'),('null','student','excused'),('absent','student','absent'),('excused','student','excused');`);
    const attendance = db.prepare('SELECT * FROM school_attendance ORDER BY lesson_id').all();
    const file = db.prepare('SELECT * FROM school_files').get();
    assert.deepEqual(migrateSqliteGrading(db), { migrated: true });
    const grades = db.prepare('SELECT * FROM school_grades ORDER BY lesson_id').all();
    for (const grade of [2, 3, 4, 5]) {
      const row = grades.find((row) => row.lesson_id === String(grade));
      assert.equal(row.grade, grade * 20);
      assert.equal(row.status, 'graded');
      assert.equal(row.version, 5);
      const work = db.prepare('SELECT * FROM school_submissions WHERE id=?').get(String(grade));
      assert.equal(work.grade, grade * 20);
      assert.equal(work.version, 7);
      assert.equal(work.comment, 'Keep this comment');
      assert.equal(work.file_id, 'file');
    }
    assert.equal(grades.find((row) => row.lesson_id === 'null').status, 'absent');
    assert.equal(grades.find((row) => row.lesson_id === 'null').version, 4);
    assert.equal(grades.find((row) => row.lesson_id === 'absent').status, 'absent');
    assert.equal(grades.find((row) => row.lesson_id === 'excused').status, 'absent');
    assert.deepEqual(
      db.prepare('SELECT * FROM school_attendance ORDER BY lesson_id').all(),
      attendance,
    );
    assert.deepEqual(db.prepare('SELECT * FROM school_files').get(), file);
    const works = db.prepare('SELECT * FROM school_submissions ORDER BY id').all();
    assert.deepEqual(migrateSqliteGrading(db), { migrated: false });
    assert.deepEqual(db.prepare('SELECT * FROM school_grades ORDER BY lesson_id').all(), grades);
    assert.deepEqual(db.prepare('SELECT * FROM school_submissions ORDER BY id').all(), works);
    assert.equal(
      db.prepare('SELECT value FROM studyhub_settings WHERE key=?').get(gradingMigrationKey).value,
      '100',
    );
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    db.close();
  }
});

test('A fresh database keeps valid low grades and enforces grade/status constraints', () => {
  const db = fixture(false);
  try {
    db.exec(
      "INSERT INTO school_grades(lesson_id,student_id,grade,status) VALUES ('2','student',2,'graded'),('3','student',0,'graded'),('4','student',100,'graded')",
    );
    assert.deepEqual(migrateSqliteGrading(db), { migrated: false });
    assert.deepEqual(
      db
        .prepare('SELECT grade FROM school_grades ORDER BY lesson_id')
        .all()
        .map((row) => row.grade),
      [2, 0, 100],
    );
    for (const [grade, status] of [
      [101, 'graded'],
      [-1, 'graded'],
      [2.5, 'graded'],
      [null, 'graded'],
      [0, 'absent'],
      [null, 'unknown'],
    ]) {
      assert.throws(() =>
        db
          .prepare(
            "INSERT INTO school_grades(lesson_id,student_id,grade,status) VALUES ('5','student',?,?)",
          )
          .run(grade, status),
      );
    }
  } finally {
    db.close();
  }
});

test('Grade and review validation accepts 0/100, statuses and legacy inputs without coercion', () => {
  for (const grade of [0, 1, 50, 100]) {
    assert.deepEqual(validateGradeInput({ grade, version: null }), {
      grade,
      status: 'graded',
      version: null,
    });
    assert.equal(
      validateReviewInput({ action: 'grade', grade, version: 1, comment: '' }).grade,
      grade,
    );
  }
  for (const status of ['absent', 'not_required', 'unmarked']) {
    assert.deepEqual(validateGradeInput({ grade: null, status, version: 2 }), {
      grade: null,
      status,
      version: 2,
    });
    assert.throws(() => validateGradeInput({ grade: 0, status, version: 2 }));
  }
  assert.equal(validateGradeInput({ grade: null, version: 1 }).status, 'unmarked');
  for (const grade of [-1, 101, 0.5, NaN, Infinity, '50', undefined]) {
    assert.throws(() => validateGradeInput({ grade, status: 'graded', version: 1 }));
    assert.throws(() => validateReviewInput({ action: 'grade', grade, version: 1, comment: '' }));
  }
  for (const status of ['unknown', null])
    assert.throws(() => validateGradeInput({ grade: 50, status, version: 1 }));
  assert.throws(() => validateGradeInput({ grade: 50, status: 'graded', version: -1 }));
});

test('Every new seed uses the 100 point scale and treats absence separately from not required', () => {
  const now = new Date('2026-11-03T06:00:00Z');
  const base = createDemoData(now);
  const snapshots = [base, createMoreDemoData(now, base.data), createCampusData(now, base.data)];
  for (const { data } of snapshots) {
    assert.ok(data.grades.some((row) => row.status === 'graded'));
    assert.ok(data.grades.some((row) => row.status === 'absent'));
    for (const row of data.grades) {
      if (row.status === 'graded') assert.ok([40, 60, 80, 100].includes(row.grade));
      else {
        assert.equal(row.grade, null);
        assert.equal(row.status, 'absent');
      }
    }
    for (const row of data.submissions) {
      if (row.grade !== null) assert.ok([40, 60, 80, 100].includes(row.grade));
    }
  }
});
