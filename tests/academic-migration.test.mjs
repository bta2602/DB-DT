import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authSchema, schoolSchema, learningSchema } from '../database/schema.mjs';
import {
  academicMigrationKey,
  migrateSqliteAcademic,
} from '../database/migrations/academic-rules.mjs';
import { readSqliteSnapshot } from '../scripts/import-sqlite-to-postgres.mjs';

// The pre-academic schema, retained independently from the new table definitions.
const legacySchema = `
  CREATE TABLE school_groups (
    id TEXT PRIMARY KEY,name TEXT NOT NULL,name_key TEXT NOT NULL UNIQUE,
    course INTEGER NOT NULL,curator_id TEXT REFERENCES auth_users(id),version INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE school_subjects (
    id TEXT PRIMARY KEY,name TEXT NOT NULL,name_key TEXT NOT NULL UNIQUE,version INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE school_rooms (
    id TEXT PRIMARY KEY,name TEXT NOT NULL,name_key TEXT NOT NULL UNIQUE,
    capacity INTEGER,version INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE school_lessons (
    id TEXT PRIMARY KEY,group_id TEXT NOT NULL REFERENCES school_groups(id),
    subject_id TEXT NOT NULL REFERENCES school_subjects(id),teacher_id TEXT NOT NULL REFERENCES auth_users(id),
    room_id TEXT NOT NULL REFERENCES school_rooms(id),starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL CHECK(ends_at>starts_at),kind TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('scheduled','cancelled')),note TEXT NOT NULL DEFAULT '',
    version INTEGER NOT NULL DEFAULT 1,attendance_version INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE school_assignments (
    id TEXT PRIMARY KEY,subject_id TEXT NOT NULL REFERENCES school_subjects(id),
    group_id TEXT NOT NULL REFERENCES school_groups(id),teacher_id TEXT NOT NULL REFERENCES auth_users(id),
    title TEXT NOT NULL,type TEXT NOT NULL,description TEXT NOT NULL,steps_json TEXT NOT NULL,
    due_at TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1);
`;

function fixture(legacy = true) {
  const db = new DatabaseSync(':memory:');
  db.exec(authSchema);
  if (legacy) db.exec(legacySchema);
  db.exec(schoolSchema);
  db.exec('ALTER TABLE auth_users ADD COLUMN group_id TEXT REFERENCES school_groups(id)');
  db.exec(learningSchema);
  db.exec(`
    INSERT INTO auth_users(id,email,name,password_hash,role,created_at) VALUES
      ('teacher','teacher@example.test','Teacher','keep-password-hash','teacher',1),
      ('student','student@example.test','Student','keep-student-hash','student',1);
    INSERT INTO school_groups(id,name,name_key,course,curator_id) VALUES ('group','Old group','old group',3,'teacher');
    UPDATE auth_users SET group_id='group' WHERE id='student';
    INSERT INTO school_subjects(id,name,name_key) VALUES ('subject','Subject','subject');
    INSERT INTO school_rooms(id,name,name_key,capacity) VALUES ('room','Old room','old room',24);
    INSERT INTO school_lessons(id,group_id,subject_id,teacher_id,room_id,starts_at,ends_at,kind,status,note,version)
      VALUES ('lesson','group','subject','teacher','room','2026-01-01T08:30:00Z','2026-01-01T09:50:00Z','Old practice','scheduled','Keep note',4);
    INSERT INTO school_assignments(id,subject_id,group_id,teacher_id,title,type,description,steps_json,due_at)
      VALUES ('assignment','subject','group','teacher','Saved task','Old type','Keep task','[]','2026-01-05T10:00:00Z');
    INSERT INTO school_files(id,name,mime_type,contents,bytes) VALUES ('file','answer.sql','text/plain',X'53454C45435420313B',9);
    INSERT INTO school_submissions(id,assignment_id,student_id,file_id,status,submitted_at,grade,comment)
      VALUES ('submission','assignment','student','file','reviewed','2026-01-04T10:00:00Z',80,'Keep feedback');
    INSERT INTO school_grades(lesson_id,student_id,grade,status) VALUES ('lesson','student',80,'graded');
    INSERT INTO school_attendance(lesson_id,student_id,status) VALUES ('lesson','student','present');
  `);
  return db;
}

function retained(db) {
  return Object.fromEntries(
    ['auth_users', 'school_files', 'school_submissions', 'school_grades', 'school_attendance'].map(
      (table) => [table, db.prepare(`SELECT * FROM ${table}`).all()],
    ),
  );
}

test('Legacy migration preserves parent/child records, old intervals, indexes and triggers', () => {
  const db = fixture();
  try {
    const before = retained(db);
    db.exec(`CREATE INDEX custom_lesson_note ON school_lessons(note);
      CREATE TABLE audit(id TEXT);
      CREATE TRIGGER lesson_audit AFTER UPDATE OF note ON school_lessons
        BEGIN INSERT INTO audit(id) VALUES (NEW.id); END;`);
    assert.deepEqual(migrateSqliteAcademic(db), { migrated: true });
    assert.deepEqual(retained(db), before);
    const lesson = db.prepare("SELECT * FROM school_lessons WHERE id='lesson'").get();
    assert.equal(lesson.kind, 'Old practice');
    assert.equal(lesson.starts_at, '2026-01-01T08:30:00Z');
    assert.equal(lesson.ends_at, '2026-01-01T09:50:00Z');
    assert.equal(lesson.version, 4);
    assert.equal(lesson.practice_id, null);
    assert.equal(lesson.slot_id, null);
    assert.equal(db.prepare('SELECT lesson_id FROM school_assignments').get().lesson_id, null);
    assert.equal(db.prepare('SELECT language FROM school_groups').get().language, null);
    assert.equal(db.prepare('SELECT type FROM school_rooms').get().type, null);
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='custom_lesson_note'").get());
    db.exec("UPDATE school_lessons SET note='changed' WHERE id='lesson'");
    assert.equal(db.prepare('SELECT id FROM audit').get().id, 'lesson');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  } finally {
    db.close();
  }
});

test('SRSP constraints allow a parent link without reserving a room or time', () => {
  const db = fixture();
  try {
    migrateSqliteAcademic(db);
    db.exec("UPDATE school_lessons SET kind='practice' WHERE id='lesson'");
    const add =
      db.prepare(`INSERT INTO school_lessons(id,group_id,subject_id,teacher_id,kind,status,practice_id,room_id,starts_at,ends_at,slot_id)
      VALUES (?,'group','subject','teacher',?,'scheduled',?,?,?,?,?)`);
    add.run('srsp', 'srsp', 'lesson', null, null, null, null);
    assert.throws(() => add.run('missing-parent', 'srsp', null, null, null, null, null));
    assert.throws(() => add.run('unknown-parent', 'srsp', 'unknown', null, null, null, null));
    assert.throws(() => add.run('self', 'srsp', 'self', null, null, null, null));
    assert.throws(() => add.run('has-slot', 'srsp', 'lesson', null, null, null, 'p1'));
    assert.throws(() => add.run('has-room', 'srsp', 'lesson', 'room', null, null, null));
    assert.throws(() => add.run('incomplete-practice', 'practice', null, null, null, null, 'p1'));
    assert.throws(() => db.exec("DELETE FROM school_lessons WHERE id='lesson'"));
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    db.close();
  }
});

test('Fresh schema and repeated migration retain manually configured capabilities', () => {
  const db = fixture(false);
  try {
    assert.deepEqual(migrateSqliteAcademic(db), { migrated: false });
    db.exec(`INSERT INTO school_teacher_subjects VALUES ('teacher','subject');
      INSERT INTO school_teacher_languages VALUES ('teacher','kk');
      INSERT INTO school_group_subjects VALUES ('group','subject',2026,1);
      UPDATE school_groups SET program='IS',intake_year=2024,language='kk' WHERE id='group';`);
    const before = retained(db);
    assert.deepEqual(migrateSqliteAcademic(db), { migrated: false });
    assert.deepEqual(retained(db), before);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM school_teacher_subjects').get().n, 1);
    assert.equal(db.prepare('SELECT language FROM school_groups').get().language, 'kk');
    assert.equal(
      db.prepare('SELECT value FROM studyhub_settings WHERE key=?').get(academicMigrationKey).value,
      '1',
    );
    assert.throws(() => db.exec("INSERT INTO school_teacher_languages VALUES ('teacher','other')"));
    assert.throws(() =>
      db.exec("INSERT INTO school_group_subjects VALUES ('group','subject',2026,3)"),
    );
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    db.close();
  }
});

test('An invalid legacy foreign key rolls back the whole migration and restores enforcement', () => {
  const db = fixture();
  try {
    db.exec(
      "PRAGMA foreign_keys=OFF; INSERT INTO school_attendance VALUES ('missing','student','absent'); PRAGMA foreign_keys=ON;",
    );
    const before = retained(db);
    assert.throws(() => migrateSqliteAcademic(db), /foreign keys/);
    assert.deepEqual(retained(db), before);
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    assert.equal(
      db
        .prepare('PRAGMA table_info(school_lessons)')
        .all()
        .some((row) => row.name === 'practice_id'),
      false,
    );
    assert.equal(
      db
        .prepare('PRAGMA table_info(school_groups)')
        .all()
        .some((row) => row.name === 'language'),
      false,
    );
    assert.equal(
      db.prepare('SELECT 1 FROM studyhub_settings WHERE key=?').get(academicMigrationKey),
      undefined,
    );
    db.exec("DELETE FROM school_attendance WHERE lesson_id='missing'");
    assert.deepEqual(migrateSqliteAcademic(db), { migrated: true });
  } finally {
    db.close();
  }
});

test('Cloud import snapshot includes academic relationships and linked SRSP without losing files', async () => {
  const db = fixture();
  const directory = mkdtempSync(join(tmpdir(), 'studyhub-academic-import-'));
  const filename = join(directory, 'academic.sqlite');
  try {
    migrateSqliteAcademic(db);
    db.exec(`INSERT INTO school_teacher_subjects VALUES ('teacher','subject');
      INSERT INTO school_teacher_languages VALUES ('teacher','kk');
      INSERT INTO school_group_subjects VALUES ('group','subject',2026,1);
      UPDATE school_lessons SET kind='practice' WHERE id='lesson';
      INSERT INTO school_lessons(id,group_id,subject_id,teacher_id,kind,status,practice_id)
        VALUES ('srsp','group','subject','teacher','srsp','scheduled','lesson');`);
    db.prepare('VACUUM INTO ?').run(filename);
    const snapshot = await readSqliteSnapshot(filename);
    for (const name of [
      'school_teacher_subjects',
      'school_teacher_languages',
      'school_group_subjects',
    ]) {
      assert.equal(snapshot.manifest.counts[name], 1);
    }
    assert.equal(snapshot.manifest.counts.school_files, 1);
    assert.equal(
      snapshot.tables.school_lessons.rows.find((row) => row.id === 'srsp').practice_id,
      'lesson',
    );
    assert.equal(snapshot.tables.school_assignments.rows[0].lesson_id, null);
  } finally {
    db.close();
    for (const name of readdirSync(directory)) {
      assert.ok(['academic.sqlite', 'academic.sqlite-wal', 'academic.sqlite-shm'].includes(name));
      unlinkSync(join(directory, name));
    }
    rmdirSync(directory);
  }
});

test('Migration refuses a caller transaction without rolling it back', () => {
  const db = fixture();
  try {
    db.exec(
      "PRAGMA foreign_keys=OFF; BEGIN; UPDATE school_lessons SET note='caller edit' WHERE id='lesson';",
    );
    assert.throws(() => migrateSqliteAcademic(db), /outside an existing transaction/);
    assert.equal(db.isTransaction, true);
    assert.equal(
      db.prepare("SELECT note FROM school_lessons WHERE id='lesson'").get().note,
      'caller edit',
    );
    db.exec('ROLLBACK');
    assert.deepEqual(migrateSqliteAcademic(db), { migrated: true });
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 0);
  } finally {
    db.close();
  }
});
