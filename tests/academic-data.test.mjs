import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { closeDatabase, getDatabase } from '../database/connection.mjs';
import { migrateSqliteAcademic } from '../database/migrations/academic-data.mjs';
import { seedAcademicData } from '../database/seeds/academic-data.mjs';
import {
  academicYearForDate,
  courseForDate,
  createAcademicPlan,
} from '../database/seeds/academic-plan.mjs';

const legacySchema = await readFile(
  new URL('./fixtures/academic-legacy.sql', import.meta.url),
  'utf8',
);
const slotStarts = [
  '08:00',
  '08:55',
  '09:50',
  '10:55',
  '11:50',
  '12:45',
  '13:50',
  '14:45',
  '15:40',
  '16:45',
  '17:40',
  '18:35',
];
const protectedTables = [
  'auth_users',
  'auth_sessions',
  'school_files',
  'school_submissions',
  'school_grades',
  'school_attendance',
  'school_materials',
  'school_announcements',
];

async function isolatedDatabase(t, populate) {
  const directory = await mkdtemp(join(tmpdir(), 'studyhub-academic-tests-'));
  const previous = Object.fromEntries(
    ['DATABASE_URL', 'STUDYHUB_DATA_DIR', 'STUDYHUB_DEMO_MODE'].map((key) => [
      key,
      process.env[key],
    ]),
  );
  // No env file is loaded; inherited production connection strings cannot be used here.
  process.env.DATABASE_URL = '';
  process.env.STUDYHUB_DATA_DIR = directory;
  process.env.STUDYHUB_DEMO_MODE = 'false';
  t.after(async () => {
    await closeDatabase();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    const target = await realpath(directory);
    assert.equal(dirname(target), await realpath(tmpdir()));
    assert.ok(basename(target).startsWith('studyhub-academic-tests-'));
    await rm(target, { recursive: true, force: true });
  });
  const sqlite = new DatabaseSync(join(directory, 'auth.sqlite'));
  try {
    sqlite.exec(legacySchema);
    populate?.(sqlite);
    assert.deepEqual(migrateSqliteAcademic(sqlite), { migrated: true });
    assert.deepEqual(migrateSqliteAcademic(sqlite), { migrated: false });
    assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    sqlite.close();
  }
  return getDatabase();
}

async function rows(db, table, order = '1') {
  return db.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all();
}

function localDateTime(instant) {
  return new Date(Date.parse(instant) + 5 * 60 * 60000).toISOString();
}

function assertNoConflicts(lessons) {
  for (const resource of ['group_id', 'teacher_id', 'room_id']) {
    const calendars = new Map();
    for (const lesson of lessons) {
      if (lesson.status === 'cancelled' || !lesson.starts_at) continue;
      if (!calendars.has(lesson[resource])) calendars.set(lesson[resource], []);
      calendars.get(lesson[resource]).push(lesson);
    }
    for (const calendar of calendars.values()) {
      calendar.sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
      for (let index = 1; index < calendar.length; index++) {
        assert.ok(
          Date.parse(calendar[index - 1].ends_at) <= Date.parse(calendar[index].starts_at),
          `${resource} conflict: ${calendar[index - 1].id} / ${calendar[index].id}`,
        );
      }
    }
  }
}

test('The academic plan describes precisely the first semester of 2026/27', () => {
  const plan = createAcademicPlan(2026);
  assert.equal(plan.groups.length, 18);
  assert.equal(plan.students.length, 360);
  assert.equal(plan.teachers.length, 18);
  assert.equal(plan.rooms.length, 24);
  assert.equal(Object.keys(plan.subjects).length, 15);
  assert.equal(plan.rooms.filter((room) => room.type === 'laboratory').length, 4);
  assert.equal(plan.groupSubjects.length, 90);
  assert.ok(
    plan.groupSubjects.every((entry) => entry.academicYear === 2026 && entry.semester === 1),
  );
  for (const group of plan.groups) {
    assert.equal(group.course, 2026 - group.intakeYear + 1);
    assert.equal(plan.students.filter((student) => student.groupKey === group.key).length, 20);
  }
  for (const invalid of [2023, 2026.5, NaN, Infinity, '2026']) {
    assert.throws(() => createAcademicPlan(invalid));
  }
});

test('Course advances at midnight on September 1 in UTC+5', () => {
  assert.equal(academicYearForDate('2026-08-31T18:59:59.999Z'), 2025);
  assert.equal(academicYearForDate('2026-08-31T19:00:00.000Z'), 2026);
  assert.equal(courseForDate(2024, '2026-08-31T18:59:59.999Z'), 2);
  assert.equal(courseForDate(2024, '2026-08-31T19:00:00.000Z'), 3);
  assert.equal(courseForDate(2026, '2027-08-31T18:59:59.999Z'), 1);
  assert.equal(courseForDate(2026, '2027-08-31T19:00:00.000Z'), 2);
  assert.throws(() => academicYearForDate('invalid'));
  assert.throws(() => courseForDate('2024'));
});

test('A fresh migrated database has the requested roster and a repeatable conflict-free academic timetable', async (t) => {
  const db = await isolatedDatabase(t);
  const first = await seedAcademicData(db, { academicYear: 2026 });
  assert.equal(first.created, true);
  const users = await rows(db, 'auth_users', 'id');
  const groups = await rows(db, 'school_groups', 'id');
  const subjects = await rows(db, 'school_subjects', 'id');
  const rooms = await rows(db, 'school_rooms', 'id');
  const lessons = await rows(db, 'school_lessons', 'id');
  const assignments = await rows(db, 'school_assignments', 'id');
  const specializations = await rows(db, 'school_teacher_subjects', 'teacher_id,subject_id');
  const languages = await rows(db, 'school_teacher_languages', 'teacher_id,language');
  const curricula = await rows(db, 'school_group_subjects', 'group_id,subject_id');
  const teaching = await rows(db, 'school_teaching_assignments', 'teacher_id,group_id,subject_id');
  const teachers = users.filter((user) => user.role === 'teacher');
  const students = users.filter((user) => user.role === 'student');
  assert.equal(teachers.length, 18);
  assert.equal(students.length, 360);
  assert.equal(groups.length, 18);
  assert.equal(subjects.length, 15);
  assert.equal(rooms.length, 24);
  assert.equal(rooms.filter((room) => room.type === 'laboratory').length, 4);
  assert.ok(users.every((user) => user.password_hash.startsWith('scrypt$')));
  assert.equal(new Set(users.map((user) => user.password_hash)).size, users.length);
  for (const group of groups) {
    assert.equal(students.filter((user) => user.group_id === group.id).length, 20);
    assert.ok(['IS', 'VTIPO', 'DS'].includes(group.program));
    assert.ok([2024, 2025, 2026].includes(group.intake_year));
    assert.ok(['kk', 'ru'].includes(group.language));
    assert.equal(group.course, 2026 - group.intake_year + 1);
    const prefix = { IS: 'ИС', VTIPO: 'ВТиПО', DS: 'DS' }[group.program];
    assert.equal(
      group.name,
      `${prefix}-${String(group.intake_year).slice(-2)}${group.language === 'kk' ? 'А' : 'Б'}`,
    );
    const curriculum = curricula.filter((entry) => entry.group_id === group.id);
    assert.equal(curriculum.length, 5);
    assert.ok(curriculum.every((entry) => entry.academic_year === 2026 && entry.semester === 1));
  }
  for (const floor of [1, 2, 3, 4]) {
    assert.equal(rooms.filter((room) => room.floor === floor).length, 6);
  }
  assert.equal(new Set(rooms.map((room) => room.number)).size, 24);
  for (const room of rooms) {
    assert.equal(typeof room.number, 'string');
    assert.equal(Number(room.number[0]), room.floor);
    assert.ok(room.capacity >= 20);
  }
  for (const subject of subjects) {
    const eligible = specializations.filter((entry) => entry.subject_id === subject.id);
    assert.equal(eligible.length, 3);
    const profiles = eligible.map(({ teacher_id }) =>
      languages
        .filter((entry) => entry.teacher_id === teacher_id)
        .map((entry) => entry.language)
        .sort()
        .join(','),
    );
    assert.deepEqual(profiles.sort(), ['kk', 'kk,ru', 'ru']);
  }
  for (const teacher of teachers) {
    const subjectIds = new Set(
      specializations
        .filter((entry) => entry.teacher_id === teacher.id)
        .map((entry) => entry.subject_id),
    );
    assert.ok(subjectIds.size >= 1 && subjectIds.size <= 3);
  }
  for (const entry of teaching) {
    const group = groups.find((row) => row.id === entry.group_id);
    assert.ok(
      specializations.some(
        (row) => row.teacher_id === entry.teacher_id && row.subject_id === entry.subject_id,
      ),
    );
    assert.ok(
      languages.some(
        (row) => row.teacher_id === entry.teacher_id && row.language === group.language,
      ),
    );
    assert.ok(
      curricula.some(
        (row) => row.group_id === entry.group_id && row.subject_id === entry.subject_id,
      ),
    );
  }
  const ordinary = lessons.filter((lesson) => lesson.kind !== 'srsp');
  const srsp = lessons.filter((lesson) => lesson.kind === 'srsp');
  const subjectCodes = new Map(
    (await rows(db, 'school_academic_seed_map'))
      .filter((entry) => entry.entity === 'subject')
      .map((entry) => [entry.record_id, entry.seed_key]),
  );
  assert.ok(ordinary.some((lesson) => lesson.kind === 'lecture'));
  assert.ok(ordinary.some((lesson) => lesson.kind === 'practice'));
  assert.ok(srsp.length > 0);
  for (const lesson of ordinary) {
    assert.ok(['lecture', 'practice'].includes(lesson.kind));
    const local = localDateTime(lesson.starts_at);
    assert.equal(local.slice(11, 16), slotStarts[Number(lesson.slot_id.slice(1)) - 1]);
    assert.ok(![0, 6].includes(new Date(local).getUTCDay()));
    assert.equal(Date.parse(lesson.ends_at) - Date.parse(lesson.starts_at), 50 * 60000);
    assert.equal(lesson.practice_id, null);
    assert.equal(lesson.academic_year, 2026);
    assert.equal(lesson.semester, 1);
    assert.ok(rooms.some((room) => room.id === lesson.room_id && room.capacity >= 20));
    const room = rooms.find((entry) => entry.id === lesson.room_id);
    const subjectCode = subjectCodes.get(lesson.subject_id);
    if (lesson.kind === 'lecture') assert.ok(['ordinary', 'lecture'].includes(room.type));
    else if (['os', 'networks', 'security'].includes(subjectCode))
      assert.equal(room.type, 'laboratory');
    else if (['math', 'stats', 'english', 'projects'].includes(subjectCode))
      assert.ok(['ordinary', 'lecture'].includes(room.type));
    else assert.equal(room.type, 'computer');
    assert.ok(
      teaching.some(
        (entry) =>
          entry.teacher_id === lesson.teacher_id &&
          entry.group_id === lesson.group_id &&
          entry.subject_id === lesson.subject_id,
      ),
    );
  }
  for (const group of groups) {
    const groupLessons = ordinary.filter((lesson) => lesson.group_id === group.id);
    const weeks = new Set();
    const dayCounts = new Map();
    for (const lesson of groupLessons) {
      const day = localDateTime(lesson.starts_at).slice(0, 10);
      dayCounts.set(day, (dayCounts.get(day) || 0) + 1);
      const monday = new Date(`${day}T00:00:00Z`);
      monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
      weeks.add(monday.toISOString().slice(0, 10));
    }
    assert.equal(weeks.size, 4, `Four teaching weeks for ${group.name}`);
    assert.ok([...dayCounts.values()].every((count) => count < 9));
    assert.equal(new Set(groupLessons.map((lesson) => lesson.subject_id)).size, 5);
  }
  for (const lesson of srsp) {
    assert.equal(lesson.slot_id, null);
    assert.equal(lesson.room_id, null);
    assert.equal(lesson.starts_at, null);
    assert.equal(lesson.ends_at, null);
    const practice = ordinary.find((row) => row.id === lesson.practice_id);
    assert.equal(practice?.kind, 'practice');
    for (const field of ['teacher_id', 'group_id', 'subject_id', 'academic_year', 'semester']) {
      assert.equal(lesson[field], practice[field]);
    }
    const projected = await db
      .prepare('SELECT date FROM school_academic_lessons WHERE id=?')
      .get(lesson.id);
    assert.equal(projected.date, localDateTime(practice.starts_at).slice(0, 10));
  }
  assert.ok(assignments.length > 0);
  for (const assignment of assignments) {
    const lesson = lessons.find((row) => row.id === assignment.lesson_id);
    assert.ok(lesson, `New assignment ${assignment.id} must reference a lesson`);
    assert.equal(assignment.type, lesson.kind);
    assert.ok(Number.isFinite(Date.parse(assignment.due_at)));
  }
  assertNoConflicts(lessons);
  assert.deepEqual(await db.prepare('PRAGMA foreign_key_check').all(), []);
  // SRSP has no copied date: moving a practice updates the projected date immediately.
  // Re-seeding must keep this explicit user edit instead of restoring the generated time.
  const practice = ordinary.find((lesson) => lesson.id === srsp[0].practice_id);
  const startsAt = new Date(
    `2026-12-01T${localDateTime(practice.starts_at).slice(11, 19)}+05:00`,
  ).toISOString();
  const endsAt = new Date(Date.parse(startsAt) + 50 * 60000).toISOString();
  await db
    .prepare('UPDATE school_lessons SET starts_at=?,ends_at=?,version=version+1 WHERE id=?')
    .run(startsAt, endsAt, practice.id);
  assert.equal(
    (await db.prepare('SELECT date FROM school_academic_lessons WHERE id=?').get(srsp[0].id)).date,
    '2026-12-01',
  );
  const tables = [
    'auth_users',
    'school_groups',
    'school_subjects',
    'school_rooms',
    'school_lessons',
    'school_assignments',
    'school_teacher_subjects',
    'school_teacher_languages',
    'school_group_subjects',
    'school_teaching_assignments',
    'school_academic_seed_map',
  ];
  const before = await Promise.all(tables.map((table) => rows(db, table)));
  const second = await seedAcademicData(db, { academicYear: 2026 });
  assert.equal(second.created, false);
  assert.deepEqual(await Promise.all(tables.map((table) => rows(db, table))), before);
});

test('Academic expansion retains old identities, access, lessons, files, works, marks and manual records', async (t) => {
  let before;
  let oldLessons;
  let oldAssignments;
  const db = await isolatedDatabase(t, (sqlite) => {
    sqlite.exec(`
      INSERT INTO auth_users(id,email,name,password_hash,role,is_demo,created_at,version) VALUES
        ('demo-teacher-1','legacy-teacher@example.test','Сохранённый преподаватель','unchanged-teacher-hash','teacher',1,100,4),
        ('demo-student-1','legacy-student@example.test','Сохранённый студент','unchanged-student-hash','student',1,101,7),
        ('manual-admin','admin@example.test','Ручной администратор','unchanged-admin-hash','admin',0,102,3);
      INSERT INTO school_groups(id,name,name_key,course,curator_id,version) VALUES
        ('demo-group-1','Прежняя учебная группа','прежняя учебная группа',1,'demo-teacher-1',3),
        ('manual-group','Ручная группа','ручная группа',4,NULL,5);
      UPDATE auth_users SET group_id='demo-group-1' WHERE id='demo-student-1';
      INSERT INTO auth_sessions(token_hash,user_id,csrf_token,expires_at) VALUES ('session-hash','demo-student-1','csrf',9999999999999);
      INSERT INTO school_subjects(id,name,name_key,version) VALUES ('demo-subject-1','Python','python',2);
      INSERT INTO school_rooms(id,name,name_key,capacity,version) VALUES ('demo-room-1','Аудитория 101','аудитория 101',30,3);
      INSERT INTO school_teaching_assignments(teacher_id,group_id,subject_id) VALUES ('demo-teacher-1','demo-group-1','demo-subject-1');
      INSERT INTO school_lessons(id,group_id,subject_id,teacher_id,room_id,starts_at,ends_at,kind,status,note,version,attendance_version)
        VALUES ('legacy-lesson','demo-group-1','demo-subject-1','demo-teacher-1','demo-room-1','2026-09-07T03:30:00.000Z','2026-09-07T04:50:00.000Z','Практическое занятие','scheduled','Историческое время',6,4);
      INSERT INTO school_assignments(id,subject_id,group_id,teacher_id,title,type,description,steps_json,due_at,version)
        VALUES ('legacy-assignment','demo-subject-1','demo-group-1','demo-teacher-1','Старая работа','Проект','Сохранить доступ','["Сдать файл"]','2026-10-01T09:00:00.000Z',8);
      INSERT INTO school_files(id,name,mime_type,contents,bytes) VALUES ('legacy-file','saved.sql','text/plain',X'53454C45435420313B',9);
      INSERT INTO school_submissions(id,assignment_id,student_id,file_id,status,submitted_at,grade,comment,version)
        VALUES ('legacy-submission','legacy-assignment','demo-student-1','legacy-file','reviewed','2026-09-08T04:00:00.000Z',87,'Оценено до обновления',9);
      INSERT INTO school_grades(lesson_id,student_id,grade,status,version) VALUES ('legacy-lesson','demo-student-1',73,'graded',11);
      INSERT INTO school_attendance(lesson_id,student_id,status) VALUES ('legacy-lesson','demo-student-1','present');
      INSERT INTO school_materials(id,subject_id,title,file_id) VALUES ('legacy-material','demo-subject-1','Материал','legacy-file');
      INSERT INTO school_announcements(id,title,body,published_at) VALUES ('manual-notice','Объявление','Не удалять','2026-08-31T00:00:00Z');
      INSERT INTO studyhub_settings(key,value) VALUES ('grading_scale_v2','100');
    `);
    // Reproduce the previous campus roster size without generating new passwords for old accounts.
    // These values represent existing hashes; the migration must leave every one untouched.
    const insertUser = sqlite.prepare(`INSERT INTO auth_users
      (id,email,name,password_hash,role,is_demo,created_at,group_id) VALUES (?,?,?,?,?,1,100,?)`);
    const insertGroup = sqlite.prepare(`INSERT INTO school_groups
      (id,name,name_key,course,curator_id) VALUES (?,?,?,?,?)`);
    for (let index = 2; index <= 16; index++) {
      const teacherId = `demo-teacher-${index}`;
      insertUser.run(
        teacherId,
        `old-teacher-${index}@example.test`,
        `Прежний преподаватель ${index}`,
        `preserved-teacher-hash-${index}`,
        'teacher',
        null,
      );
      insertGroup.run(
        `demo-group-${index}`,
        `Прежняя группа ${index}`,
        `прежняя группа ${index}`,
        1 + (index % 3),
        teacherId,
      );
    }
    for (let group = 1; group <= 16; group++) {
      for (let index = group === 1 ? 2 : 1; index <= 20; index++) {
        const key = `${group}-${index}`;
        insertUser.run(
          `demo-campus-student-${key}`,
          `old-student-${key}@example.test`,
          `Прежний студент ${key}`,
          `preserved-student-hash-${key}`,
          'student',
          `demo-group-${group}`,
        );
      }
    }
    before = Object.fromEntries(
      protectedTables.map((table) => [
        table,
        sqlite.prepare(`SELECT * FROM ${table} ORDER BY 1`).all(),
      ]),
    );
    oldLessons = sqlite.prepare('SELECT * FROM school_lessons').all();
    oldAssignments = sqlite.prepare('SELECT * FROM school_assignments').all();
  });
  await seedAcademicData(db, { academicYear: 2026 });
  for (const table of protectedTables) {
    const expanded = await rows(db, table);
    for (const old of before[table]) {
      const key =
        table === 'auth_sessions'
          ? 'token_hash'
          : table === 'school_grades' || table === 'school_attendance'
            ? 'lesson_id'
            : 'id';
      const current = expanded.find((row) => row[key] === old[key]);
      assert.deepEqual(current, old, `Preserve original ${table} row ${old[key]}`);
    }
  }
  for (const [table, originals] of [
    ['school_lessons', oldLessons],
    ['school_assignments', oldAssignments],
  ]) {
    for (const original of originals) {
      const current = await db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(original.id);
      assert.deepEqual(
        Object.fromEntries(Object.keys(original).map((key) => [key, current[key]])),
        { ...original },
      );
      if (table === 'school_assignments') assert.equal(current.lesson_id, null);
    }
  }
  assert.ok(await db.prepare("SELECT 1 FROM school_groups WHERE id='demo-group-1'").get());
  assert.ok(
    await db
      .prepare(
        "SELECT 1 FROM school_groups WHERE id='manual-group' AND name='Ручная группа' AND version=5",
      )
      .get(),
  );
  assert.ok(await db.prepare("SELECT 1 FROM school_subjects WHERE id='demo-subject-1'").get());
  assert.ok(await db.prepare("SELECT 1 FROM school_rooms WHERE id='demo-room-1'").get());
  assert.ok(
    await db
      .prepare(
        "SELECT 1 FROM school_teaching_assignments WHERE teacher_id='demo-teacher-1' AND group_id='demo-group-1' AND subject_id='demo-subject-1'",
      )
      .get(),
  );
  // This is the same group ownership relation used to authorize a student's old work.
  assert.ok(
    await db
      .prepare(
        `SELECT 1 FROM school_submissions s
    JOIN school_assignments a ON a.id=s.assignment_id JOIN auth_users u ON u.id=s.student_id
    WHERE s.id='legacy-submission' AND u.group_id=a.group_id AND a.id='legacy-assignment'`,
      )
      .get(),
  );
  const teachers = await db
    .prepare("SELECT count(*) AS count FROM auth_users WHERE role='teacher'")
    .get();
  assert.equal(teachers.count, 18, 'Reuse the existing teacher instead of adding 18 more');
  assert.equal(
    (await db.prepare("SELECT count(*) AS count FROM auth_users WHERE role='student'").get()).count,
    360,
  );
  assert.equal(
    (await db.prepare('SELECT count(*) AS count FROM school_groups').get()).count,
    19,
    '18 academic groups plus the untouched manual group',
  );
  assertNoConflicts(await rows(db, 'school_lessons'));
  assert.deepEqual(await db.prepare('PRAGMA foreign_key_check').all(), []);
  const tables = [
    ...protectedTables,
    'school_groups',
    'school_subjects',
    'school_rooms',
    'school_assignments',
    'school_lessons',
    'school_academic_seed_map',
  ];
  const expanded = await Promise.all(tables.map((table) => rows(db, table)));
  await seedAcademicData(db, { academicYear: 2026 });
  assert.deepEqual(await Promise.all(tables.map((table) => rows(db, table))), expanded);
});
