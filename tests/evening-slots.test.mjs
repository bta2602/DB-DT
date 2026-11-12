import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { authSchema, schoolSchema, learningSchema } from '../database/schema.mjs';
import { migrateSqliteAcademic } from '../database/migrations/academic-data.mjs';
import {
  eveningSlotsMigrationKey,
  migrateSqliteEveningSlots,
} from '../database/migrations/evening-slots.mjs';
import { lessonInterval } from '../lib/studyhub/lesson-rules.mjs';

function fixture(full) {
  const db = new DatabaseSync(':memory:');
  // Independent representation of the old deployed nine-slot check.
  db.exec(
    authSchema + schoolSchema.replace(", 'p10','p11','p12'", '').replace(",'p10','p11','p12'", ''),
  );
  db.exec('ALTER TABLE auth_users ADD COLUMN group_id TEXT REFERENCES school_groups(id)');
  db.exec(learningSchema);
  db.exec(`INSERT INTO auth_users(id,email,name,password_hash,role,created_at) VALUES
    ('teacher','teacher@test.example','Teacher','saved-teacher-hash','teacher',1),
    ('student','student@test.example','Student','saved-student-hash','student',1);
    INSERT INTO school_groups(id,name,name_key,course) VALUES ('group','IS','is',1);
    INSERT INTO school_subjects(id,name,name_key) VALUES ('subject','Math','math');
    INSERT INTO school_rooms(id,name,name_key,capacity) VALUES ('room','101','101',30);
    INSERT INTO school_lessons(id,group_id,subject_id,teacher_id,room_id,starts_at,ends_at,kind,status)
      VALUES ('historical','group','subject','teacher','room','2026-01-01T08:30:00Z','2026-01-01T09:50:00Z','Old practice','scheduled');
    INSERT INTO school_grades(lesson_id,student_id,grade,status) VALUES ('historical','student',81,'graded');
    ALTER TABLE school_lessons ADD COLUMN custom_note TEXT DEFAULT 'keep';
    CREATE INDEX custom_lesson_index ON school_lessons(custom_note);
    CREATE VIEW custom_lesson_view AS SELECT id,custom_note FROM school_lessons;
    CREATE TRIGGER custom_lesson_guard BEFORE UPDATE OF note ON school_lessons
      WHEN NEW.note='forbidden' BEGIN SELECT RAISE(ABORT,'custom guard'); END;`);
  if (full) {
    migrateSqliteAcademic(db);
    db.exec(`UPDATE school_groups SET program='IS',intake_year=2026,language='kk' WHERE id='group';
      INSERT INTO school_teacher_subjects VALUES ('teacher','subject');
      INSERT INTO school_teacher_languages VALUES ('teacher','kk');
      INSERT INTO school_group_subjects VALUES ('group','subject',2026,1);
      INSERT INTO school_teaching_assignments VALUES ('teacher','group','subject');`);
    // Represent old trigger functions too, so widening the CHECK alone cannot pass this test.
    for (const { name, sql } of db
      .prepare(
        "SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name IN ('academic_lesson_insert','academic_lesson_update')",
      )
      .all()) {
      db.exec(`DROP TRIGGER ${name}`);
      db.exec(sql.replace(/WHEN 'p(?:10|11|12)' THEN '[^']+'/g, ''));
    }
  }
  return db;
}
function insertLesson(db, id, slotId, changes = {}, full = true) {
  const interval = lessonInterval('2026-11-23', slotId);
  const row = {
    id,
    group_id: 'group',
    subject_id: 'subject',
    teacher_id: 'teacher',
    room_id: 'room',
    kind: 'practice',
    status: 'scheduled',
    starts_at: interval.startsAt,
    ends_at: interval.endsAt,
    slot_id: slotId,
    ...(full ? { academic_year: 2026, semester: 1 } : {}),
    ...changes,
  };
  return db
    .prepare(
      `INSERT INTO school_lessons(${Object.keys(row).join(',')}) VALUES (${Object.keys(row)
        .map(() => '?')
        .join(',')})`,
    )
    .run(...Object.values(row));
}

for (const full of [false, true])
  test(`evening migration preserves data and custom objects (${full ? 'full academic' : 'minimal'} schema)`, () => {
    const db = fixture(full);
    try {
      const tables = ['auth_users', 'school_lessons', 'school_grades'];
      const before = tables.map((table) => db.prepare(`SELECT * FROM ${table}`).all());
      assert.throws(() => insertLesson(db, 'before', 'p10', {}, full));
      assert.deepEqual(migrateSqliteEveningSlots(db), { migrated: true });
      tables.forEach((table, i) =>
        assert.deepEqual(db.prepare(`SELECT * FROM ${table}`).all(), before[i]),
      );
      assert.equal(
        db.prepare('SELECT custom_note FROM custom_lesson_view').get().custom_note,
        'keep',
      );
      assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='custom_lesson_index'").get());
      assert.throws(
        () => db.exec("UPDATE school_lessons SET note='forbidden' WHERE id='historical'"),
        /custom guard/,
      );
      for (const slot of ['p10', 'p11', 'p12']) insertLesson(db, slot, slot, {}, full);
      assert.throws(() => db.exec("UPDATE school_lessons SET slot_id='p13' WHERE id='p12'"));
      if (full)
        assert.throws(() =>
          insertLesson(db, 'wrong-time', 'p10', { starts_at: '2026-11-23T11:40:00.000Z' }),
        );
      assert.deepEqual(migrateSqliteEveningSlots(db), { migrated: false });
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
      assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    } finally {
      db.close();
    }
  });

test('invalid foreign keys roll back migration and restore PRAGMAs', () => {
  const db = fixture(false);
  try {
    db.exec(
      "PRAGMA foreign_keys=OFF; INSERT INTO school_attendance VALUES ('missing','student','absent'); PRAGMA foreign_keys=ON",
    );
    const original = db
      .prepare("SELECT sql FROM sqlite_master WHERE name='school_lessons'")
      .get().sql;
    assert.throws(() => migrateSqliteEveningSlots(db), /Foreign key check/);
    assert.equal(
      db.prepare("SELECT sql FROM sqlite_master WHERE name='school_lessons'").get().sql,
      original,
    );
    assert.equal(
      db.prepare('SELECT 1 FROM studyhub_settings WHERE key=?').get(eveningSlotsMigrationKey),
      undefined,
    );
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    assert.equal(db.prepare('PRAGMA legacy_alter_table').get().legacy_alter_table, 0);
  } finally {
    db.close();
  }
});

test('migration refuses an existing transaction without discarding caller changes', () => {
  const db = fixture(false);
  try {
    db.exec("BEGIN; UPDATE school_lessons SET note='caller' WHERE id='historical'");
    assert.throws(() => migrateSqliteEveningSlots(db), /own transaction/);
    assert.equal(db.isTransaction, true);
    assert.equal(
      db.prepare("SELECT note FROM school_lessons WHERE id='historical'").get().note,
      'caller',
    );
    db.exec('ROLLBACK');
  } finally {
    db.close();
  }
});
