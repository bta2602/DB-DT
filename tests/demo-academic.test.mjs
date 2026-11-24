import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import test from 'node:test';
import { closeDatabase, getDatabase } from '../database/connection.mjs';
import {
  completeDemoAcademicMetadata,
  demoAcademicMetadataKey,
} from '../database/seeds/demo-academic.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'studyhub-demo-academic-'));
  const previous = Object.fromEntries(
    ['DATABASE_URL', 'STUDYHUB_DATA_DIR', 'STUDYHUB_DEMO_MODE'].map((key) => [
      key,
      process.env[key],
    ]),
  );
  process.env.DATABASE_URL = '';
  process.env.STUDYHUB_DATA_DIR = directory;
  process.env.STUDYHUB_DEMO_MODE = 'false';
  t.after(async () => {
    await closeDatabase();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    const owned = await realpath(directory);
    assert.equal(dirname(owned), await realpath(tmpdir()));
    assert.ok(basename(owned).startsWith('studyhub-demo-academic-'));
    await rm(owned, { recursive: true, force: true });
  });
  const db = await getDatabase();
  await db.exec(`
    INSERT INTO studyhub_settings VALUES ('dataset_mode','demo');
    INSERT INTO school_demo_seeds(id,seed_date,counts_json,created_at) VALUES ('studyhub-campus-v3','2026-10-01','{}',0);
    INSERT INTO auth_users(id,email,name,password_hash,role,is_demo,created_at) VALUES
      ('demo-teacher-1','teacher1@example.test','Teacher 1','unused','teacher',1,0),
      ('demo-teacher-2','teacher2@example.test','Teacher 2','unused','teacher',1,0),
      ('custom-teacher','custom@example.test','Custom teacher','unused','teacher',1,0);
    INSERT INTO school_groups(id,name,name_key,course) VALUES
      ('demo-group-1','Group 1','group 1',1),
      ('demo-group-2','Group 2','group 2',1),
      ('demo-campus-group-99','Custom group','custom group',1);
    INSERT INTO school_subjects(id,name,name_key) VALUES
      ('demo-subject-db','Database','database'),
      ('demo-subject-web','Web','web'),
      ('demo-subject-math','Math','math'),
      ('demo-subject-design','Design','design'),
      ('custom-subject','Custom','custom');
    INSERT INTO school_rooms(id,name,name_key,capacity) VALUES ('room','Room','room',24);
    INSERT INTO school_teaching_assignments VALUES
      ('demo-teacher-1','demo-group-1','demo-subject-db'),
      ('demo-teacher-1','demo-group-1','demo-subject-web'),
      ('demo-teacher-2','demo-group-2','demo-subject-math'),
      ('demo-teacher-1','demo-group-1','custom-subject'),
      ('custom-teacher','demo-campus-group-99','custom-subject');
    INSERT INTO school_lessons(id,group_id,subject_id,teacher_id,room_id,starts_at,ends_at,kind,status) VALUES
      ('earlier','demo-group-1','demo-subject-db','demo-teacher-1','room','2026-03-01T03:00:00Z','2026-03-01T03:50:00Z','practice','scheduled'),
      ('current','demo-group-1','demo-subject-db','demo-teacher-1','room','2026-10-01T03:00:00Z','2026-10-01T03:50:00Z','practice','scheduled'),
      ('cancelled','demo-group-2','demo-subject-math','demo-teacher-2','room','2027-10-01T03:00:00Z','2027-10-01T03:50:00Z','practice','cancelled'),
      ('archived','demo-group-2','demo-subject-math','demo-teacher-2','room','2028-10-01T03:00:00Z','2028-10-01T03:50:00Z','practice','scheduled'),
      ('custom','demo-campus-group-99','custom-subject','custom-teacher','room','2026-10-02T03:00:00Z','2026-10-02T03:50:00Z','practice','scheduled'),
      ('custom-subject','demo-group-1','custom-subject','demo-teacher-1','room','2026-10-03T03:00:00Z','2026-10-03T03:50:00Z','practice','scheduled');
    UPDATE school_lessons SET archived_at='2026-10-01' WHERE id='archived';
    INSERT INTO school_lessons(id,group_id,subject_id,teacher_id,kind,status,practice_id) VALUES
      ('srsp','demo-group-1','demo-subject-db','demo-teacher-1','srsp','scheduled','earlier');
  `);
  return db;
}

async function metadata(db) {
  return Promise.all([
    db.prepare('SELECT * FROM school_groups ORDER BY id').all(),
    db.prepare('SELECT * FROM school_teacher_subjects ORDER BY teacher_id,subject_id').all(),
    db.prepare('SELECT * FROM school_teacher_languages ORDER BY teacher_id,language').all(),
    db
      .prepare(
        'SELECT * FROM school_group_subjects ORDER BY group_id,academic_year,semester,subject_id',
      )
      .all(),
    db.prepare('SELECT * FROM studyhub_settings ORDER BY key').all(),
  ]);
}

test('Demo academic repair fills only known sample records and their actual earlier/current semesters', async (t) => {
  const db = await fixture(t);
  const lessons = await db.prepare('SELECT * FROM school_lessons ORDER BY id').all();
  const result = await completeDemoAcademicMetadata(db);
  assert.equal(result.applied, true);
  assert.deepEqual(result.counts, {
    groupLanguages: 2,
    teacherSubjects: 3,
    teacherLanguages: 2,
    groupSubjects: 2,
  });
  assert.equal(
    (await db.prepare("SELECT language FROM school_groups WHERE id='demo-campus-group-99'").get())
      .language,
    null,
  );
  assert.deepEqual(
    (await db.prepare('SELECT * FROM school_group_subjects ORDER BY academic_year').all()).map(
      (row) => ({ ...row }),
    ),
    [
      { group_id: 'demo-group-1', subject_id: 'demo-subject-db', academic_year: 2025, semester: 2 },
      { group_id: 'demo-group-1', subject_id: 'demo-subject-db', academic_year: 2026, semester: 1 },
    ],
  );
  assert.deepEqual(await db.prepare('SELECT * FROM school_lessons ORDER BY id').all(), lessons);
  const completed = await metadata(db);
  assert.equal((await completeDemoAcademicMetadata(db)).applied, false);
  assert.deepEqual(await metadata(db), completed);
  await db.prepare("DELETE FROM school_teacher_subjects WHERE teacher_id='demo-teacher-1'").run();
  assert.equal((await completeDemoAcademicMetadata(db)).applied, false);
  assert.equal(
    (
      await db
        .prepare(
          "SELECT count(*) AS count FROM school_teacher_subjects WHERE teacher_id='demo-teacher-1'",
        )
        .get()
    ).count,
    0,
  );
});

test('Demo repair preserves configured language, subject lists and semester curricula', async (t) => {
  const db = await fixture(t);
  await db.exec(`
    UPDATE school_groups SET language='kk' WHERE id='demo-group-1';
    INSERT INTO school_teacher_subjects VALUES ('demo-teacher-1','demo-subject-web');
    INSERT INTO school_teacher_languages VALUES ('demo-teacher-1','kk');
    INSERT INTO school_group_subjects VALUES ('demo-group-1','custom-subject',2026,1);
  `);
  const result = await completeDemoAcademicMetadata(db);
  assert.equal(result.skipped.teacherSubjects, 1);
  assert.equal(result.skipped.teacherLanguages, 1);
  assert.equal(result.skipped.curricula, 1);
  assert.equal(
    (await db.prepare("SELECT language FROM school_groups WHERE id='demo-group-1'").get()).language,
    'kk',
  );
  assert.deepEqual(
    (
      await db
        .prepare("SELECT subject_id FROM school_teacher_subjects WHERE teacher_id='demo-teacher-1'")
        .all()
    ).map((row) => row.subject_id),
    ['demo-subject-web'],
  );
  assert.deepEqual(
    (
      await db
        .prepare(
          'SELECT subject_id FROM school_group_subjects WHERE academic_year=2026 AND semester=1',
        )
        .all()
    ).map((row) => row.subject_id),
    ['custom-subject'],
  );
});

test('Legacy SRSP uses a valid linked practice date and may have a different teacher', async (t) => {
  const db = await fixture(t);
  await db.exec(`
    UPDATE school_lessons SET teacher_id='demo-teacher-2',kind=' Практика ',
      starts_at='2024-02-01T03:00:00Z',ends_at='2024-02-01T03:50:00Z' WHERE id='earlier';
    PRAGMA ignore_check_constraints=ON;
    INSERT INTO school_lessons(id,group_id,subject_id,teacher_id,room_id,starts_at,ends_at,kind,status,practice_id) VALUES
      ('legacy-srsp','demo-group-1','demo-subject-db','demo-teacher-1','room','2040-10-01T03:00:00Z','2040-10-01T03:50:00Z',' СРСП ','scheduled','earlier'),
      ('missing-practice','demo-group-1','demo-subject-db','demo-teacher-1','room','2041-10-01T03:00:00Z','2041-10-01T03:50:00Z','СРСП','scheduled',NULL),
      ('invalid-practice','demo-group-1','demo-subject-db','demo-teacher-2','room','invalid','zzz','practice','scheduled',NULL),
      ('bad-date-srsp','demo-group-1','demo-subject-db','demo-teacher-1',NULL,NULL,NULL,'srsp','scheduled','invalid-practice'),
      ('cancelled-practice-srsp','demo-group-1','demo-subject-db','demo-teacher-1','room','2042-10-01T03:00:00Z','2042-10-01T03:50:00Z','СРСП','scheduled','cancelled');
    PRAGMA ignore_check_constraints=OFF;
  `);
  await completeDemoAcademicMetadata(db);
  const periods = await db
    .prepare(
      'SELECT DISTINCT academic_year,semester FROM school_group_subjects ORDER BY academic_year',
    )
    .all();
  assert.deepEqual(
    periods.map((row) => ({ ...row })),
    [
      { academic_year: 2023, semester: 2 },
      { academic_year: 2026, semester: 1 },
    ],
  );
});

test('Demo repair refuses ordinary or unmarked datasets without changes', async (t) => {
  const db = await fixture(t);
  await db.prepare("DELETE FROM school_demo_seeds WHERE id='studyhub-campus-v3'").run();
  const unmarked = await metadata(db);
  await assert.rejects(completeDemoAcademicMetadata(db), /только в стандартной синтетической базе/);
  assert.deepEqual(await metadata(db), unmarked);
  await db.exec(`
    INSERT INTO school_demo_seeds(id,seed_date,counts_json,created_at) VALUES ('studyhub-campus-v3','2026-10-01','{}',0);
    INSERT INTO auth_users(id,email,name,password_hash,role,is_demo,created_at) VALUES ('ordinary','ordinary@example.test','Ordinary','unchanged','student',0,0);
  `);
  const mixed = await metadata(db);
  await assert.rejects(completeDemoAcademicMetadata(db), /без обычных аккаунтов/);
  assert.deepEqual(await metadata(db), mixed);
  assert.equal(
    (await db.prepare("SELECT password_hash FROM auth_users WHERE id='ordinary'").get())
      .password_hash,
    'unchanged',
  );
});

test('Demo repair leaves over-three-subject teacher configuration for explicit administration', async (t) => {
  const db = await fixture(t);
  await db.exec(`
    INSERT INTO school_teaching_assignments VALUES
      ('demo-teacher-1','demo-group-1','demo-subject-math'),
      ('demo-teacher-1','demo-group-1','demo-subject-design');
  `);
  const result = await completeDemoAcademicMetadata(db);
  assert.equal(result.skipped.subjectLimit, 1);
  assert.equal(
    (
      await db
        .prepare(
          "SELECT count(*) AS count FROM school_teacher_subjects WHERE teacher_id='demo-teacher-1'",
        )
        .get()
    ).count,
    0,
  );
});

test('Demo repair rolls back its metadata and marker together on failure', async (t) => {
  const db = await fixture(t);
  const before = await metadata(db);
  const prepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    if (sql.startsWith('INSERT INTO studyhub_settings')) throw new Error('Expected marker failure');
    return prepare(sql);
  };
  try {
    await assert.rejects(completeDemoAcademicMetadata(db), /Expected marker failure/);
  } finally {
    db.prepare = prepare;
  }
  assert.deepEqual(await metadata(db), before);
  assert.equal(
    await db.prepare('SELECT 1 FROM studyhub_settings WHERE key=?').get(demoAcademicMetadataKey),
    undefined,
  );
});
