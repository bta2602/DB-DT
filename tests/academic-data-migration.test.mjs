import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import {
  academicMigrationKey,
  migrateSqliteAcademic,
} from '../database/migrations/academic-data.mjs';
import { migrateSqliteAcademic as migrateBackendAcademicRules } from '../database/migrations/academic-rules.mjs';

function legacyFixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('./fixtures/academic-legacy.sql', import.meta.url), 'utf8'));
  db.exec(`INSERT INTO auth_users(id,email,name,password_hash,role,created_at) VALUES
    ('teacher','teacher@example.test','Teacher','original-hash','teacher',1),
    ('teacher2','teacher2@example.test','Teacher Two','second-hash','teacher',1),
    ('student','student@example.test','Student','student-hash','student',1);
    INSERT INTO school_groups(id,name,name_key,course,curator_id) VALUES ('group','Group','group',1,'teacher');
    UPDATE auth_users SET group_id='group' WHERE id='student';
    INSERT INTO school_subjects(id,name,name_key) VALUES ('subject','Subject','subject'),('subject2','Subject Two','subject two'),('subject3','Subject Three','subject three'),('subject4','Subject Four','subject four');
    INSERT INTO school_rooms(id,name,name_key,capacity) VALUES ('room','Room','room',30);
    INSERT INTO school_lessons(id,group_id,subject_id,teacher_id,room_id,starts_at,ends_at,kind,status,version)
      VALUES ('historic','group','subject','teacher','room','2026-01-08T03:30:00.000Z','2026-01-08T04:50:00.000Z','Практика','scheduled',5);
    INSERT INTO school_assignments(id,subject_id,group_id,teacher_id,title,type,description,steps_json,due_at)
      VALUES ('old-assignment','subject','group','teacher','Old work','Практика','Keep','[]','2026-01-09T00:00:00Z');
    INSERT INTO school_files(id,name,mime_type,contents,bytes) VALUES ('file','saved.sql','text/plain',X'53454C45435420313B',9);
    INSERT INTO school_submissions(id,assignment_id,student_id,file_id,status,submitted_at,grade,comment,version)
      VALUES ('submission','old-assignment','student','file','reviewed','2026-01-08T10:00:00Z',80,'Keep comment',7);
    INSERT INTO school_grades VALUES ('historic','student',75,'graded',4);
    INSERT INTO school_attendance VALUES ('historic','student','present');
    CREATE INDEX custom_lesson_note ON school_lessons(note);
    CREATE TRIGGER custom_lesson_note_guard BEFORE UPDATE OF note ON school_lessons
      WHEN NEW.note='forbidden' BEGIN SELECT RAISE(ABORT,'Custom guard'); END;`);
  return db;
}

function modernFixture() {
  const db = legacyFixture();
  migrateSqliteAcademic(db);
  db.exec(`UPDATE school_groups SET program='IS',intake_year=2026,language='ru' WHERE id='group';
    UPDATE school_rooms SET number='101',floor=1,type='computer' WHERE id='room';
    INSERT INTO school_teacher_subjects VALUES ('teacher','subject');
    INSERT INTO school_teacher_languages VALUES ('teacher','ru');
    INSERT INTO school_group_subjects VALUES ('group','subject',2026,1);
    INSERT INTO school_teaching_assignments VALUES ('teacher','group','subject');`);
  return db;
}

function lesson(db, changes = {}) {
  const record = {
    id: 'practice',
    group_id: 'group',
    subject_id: 'subject',
    teacher_id: 'teacher',
    room_id: 'room',
    starts_at: '2026-09-07T03:00:00.000Z',
    ends_at: '2026-09-07T03:50:00.000Z',
    kind: 'practice',
    status: 'scheduled',
    practice_id: null,
    slot_id: 'p1',
    academic_year: 2026,
    semester: 1,
    ...changes,
  };
  db.prepare(
    `INSERT INTO school_lessons(${Object.keys(record).join(',')}) VALUES (${Object.keys(record)
      .map(() => '?')
      .join(',')})`,
  ).run(...Object.values(record));
}

test('SQLite migration preserves history, FK targets, custom indexes/triggers and is repeatable', () => {
  const db = legacyFixture();
  try {
    const tables = [
      'auth_users',
      'school_files',
      'school_submissions',
      'school_grades',
      'school_attendance',
    ];
    const before = tables.map((table) => db.prepare(`SELECT * FROM ${table}`).all());
    const oldLesson = db.prepare('SELECT * FROM school_lessons').get();
    assert.deepEqual(migrateSqliteAcademic(db), { migrated: true });
    tables.forEach((table, i) =>
      assert.deepEqual(db.prepare(`SELECT * FROM ${table}`).all(), before[i]),
    );
    const current = db.prepare('SELECT * FROM school_lessons WHERE id=?').get('historic');
    for (const [key, value] of Object.entries(oldLesson)) assert.equal(current[key], value);
    assert.equal(db.prepare('SELECT lesson_id FROM school_assignments').get().lesson_id, null);
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='custom_lesson_note'").get());
    assert.throws(
      () => db.exec("UPDATE school_lessons SET note='forbidden' WHERE id='historic'"),
      /Custom guard/,
    );
    db.exec(
      "UPDATE school_lessons SET note='New note' WHERE id='historic'; UPDATE school_assignments SET title='Updated old title' WHERE id='old-assignment';",
    );
    assert.throws(
      () =>
        db.exec(
          "UPDATE school_lessons SET starts_at='2026-01-08T03:35:00.000Z' WHERE id='historic'",
        ),
      /Academic lesson/,
    );
    assert.deepEqual(migrateSqliteAcademic(db), { migrated: false });
    assert.equal(
      db
        .prepare('SELECT count(*) AS n FROM studyhub_settings WHERE key=?')
        .get(academicMigrationKey).n,
      1,
    );
  } finally {
    db.close();
  }
});

test('Migration failure rolls back columns, lessons replacement and marker, restoring foreign keys', () => {
  const db = legacyFixture();
  try {
    db.exec('CREATE VIEW school_academic_lessons AS SELECT id FROM school_lessons');
    const before = db.prepare('SELECT * FROM school_lessons').all();
    assert.throws(() => migrateSqliteAcademic(db), /already exists/);
    assert.deepEqual(db.prepare('SELECT * FROM school_lessons').all(), before);
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    assert.equal(db.prepare('PRAGMA legacy_alter_table').get().legacy_alter_table, 0);
    assert.equal(
      db
        .prepare('PRAGMA table_info(school_groups)')
        .all()
        .some((row) => row.name === 'program'),
      false,
    );
    assert.equal(
      db
        .prepare('PRAGMA table_info(school_lessons)')
        .all()
        .find((row) => row.name === 'starts_at').notnull,
      1,
    );
    assert.equal(
      db.prepare('SELECT 1 FROM studyhub_settings WHERE key=?').get(academicMigrationKey),
      undefined,
    );
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    db.close();
  }
});

test('Data extension upgrades a backend-migrated database and preserves both migration markers', () => {
  const db = legacyFixture();
  try {
    migrateBackendAcademicRules(db);
    // A database upgraded by the previously released backend has no seed term columns.
    db.exec(
      'ALTER TABLE school_lessons DROP COLUMN academic_year; ALTER TABLE school_lessons DROP COLUMN semester;',
    );
    const before = db.prepare('SELECT * FROM school_lessons').get();
    assert.deepEqual(migrateSqliteAcademic(db), { migrated: true });
    const after = db.prepare('SELECT * FROM school_lessons').get();
    for (const [key, value] of Object.entries(before)) assert.equal(after[key], value);
    assert.equal(after.academic_year, null);
    assert.equal(after.semester, null);
    assert.deepEqual(migrateBackendAcademicRules(db), { migrated: false });
    assert.equal(
      db
        .prepare(
          "SELECT count(*) AS n FROM studyhub_settings WHERE key IN ('academic_rules_v1','academic_data_v1')",
        )
        .get().n,
      2,
    );
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    db.close();
  }
});

test('Backend startup after the data extension does not rebuild or drop seeded lesson fields', () => {
  const db = modernFixture();
  try {
    lesson(db);
    const before = db.prepare('SELECT * FROM school_lessons ORDER BY id').all();
    migrateBackendAcademicRules(db);
    assert.deepEqual(db.prepare('SELECT * FROM school_lessons ORDER BY id').all(), before);
    assert.throws(() => lesson(db, { id: 'overlap' }), /overlaps/);
    assert.equal(
      db
        .prepare(
          "SELECT count(*) AS n FROM studyhub_settings WHERE key IN ('academic_rules_v1','academic_data_v1')",
        )
        .get().n,
      2,
    );
  } finally {
    db.close();
  }
});

test('Academic writes enforce slots, term, qualifications, overlap and lesson-linked assignments', () => {
  const db = modernFixture();
  try {
    for (const patch of [
      { academic_year: null },
      { academic_year: 2025 },
      { kind: 'Практика' },
      { slot_id: null },
      { slot_id: 'p2' },
      { room_id: null },
      { ends_at: '2026-09-07T03:49:00.000Z' },
      { ends_at: 'invalid-time' },
      { teacher_id: 'teacher2' },
      { semester: 2 },
    ])
      assert.throws(() => lesson(db, patch));
    db.exec("INSERT INTO school_group_subjects VALUES ('group','subject',2026,2)");
    assert.throws(() => lesson(db, { semester: 2 }), /academic slot grid/);
    lesson(db);
    assert.throws(() => lesson(db, { id: 'overlap' }), /overlaps/);
    assert.throws(
      () =>
        db.exec(`INSERT INTO school_assignments(id,subject_id,group_id,teacher_id,title,type,description,steps_json,due_at)
      VALUES ('new','subject','group','teacher','New','practice','Text','[]','2026-09-09T00:00:00Z')`),
      /must reference a lesson/,
    );
    assert.throws(
      () =>
        db.exec(`INSERT INTO school_assignments(id,subject_id,group_id,teacher_id,title,type,description,steps_json,due_at,lesson_id)
      VALUES ('new','subject','group','teacher','New','lecture','Text','[]','2026-09-09T00:00:00Z','practice')`),
      /must match/,
    );
    db.exec(`INSERT INTO school_assignments(id,subject_id,group_id,teacher_id,title,type,description,steps_json,due_at,lesson_id)
      VALUES ('new','subject','group','teacher','New','practice','Text','[]','2026-09-09T00:00:00Z','practice')`);
    assert.throws(
      () => db.exec("UPDATE school_lessons SET kind='lecture' WHERE id='practice'"),
      /invalidate its assignments/,
    );
    assert.throws(
      () => db.exec("UPDATE school_assignments SET lesson_id=NULL WHERE id='new'"),
      /must reference/,
    );
  } finally {
    db.close();
  }
});

test('SRSP stores no independent date or slot and follows practice rescheduling', () => {
  const db = modernFixture();
  try {
    lesson(db);
    const srsp = {
      id: 'srsp',
      kind: 'srsp',
      practice_id: 'practice',
      slot_id: null,
      room_id: null,
      starts_at: null,
      ends_at: null,
    };
    assert.throws(() => lesson(db, { ...srsp, practice_id: 'historic' }), /SRSP practice/);
    assert.throws(
      () => lesson(db, { ...srsp, starts_at: '2026-09-07T03:00:00.000Z' }),
      /without booking/,
    );
    lesson(db, srsp);
    assert.equal(
      db.prepare("SELECT date FROM school_academic_lessons WHERE id='srsp'").get().date,
      '2026-09-07',
    );
    db.exec(
      "UPDATE school_lessons SET starts_at='2026-09-08T03:00:00.000Z',ends_at='2026-09-08T03:50:00.000Z' WHERE id='practice'",
    );
    assert.equal(
      db.prepare("SELECT date FROM school_academic_lessons WHERE id='srsp'").get().date,
      '2026-09-08',
    );
    const row = db
      .prepare("SELECT starts_at,ends_at,room_id,slot_id FROM school_lessons WHERE id='srsp'")
      .get();
    assert.deepEqual(Object.values(row), [null, null, null, null]);
    assert.throws(
      () => db.exec("UPDATE school_lessons SET kind='lecture' WHERE id='practice'"),
      /invalidate its SRSP/,
    );
    assert.throws(() => db.exec("DELETE FROM school_lessons WHERE id='practice'"), /FOREIGN KEY/);
  } finally {
    db.close();
  }
});

test('Legacy practice labels and nullable terms support explicit linked work without rewriting history', () => {
  const db = legacyFixture();
  try {
    // The backend already allowed linking canonical assignments to legacy labels.
    migrateBackendAcademicRules(db);
    db.exec(
      "UPDATE school_assignments SET type='practice',lesson_id='historic' WHERE id='old-assignment'",
    );
    migrateSqliteAcademic(db);
    db.exec(`UPDATE school_groups SET program='IS',intake_year=2024,language='ru' WHERE id='group';
      INSERT INTO school_teacher_subjects VALUES ('teacher','subject');
      INSERT INTO school_teacher_languages VALUES ('teacher','ru');
      INSERT INTO school_group_subjects VALUES ('group','subject',2025,2);
      INSERT INTO school_teaching_assignments VALUES ('teacher','group','subject');
      UPDATE school_lessons SET note='Still editable' WHERE id='historic';
      UPDATE school_assignments SET title='Still editable' WHERE id='old-assignment';
      INSERT INTO school_assignments(id,subject_id,group_id,teacher_id,title,type,description,steps_json,due_at,lesson_id)
        VALUES ('new-legacy-work','subject','group','teacher','New','practice','Text','[]','2026-01-09T00:00:00Z','historic');`);
    lesson(db, {
      id: 'legacy-srsp',
      kind: 'srsp',
      practice_id: 'historic',
      slot_id: null,
      room_id: null,
      starts_at: null,
      ends_at: null,
      academic_year: 2025,
      semester: 2,
    });
    assert.equal(
      db.prepare("SELECT date FROM school_academic_lessons WHERE id='legacy-srsp'").get().date,
      '2026-01-08',
    );
    db.exec(
      "UPDATE school_lessons SET note='Cancellation note',status='cancelled' WHERE id='historic'",
    );
    const historic = db.prepare("SELECT * FROM school_lessons WHERE id='historic'").get();
    assert.equal(historic.kind, 'Практика');
    assert.equal(historic.starts_at, '2026-01-08T03:30:00.000Z');
    assert.equal(historic.ends_at, '2026-01-08T04:50:00.000Z');
    assert.equal(historic.academic_year, null);
    assert.equal(historic.semester, null);
    assert.equal(historic.status, 'cancelled');
    assert.throws(
      () => db.exec("UPDATE school_assignments SET type='lecture' WHERE id='new-legacy-work'"),
      /must match/,
    );
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    db.close();
  }
});

test('Teacher profiles and curricula cannot be changed underneath academic lessons', () => {
  const db = modernFixture();
  try {
    lesson(db);
    db.exec(
      "INSERT INTO school_teacher_subjects VALUES ('teacher','subject2'),('teacher','subject3')",
    );
    assert.throws(
      () => db.exec("INSERT INTO school_teacher_subjects VALUES ('teacher','subject4')"),
      /at most three/,
    );
    assert.throws(
      () => db.exec("INSERT INTO school_teacher_languages VALUES ('student','ru')"),
      /teacher account/,
    );
    for (const sql of [
      "DELETE FROM school_teacher_subjects WHERE teacher_id='teacher' AND subject_id='subject'",
      "UPDATE school_teacher_subjects SET teacher_id='teacher2' WHERE teacher_id='teacher' AND subject_id='subject'",
      "UPDATE school_teacher_languages SET language='kk' WHERE teacher_id='teacher'",
      "UPDATE school_group_subjects SET semester=2 WHERE group_id='group'",
      "DELETE FROM school_teaching_assignments WHERE teacher_id='teacher'",
    ])
      assert.throws(() => db.exec(sql), /referenced by an academic lesson/);
    assert.throws(
      () => db.exec("UPDATE school_groups SET language='kk' WHERE id='group'"),
      /invalidate/,
    );
    assert.throws(
      () => db.exec("UPDATE auth_users SET role='student' WHERE id='teacher'"),
      /Teacher role/,
    );
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    db.close();
  }
});
