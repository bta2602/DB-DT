import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getDatabase, closeDatabase } from '../database/connection.mjs';
import { migrateSqliteAcademic } from '../database/migrations/academic-data.mjs';
import {
  bootstrapFor,
  saveAcademicConfig,
  saveAssignment,
  saveDirectory,
  saveLesson,
} from '../lib/studyhub/auth-store.mjs';

test('Backend edits work with explicit academic data constraints', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'studyhub-academic-backend-'));
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
      sqlite.exec(`
        INSERT INTO auth_users(id,name,email,password_hash,role,created_at) VALUES ('legacy-teacher','Legacy','legacy@example.test','unused','teacher',0);
        INSERT INTO school_groups(id,name,name_key,course,program,intake_year,language) VALUES ('legacy-group','Legacy','legacy',1,'VTIPO',2090,'kk');
        INSERT INTO school_subjects(id,name,name_key) VALUES ('legacy-subject','Legacy','legacy');
        INSERT INTO school_rooms(id,name,name_key,capacity) VALUES ('legacy-room','Legacy','legacy',24);
        INSERT INTO school_teaching_assignments(teacher_id,group_id,subject_id) VALUES ('legacy-teacher','legacy-group','legacy-subject');
        INSERT INTO school_lessons(id,group_id,subject_id,teacher_id,room_id,starts_at,ends_at,kind,status)
          VALUES ('legacy-practice','legacy-group','legacy-subject','legacy-teacher','legacy-room','2090-10-03T03:30:00.000Z','2090-10-03T04:50:00.000Z','Практика','scheduled');
        INSERT INTO school_lessons(id,group_id,subject_id,teacher_id,room_id,starts_at,ends_at,kind,status,practice_id)
          VALUES ('legacy-srsp','legacy-group','legacy-subject','legacy-teacher',NULL,NULL,NULL,'srsp','scheduled','legacy-practice');
      `);
      migrateSqliteAcademic(sqlite);
    } finally {
      sqlite.close();
    }
    const db = await getDatabase();
    for (const [id, role] of [
      ['admin', 'admin'],
      ['teacher', 'teacher'],
      ['other-teacher', 'teacher'],
      ['student', 'student'],
    ])
      await db
        .prepare(
          'INSERT INTO auth_users(id,name,email,password_hash,role,created_at) VALUES (?,?,?,?,?,?)',
        )
        .run(id, id, `${id}@example.test`, 'isolated-test-no-login', role, 0);
    await db
      .prepare(
        "INSERT INTO school_groups(id,name,name_key,course,program,intake_year,language) VALUES ('group','ИС-90А','ис-90а',1,'IS',2090,'kk')",
      )
      .run();
    await db.prepare("UPDATE auth_users SET group_id='group' WHERE id='student'").run();
    for (const id of ['subject', 'unused-subject'])
      await db
        .prepare('INSERT INTO school_subjects(id,name,name_key) VALUES (?,?,?)')
        .run(id, id, id);
    await db
      .prepare(
        "INSERT INTO school_rooms(id,name,name_key,capacity,number,floor,type) VALUES ('room','101','101',24,'101',1,'computer')",
      )
      .run();
    const admin = { id: 'admin' };
    await saveAcademicConfig(admin, 'teacher-subjects', {
      teacherId: 'legacy-teacher',
      subjectIds: ['legacy-subject'],
    });
    await saveAcademicConfig(admin, 'teacher-languages', {
      teacherId: 'legacy-teacher',
      languages: ['kk'],
    });
    await saveAcademicConfig(admin, 'group-subjects', {
      groupId: 'legacy-group',
      academicYear: 2090,
      semester: 1,
      subjectIds: ['legacy-subject'],
    });
    await saveAssignment(
      { id: 'legacy-teacher' },
      {
        subjectId: 'legacy-subject',
        groupId: 'legacy-group',
        teacherId: 'legacy-teacher',
        lessonId: 'legacy-practice',
        title: 'Историческая практика',
        description: 'Сохранённое занятие доступно.',
        steps: [],
        dueAt: '2090-12-01T18:00:00.000Z',
      },
    );
    assert.equal(
      (
        await db
          .prepare("SELECT type FROM school_assignments WHERE lesson_id='legacy-practice'")
          .get()
      ).type,
      'practice',
    );
    await saveLesson(admin, {
      subjectId: 'legacy-subject',
      groupId: 'legacy-group',
      teacherId: 'legacy-teacher',
      practiceId: 'legacy-practice',
      kind: 'srsp',
      note: 'new srsp of old practice',
    });
    await saveLesson(admin, { note: 'historical note', version: 1 }, 'legacy-practice');
    await saveLesson(admin, { date: '2090-10-04', slotId: 'p1', version: 2 }, 'legacy-practice');
    const legacyLesson = await db
      .prepare("SELECT * FROM school_lessons WHERE id='legacy-practice'")
      .get();
    assert.equal(legacyLesson.kind, 'practice');
    assert.equal(legacyLesson.academic_year, 2090);
    await saveLesson(
      admin,
      { status: 'cancelled', version: legacyLesson.version },
      'legacy-practice',
    );
    for (const teacherId of ['teacher', 'other-teacher']) {
      await saveAcademicConfig(admin, 'teacher-subjects', { teacherId, subjectIds: ['subject'] });
      await saveAcademicConfig(admin, 'teacher-languages', { teacherId, languages: ['kk'] });
    }
    const curriculum = {
      groupId: 'group',
      academicYear: 2090,
      semester: 1,
      subjectIds: ['subject'],
    };
    await saveAcademicConfig(admin, 'group-subjects', curriculum);
    for (const teacherId of ['teacher', 'other-teacher'])
      await saveDirectory(admin, 'teaching-assignments', {
        teacherId,
        groupId: 'group',
        subjectId: 'subject',
        date: '2090-11-06',
      });

    const lessonInput = {
      subjectId: 'subject',
      groupId: 'group',
      teacherId: 'teacher',
      roomId: 'room',
      date: '2090-11-06',
      slotId: 'p1',
      kind: 'practice',
      note: 'integration practice',
    };
    await saveLesson(admin, lessonInput);
    let practice = await db
      .prepare("SELECT * FROM school_lessons WHERE note='integration practice'")
      .get();
    assert.equal(practice.academic_year, 2090);
    assert.equal(practice.semester, 1);
    await saveLesson(admin, {
      subjectId: 'subject',
      groupId: 'group',
      teacherId: 'teacher',
      practiceId: practice.id,
      kind: 'srsp',
      note: 'integration srsp',
    });
    const srsp = await db
      .prepare("SELECT * FROM school_lessons WHERE note='integration srsp'")
      .get();
    assert.equal(srsp.academic_year, 2090);
    assert.equal(srsp.starts_at, null);
    await assert.rejects(
      () =>
        saveLesson(admin, {
          subjectId: 'subject',
          groupId: 'group',
          teacherId: 'other-teacher',
          practiceId: practice.id,
          kind: 'srsp',
        }),
      { code: 'INVALID_PRACTICE' },
    );
    await saveAssignment(
      { id: 'teacher' },
      {
        subjectId: 'subject',
        groupId: 'group',
        teacherId: 'teacher',
        lessonId: srsp.id,
        title: 'Связанное задание',
        description: 'Проверьте модель данных.',
        steps: ['Подготовьте отчёт.'],
        dueAt: '2090-12-01T18:00:00.000Z',
      },
    );
    const assignment = await db
      .prepare('SELECT * FROM school_assignments WHERE lesson_id=?')
      .get(srsp.id);
    assert.equal(assignment.type, 'srsp');

    // Saving the same configuration must retain referenced rows instead of deleting them.
    await saveAcademicConfig(admin, 'teacher-subjects', {
      teacherId: 'teacher',
      subjectIds: ['subject'],
    });
    await saveAcademicConfig(admin, 'teacher-languages', {
      teacherId: 'teacher',
      languages: ['kk'],
    });
    await saveAcademicConfig(admin, 'group-subjects', curriculum);
    await saveAcademicConfig(admin, 'teacher-subjects', {
      teacherId: 'teacher',
      subjectIds: ['subject', 'unused-subject'],
    });
    await saveAcademicConfig(admin, 'teacher-subjects', {
      teacherId: 'teacher',
      subjectIds: ['subject'],
    });
    await saveAcademicConfig(admin, 'teacher-languages', {
      teacherId: 'teacher',
      languages: ['kk', 'ru'],
    });
    await saveAcademicConfig(admin, 'teacher-languages', {
      teacherId: 'teacher',
      languages: ['kk'],
    });
    await assert.rejects(
      () => saveAcademicConfig(admin, 'teacher-subjects', { teacherId: 'teacher', subjectIds: [] }),
      { code: 'ACADEMIC_ASSIGNMENT_IN_USE' },
    );

    await saveLesson(
      admin,
      { date: '2090-11-07', slotId: 'p2', version: practice.version },
      practice.id,
    );
    practice = await db.prepare('SELECT * FROM school_lessons WHERE id=?').get(practice.id);
    assert.equal(practice.slot_id, 'p2');
    assert.equal(practice.semester, 1);
    const data = await bootstrapFor({ id: 'admin', role: 'admin' });
    assert.equal(data.lessons.find((lesson) => lesson.id === srsp.id).date, '2090-11-07');
    await saveAcademicConfig(admin, 'group-subjects', { ...curriculum, semester: 2 });
    await assert.rejects(
      () =>
        saveLesson(
          admin,
          { date: '2091-01-08', slotId: 'p2', version: practice.version },
          practice.id,
        ),
      { code: 'PRACTICE_IN_USE' },
    );
    assert.equal(
      (await db.prepare('SELECT semester FROM school_lessons WHERE id=?').get(practice.id))
        .semester,
      1,
    );
    // A protected historical lesson must produce a domain conflict, not a SQL-trigger 500.
    await saveLesson(admin, { status: 'cancelled', version: practice.version }, practice.id);
    await saveLesson(admin, { status: 'cancelled', version: srsp.version }, srsp.id);
    await saveAcademicConfig(admin, 'group-subjects', { ...curriculum, academicYear: 2001 });
    await saveLesson(admin, {
      ...lessonInput,
      date: '2001-11-06',
      note: 'historical academic practice',
    });
    const group = await db.prepare("SELECT * FROM school_groups WHERE id='group'").get();
    const groupInput = { name: group.name, course: 1, version: group.version };
    for (const change of [{ program: null }, { intakeYear: null }])
      await assert.rejects(
        () => saveDirectory(admin, 'groups', { ...groupInput, ...change }, group.id),
        { code: 'GROUP_ACADEMIC_IN_USE' },
      );
    for (const language of [null, 'ru'])
      await assert.rejects(
        () => saveDirectory(admin, 'groups', { ...groupInput, language }, group.id),
        { code: 'GROUP_LANGUAGE_IN_USE' },
      );
    assert.equal(
      (await db.prepare('SELECT language FROM school_groups WHERE id=?').get(group.id)).language,
      'kk',
    );
  } finally {
    await closeDatabase();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    const resolved = await realpath(directory);
    assert.equal(dirname(resolved), await realpath(tmpdir()));
    assert.ok(basename(resolved).startsWith('studyhub-academic-backend-'));
    await rm(resolved, { recursive: true, force: true });
  }
});
