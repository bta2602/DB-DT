import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { authSchema, schoolSchema, learningSchema } from '../database/schema.mjs';
import {
  migrateSqliteAcademic,
  refreshSqliteLessonTriggers,
} from '../database/migrations/academic-data.mjs';
import {
  migrateSqliteLessonArchive,
  migratePostgresLessonArchive,
  lessonArchiveMigrationKey,
} from '../database/migrations/lesson-archive.mjs';
import { parseArchiveTarget } from '../scripts/migrate-lesson-archive.mjs';

function fixture(academic = false) {
  const db = new DatabaseSync(':memory:');
  db.exec(authSchema + schoolSchema.replace(/^\s*archived_at TEXT,\r?\n/m, ''));
  db.exec('ALTER TABLE auth_users ADD COLUMN group_id TEXT REFERENCES school_groups(id)');
  db.exec(learningSchema);
  db.exec(`INSERT INTO auth_users(id,email,name,password_hash,role,created_at) VALUES
    ('teacher','teacher@example.test','Teacher','preserved-hash','teacher',1),
    ('student','student@example.test','Student','preserved-student-hash','student',1);
    INSERT INTO school_groups(id,name,name_key,course,program,intake_year,language)
      VALUES ('group','IS-26Б','is-26б',1,'IS',2026,'ru');
    UPDATE auth_users SET group_id='group' WHERE id='student';
    INSERT INTO school_subjects(id,name,name_key) VALUES ('subject','Math','math');
    INSERT INTO school_rooms(id,name,name_key,capacity) VALUES ('room','101','101',30);
    INSERT INTO school_teacher_subjects VALUES ('teacher','subject');
    INSERT INTO school_teacher_languages VALUES ('teacher','ru');
    INSERT INTO school_group_subjects VALUES ('group','subject',2026,1);
    INSERT INTO school_teaching_assignments VALUES ('teacher','group','subject');
    INSERT INTO school_lessons(id,group_id,subject_id,teacher_id,room_id,starts_at,ends_at,kind,status,slot_id,academic_year,semester)
      VALUES ('practice','group','subject','teacher','room','2026-11-17T03:00:00.000Z','2026-11-17T03:50:00.000Z','practice','scheduled','p1',2026,1);
    INSERT INTO school_lessons(id,group_id,subject_id,teacher_id,kind,status,practice_id,academic_year,semester)
      VALUES ('srsp','group','subject','teacher','srsp','scheduled','practice',2026,1);
    INSERT INTO school_assignments(id,subject_id,group_id,teacher_id,title,type,description,steps_json,due_at,lesson_id)
      VALUES ('work','subject','group','teacher','Work','practice','Keep description','[]','2026-11-18T03:00:00.000Z','practice');
    INSERT INTO school_files(id,name,mime_type,contents,bytes) VALUES ('file','answer.txt','text/plain',X'7361766564',5);
    INSERT INTO school_submissions(id,assignment_id,student_id,file_id,status,submitted_at,grade,comment,version)
      VALUES ('submission','work','student','file','reviewed','2026-11-17T06:00:00.000Z',87,'Keep comment',3);
    INSERT INTO school_grades VALUES ('practice','student',92,'graded',2);
    INSERT INTO school_attendance VALUES ('practice','student','present');
    CREATE INDEX custom_lesson_note ON school_lessons(note);
    CREATE TRIGGER custom_lesson_note_guard BEFORE UPDATE OF note ON school_lessons
      WHEN NEW.note='forbidden' BEGIN SELECT RAISE(ABORT,'custom guard'); END;`);
  if (academic) {
    migrateSqliteAcademic(db);
    // Recreate the deployed pre-archive shape and its old overlap rules.
    for (const name of [
      'academic_lesson_insert',
      'academic_lesson_update',
      'academic_assignment_insert',
      'academic_assignment_update',
    ])
      db.exec(`DROP TRIGGER ${name}`);
    db.exec('ALTER TABLE school_lessons DROP COLUMN archived_at');
    refreshSqliteLessonTriggers(db);
  }
  return db;
}

const relatedTables = [
  'auth_users',
  'school_assignments',
  'school_files',
  'school_submissions',
  'school_grades',
  'school_attendance',
];

for (const academic of [false, true])
  test(`archive migration preserves rows, links and custom objects (${academic ? 'academic' : 'basic'})`, () => {
    const db = fixture(academic);
    try {
      const before = relatedTables.map((table) => db.prepare(`SELECT * FROM ${table}`).all());
      const lessons = db.prepare('SELECT * FROM school_lessons ORDER BY id').all();
      assert.deepEqual(migrateSqliteLessonArchive(db), { migrated: true });
      relatedTables.forEach((table, index) =>
        assert.deepEqual(db.prepare(`SELECT * FROM ${table}`).all(), before[index]),
      );
      const after = db.prepare('SELECT * FROM school_lessons ORDER BY id').all();
      for (let index = 0; index < lessons.length; index++) {
        assert.equal(after[index].archived_at, null);
        for (const [key, value] of Object.entries(lessons[index]))
          assert.deepEqual(after[index][key], value);
      }
      assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='custom_lesson_note'").get());
      assert.throws(
        () => db.exec("UPDATE school_lessons SET note='forbidden' WHERE id='practice'"),
        /custom guard/,
      );
      assert.deepEqual(migrateSqliteLessonArchive(db), { migrated: false });
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
      assert.equal(
        db
          .prepare('SELECT count(*) AS total FROM studyhub_settings WHERE key=?')
          .get(lessonArchiveMigrationKey).total,
        1,
      );
    } finally {
      db.close();
    }
  });

test('hidden lessons release bookings, keep learning records and reject new references', () => {
  const db = fixture(true);
  try {
    migrateSqliteLessonArchive(db);
    const before = relatedTables.map((table) => db.prepare(`SELECT * FROM ${table}`).all());
    const replacement = `INSERT INTO school_lessons(id,group_id,subject_id,teacher_id,room_id,starts_at,ends_at,kind,status,slot_id,academic_year,semester)
      VALUES ('replacement','group','subject','teacher','room','2026-11-17T03:00:00.000Z','2026-11-17T03:50:00.000Z','lecture','scheduled','p1',2026,1)`;
    assert.throws(() => db.exec(replacement), /overlaps/);
    db.exec(
      "BEGIN; UPDATE school_lessons SET archived_at='2026-11-17T04:00:00.000Z',version=version+1 WHERE id IN ('practice','srsp'); COMMIT;",
    );
    db.exec(replacement);
    assert.throws(
      () => db.exec("UPDATE school_lessons SET archived_at=NULL WHERE id='practice'"),
      /overlaps/,
    );
    assert.throws(
      () =>
        db.exec(`INSERT INTO school_lessons(id,group_id,subject_id,teacher_id,kind,status,practice_id,academic_year,semester)
      VALUES ('new-srsp','group','subject','teacher','srsp','scheduled','practice',2026,1)`),
      /SRSP practice/,
    );
    // A caller cannot bypass parent validation by inserting the new SRSP as hidden.
    assert.throws(
      () =>
        db.exec(`INSERT INTO school_lessons(id,group_id,subject_id,teacher_id,kind,status,practice_id,academic_year,semester,archived_at)
      VALUES ('hidden-new-srsp','group','subject','teacher','srsp','scheduled','practice',2026,1,'2026-11-17T05:00:00.000Z')`),
      /SRSP practice/,
    );
    assert.throws(
      () =>
        db.exec(`INSERT INTO school_assignments(id,subject_id,group_id,teacher_id,title,type,description,steps_json,due_at,lesson_id)
      VALUES ('new-work','subject','group','teacher','New work','practice','','[]','2026-11-18T03:00:00.000Z','practice')`),
      /Assignment type/,
    );
    relatedTables.forEach((table, index) =>
      assert.deepEqual(db.prepare(`SELECT * FROM ${table}`).all(), before[index]),
    );
    // Existing submitted work remains editable/reviewable without changing its lesson link.
    db.exec(
      "UPDATE school_assignments SET title='Corrected title' WHERE id='work'; UPDATE school_submissions SET grade=88,version=version+1 WHERE id='submission';",
    );
    assert.equal(
      db.prepare("SELECT grade FROM school_submissions WHERE id='submission'").get().grade,
      88,
    );
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    db.close();
  }
});

test('archive migration does not roll back a caller transaction', () => {
  const db = fixture();
  try {
    db.exec('BEGIN');
    assert.throws(() => migrateSqliteLessonArchive(db), /own transaction/);
    assert.equal(db.isTransaction, true);
    db.exec('ROLLBACK');
  } finally {
    db.close();
  }
});

test('failed SQLite integrity check rolls back its new column, indexes and marker', () => {
  const db = fixture();
  try {
    db.exec(
      "PRAGMA foreign_keys=OFF; UPDATE school_attendance SET student_id='missing'; PRAGMA foreign_keys=ON;",
    );
    const before = db.prepare('SELECT * FROM school_lessons ORDER BY id').all();
    assert.throws(() => migrateSqliteLessonArchive(db), /Foreign key check/);
    assert.deepEqual(db.prepare('SELECT * FROM school_lessons ORDER BY id').all(), before);
    assert.equal(
      db
        .prepare('PRAGMA table_info(school_lessons)')
        .all()
        .some((column) => column.name === 'archived_at'),
      false,
    );
    assert.equal(
      db.prepare('SELECT 1 FROM studyhub_settings WHERE key=?').get(lessonArchiveMigrationKey),
      undefined,
    );
    assert.equal(
      db.prepare("SELECT 1 FROM sqlite_master WHERE name='school_lessons_visible_time'").get(),
      undefined,
    );
    assert.equal(db.isTransaction, false);
  } finally {
    db.close();
  }
});

test('PostgreSQL migration emits additive transactional DDL and rolls back failures (recording adapter)', async () => {
  const queries = [];
  const client = {
    async query(sql, args) {
      queries.push({ sql, args });
      if (sql.includes("key='academic_data_v1'")) return { rows: [{}] };
      return { rows: [] };
    },
  };
  assert.deepEqual(await migratePostgresLessonArchive(client), { migrated: true });
  assert.equal(queries[0].sql, 'BEGIN');
  assert.equal(queries.at(-1).sql, 'COMMIT');
  assert.ok(
    queries.findIndex(({ sql }) => sql.includes('SET LOCAL lock_timeout')) <
      queries.findIndex(({ sql }) => sql.includes('pg_advisory_xact_lock')),
  );
  assert.ok(queries.some(({ sql }) => sql.includes('ADD COLUMN IF NOT EXISTS archived_at TEXT')));
  assert.ok(
    queries.some(({ sql }) => sql.includes('l.archived_at IS NULL') && sql.includes('overlaps')),
  );
  assert.equal(
    queries.some(({ sql }) => /DELETE FROM|TRUNCATE|DROP TABLE/i.test(sql)),
    false,
  );
  const failed = [];
  await assert.rejects(
    migratePostgresLessonArchive({
      async query(sql) {
        failed.push(sql);
        if (sql.startsWith('ALTER TABLE')) throw new Error('DDL failure');
        return { rows: [] };
      },
    }),
    /DDL failure/,
  );
  assert.equal(failed.at(-1), 'ROLLBACK');
  assert.equal(failed.includes('COMMIT'), false);
});

test('archive CLI requires explicit direct host and never falls back to runtime DATABASE_URL', () => {
  const direct = 'postgresql://tester:private@qa.example/studyhub';
  assert.throws(() => parseArchiveTarget([], {}), /Команда/);
  assert.throws(
    () => parseArchiveTarget(['--host', 'qa.example', '--apply'], { DATABASE_URL: direct }),
    /прямое подключение/,
  );
  assert.throws(
    () =>
      parseArchiveTarget(['--host', 'production.example', '--apply'], {
        DIRECT_DATABASE_URL: direct,
      }),
    /совпадающим/,
  );
  assert.throws(
    () =>
      parseArchiveTarget(['--host', 'qa-pooler.example', '--apply'], {
        DIRECT_DATABASE_URL: direct.replace('qa.example', 'qa-pooler.example'),
      }),
    /прямой PostgreSQL/,
  );
  assert.equal(
    parseArchiveTarget(['--host', 'qa.example', '--apply'], { DIRECT_DATABASE_URL: direct })
      .connectionString,
    direct,
  );
});
