import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getDatabase, closeDatabase } from '../database/connection.mjs';
import { migrateSqliteAcademic } from '../database/migrations/academic-data.mjs';
import {
  archiveLesson,
  bootstrapFor,
  getRoomAvailability,
  saveAcademicConfig,
  saveAssignment,
  saveDirectory,
  saveLesson,
  reviewSubmission,
  readLearningFile,
} from '../lib/studyhub/auth-store.mjs';

// Every check uses a new SQLite database, never .env.local or the shared Neon database.
test('Hidden lessons preserve learning history and release their timetable slot', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'studyhub-archive-backend-'));
  const previous = Object.fromEntries(
    ['DATABASE_URL', 'STUDYHUB_DATA_DIR', 'STUDYHUB_DEMO_MODE'].map((key) => [
      key,
      process.env[key],
    ]),
  );
  process.env.DATABASE_URL = '';
  process.env.STUDYHUB_DATA_DIR = directory;
  process.env.STUDYHUB_DEMO_MODE = 'false';
  try {
    await getDatabase();
    await closeDatabase();
    const sqlite = new DatabaseSync(join(directory, 'auth.sqlite'));
    try {
      migrateSqliteAcademic(sqlite);
    } finally {
      sqlite.close();
    }
    const db = await getDatabase();
    const admin = { id: 'admin' },
      teacher = { id: 'teacher' };
    for (const [id, role] of [
      ['admin', 'admin'],
      ['teacher', 'teacher'],
      ['student', 'student'],
    ])
      await db
        .prepare(
          'INSERT INTO auth_users(id,name,email,password_hash,role,created_at) VALUES (?,?,?,?,?,?)',
        )
        .run(id, id, `${id}@example.test`, 'not-a-login-password', role, 0);
    await db
      .prepare(
        "INSERT INTO school_groups(id,name,name_key,course,program,intake_year,language) VALUES ('group','ИС-90А','ис-90а',1,'IS',2090,'kk')",
      )
      .run();
    await db.prepare("UPDATE auth_users SET group_id='group' WHERE id='student'").run();
    await db
      .prepare(
        "INSERT INTO school_subjects(id,name,name_key) VALUES ('subject','Предмет','предмет')",
      )
      .run();
    for (const [id, number] of [
      ['room', '101'],
      ['room2', '1101'],
    ])
      await db
        .prepare(
          'INSERT INTO school_rooms(id,name,name_key,capacity,number,floor,type) VALUES (?,?,?,?,?,?,?)',
        )
        .run(id, number, number, 24, number, number === '101' ? 1 : 11, 'computer');
    await saveAcademicConfig(admin, 'teacher-subjects', {
      teacherId: 'teacher',
      subjectIds: ['subject'],
    });
    await saveAcademicConfig(admin, 'teacher-languages', {
      teacherId: 'teacher',
      languages: ['kk'],
    });
    await saveAcademicConfig(admin, 'group-subjects', {
      groupId: 'group',
      academicYear: 2090,
      semester: 1,
      subjectIds: ['subject'],
    });
    await saveDirectory(admin, 'teaching-assignments', {
      teacherId: 'teacher',
      groupId: 'group',
      subjectId: 'subject',
      date: '2090-11-06',
    });
    const common = {
      groupId: 'group',
      subjectId: 'subject',
      teacherId: 'teacher',
      roomId: 'room',
      date: '2090-11-06',
    };
    await saveLesson(admin, { ...common, kind: 'practice', slotId: 'p1', note: 'practice' });
    await saveLesson(admin, { ...common, kind: 'lecture', slotId: 'p3', note: 'lecture' });
    let practice = await db.prepare("SELECT * FROM school_lessons WHERE note='practice'").get();
    const lecture = await db.prepare("SELECT * FROM school_lessons WHERE note='lecture'").get();
    await saveLesson(admin, {
      groupId: 'group',
      subjectId: 'subject',
      teacherId: 'teacher',
      practiceId: practice.id,
      kind: 'srsp',
      note: 'srsp',
    });
    const srsp = await db.prepare("SELECT * FROM school_lessons WHERE note='srsp'").get();
    await saveLesson(
      admin,
      { date: '2090-11-07', slotId: 'p2', roomId: 'room2', version: practice.version },
      practice.id,
    );
    practice = await db.prepare('SELECT * FROM school_lessons WHERE id=?').get(practice.id);
    assert.deepEqual(
      await db.prepare('SELECT * FROM school_lessons WHERE id=?').get(lecture.id),
      lecture,
      'practice edits must not modify a lecture',
    );
    const linked = await db.prepare('SELECT * FROM school_lessons WHERE id=?').get(srsp.id);
    assert.equal(linked.practice_id, practice.id);
    assert.equal(linked.room_id, null, 'SRSP does not double-reserve its practice room');
    assert.equal(linked.starts_at, null);
    let data = await bootstrapFor(admin);
    assert.equal(data.lessons.find((row) => row.id === srsp.id).date, '2090-11-07');
    await saveLesson(
      admin,
      { slotId: 'p4', roomId: 'room2', date: '2090-11-06', version: lecture.version },
      lecture.id,
    );
    assert.deepEqual(
      await db.prepare('SELECT * FROM school_lessons WHERE id=?').get(practice.id),
      practice,
      'lecture edits must not modify a practice',
    );
    const work = {
      groupId: 'group',
      subjectId: 'subject',
      teacherId: 'teacher',
      lessonId: srsp.id,
      title: 'Работа',
      description: 'Сохранить историю.',
      steps: [],
      dueAt: '2090-12-01T18:00:00.000Z',
    };
    await saveAssignment(teacher, work);
    const assignment = await db
      .prepare('SELECT * FROM school_assignments WHERE lesson_id=?')
      .get(srsp.id);
    await db
      .prepare(
        "INSERT INTO school_grades(lesson_id,student_id,grade,status) VALUES (?,'student',84,'graded')",
      )
      .run(practice.id);
    await db
      .prepare(
        "INSERT INTO school_attendance(lesson_id,student_id,status) VALUES (?,'student','present')",
      )
      .run(practice.id);
    await db
      .prepare(
        "INSERT INTO school_files(id,name,mime_type,contents,bytes) VALUES ('file','work.txt','text/plain',?,1)",
      )
      .run(Buffer.from('a'));
    await db
      .prepare(
        "INSERT INTO school_submissions(id,assignment_id,student_id,file_id,status,submitted_at,grade,comment) VALUES ('submission',?,'student','file','reviewed','2090-11-06T10:00:00.000Z',91,'Сохранённый комментарий')",
      )
      .run(assignment.id);
    const tables = [
      'school_grades',
      'school_attendance',
      'school_assignments',
      'school_submissions',
      'school_files',
    ];
    const snapshots = await Promise.all(
      tables.map((table) => db.prepare(`SELECT * FROM ${table}`).all()),
    );
    const query = { groupId: 'group', date: '2090-11-07', slotId: 'p2' };
    assert.equal(
      (await getRoomAvailability(admin, query)).rooms.find((row) => row.roomId === 'room2')
        .available,
      false,
    );
    await assert.rejects(() => archiveLesson(teacher, practice.id, { version: practice.version }), {
      code: 'FORBIDDEN',
    });
    await assert.rejects(
      () => archiveLesson({ id: 'student' }, practice.id, { version: practice.version }),
      { code: 'FORBIDDEN' },
    );
    await assert.rejects(
      () => archiveLesson(admin, practice.id, { version: practice.version - 1 }),
      { code: 'VERSION_CONFLICT' },
    );
    await assert.rejects(
      () => archiveLesson(admin, practice.id, { version: practice.version, destroy: true }),
      { code: 'INVALID_BODY' },
    );
    await archiveLesson(admin, practice.id, { version: practice.version });
    const hidden = await db.prepare('SELECT * FROM school_lessons WHERE id=?').get(practice.id);
    const hiddenChild = await db.prepare('SELECT * FROM school_lessons WHERE id=?').get(srsp.id);
    assert.ok(hidden.archived_at);
    assert.equal(hiddenChild.archived_at, hidden.archived_at);
    assert.equal(hidden.status, 'scheduled');
    assert.equal(hidden.version, practice.version + 1);
    assert.equal(hiddenChild.version, srsp.version + 1);
    assert.equal(
      (await db.prepare('SELECT archived_at FROM school_lessons WHERE id=?').get(lecture.id))
        .archived_at,
      null,
    );
    assert.deepEqual(
      await Promise.all(tables.map((table) => db.prepare(`SELECT * FROM ${table}`).all())),
      snapshots,
      'all learning records and file bytes stay unchanged',
    );
    await assert.rejects(() => archiveLesson(admin, practice.id, { version: practice.version }), {
      code: 'VERSION_CONFLICT',
    });
    await archiveLesson(admin, practice.id, { version: hidden.version });
    assert.equal(
      (await db.prepare('SELECT version FROM school_lessons WHERE id=?').get(practice.id)).version,
      hidden.version,
      'repeat with current version is idempotent',
    );
    assert.equal(
      (await getRoomAvailability(admin, query)).rooms.find((row) => row.roomId === 'room2')
        .available,
      true,
    );
    await saveLesson(admin, {
      ...common,
      date: '2090-11-07',
      roomId: 'room2',
      slotId: 'p2',
      kind: 'lecture',
      note: 'replacement in freed slot',
    });
    await assert.rejects(
      () => saveLesson(admin, { note: 'edit hidden', version: hidden.version }, practice.id),
      { code: 'LESSON_ARCHIVED' },
    );
    await assert.rejects(
      () =>
        saveLesson(admin, {
          groupId: 'group',
          subjectId: 'subject',
          teacherId: 'teacher',
          practiceId: practice.id,
          kind: 'srsp',
        }),
      { code: 'INVALID_PRACTICE' },
    );
    await assert.rejects(() => saveAssignment(teacher, work), { code: 'LESSON_ARCHIVED' });
    for (const actor of [admin, teacher, { id: 'student' }]) {
      data = await bootstrapFor(actor);
      assert.ok(data.lessons.find((row) => row.id === practice.id)?.archivedAt);
      assert.equal(data.grades.find((row) => row.lessonId === practice.id).grade, 84);
      assert.ok(data.assignments.some((row) => row.id === assignment.id));
      assert.equal(data.submissions.find((row) => row.id === 'submission').grade, 91);
    }
    await reviewSubmission(teacher, 'submission', {
      action: 'grade',
      grade: 95,
      comment: 'Уточнённая оценка',
      version: 1,
    });
    assert.equal(
      (await db.prepare("SELECT grade FROM school_submissions WHERE id='submission'").get()).grade,
      95,
    );
    const file = await readLearningFile({ id: 'student' }, 'file');
    assert.ok(file, 'student can still download the submitted work');
    assert.equal((await db.prepare('PRAGMA foreign_key_check').all()).length, 0);
  } finally {
    await closeDatabase();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    const target = await realpath(directory);
    assert.equal(dirname(target), await realpath(tmpdir()));
    assert.ok(basename(target).startsWith('studyhub-archive-backend-'));
    await rm(target, { recursive: true, force: true });
  }
});
