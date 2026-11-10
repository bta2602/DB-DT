import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import {
  lessonSlots,
  lessonInterval,
  lessonPeriod,
  validateLessonDate,
  campusDate,
  findLessonConflict,
} from '../lib/studyhub/lesson-rules.mjs';

test('Fixed pairs, calendar validation and interval boundaries', () => {
  assert.equal(lessonSlots.length, 9);
  assert.equal(lessonInterval('2026-11-10', 'p1').startsAt, '2026-11-10T03:00:00.000Z');
  assert.equal(lessonSlots[3].start, '10:55');
  assert.equal(lessonSlots[6].start, '13:50');
  assert.equal(validateLessonDate('2028-02-29'), '2028-02-29');
  for (const date of ['2026-02-29', '2026-02-31', '2026-13-01', '2026-2-01', null])
    assert.throws(() => validateLessonDate(date));
  assert.throws(() => lessonInterval('2026-11-10', 'p10'));
  assert.deepEqual(lessonPeriod('2026-08-31'), { academicYear: 2025, semester: 2 });
  assert.deepEqual(lessonPeriod('2026-09-01'), { academicYear: 2026, semester: 1 });
  assert.deepEqual(lessonPeriod('2027-01-01'), { academicYear: 2026, semester: 2 });
  assert.equal(campusDate('2026-11-09T20:00:00Z'), '2026-11-10');
  const base = {
    id: 'a',
    groupId: 'g',
    teacherId: 't',
    roomId: 'r',
    kind: 'practice',
    status: 'scheduled',
    ...lessonInterval('2026-11-10', 'p1'),
  };
  assert.equal(findLessonConflict(base, [base]), undefined);
  assert.equal(
    findLessonConflict(base, [
      { ...base, id: 'b', startsAt: base.endsAt, endsAt: '2026-11-10T05:00:00Z' },
    ]),
    undefined,
  );
  assert.ok(findLessonConflict(base, [{ ...base, id: 'b' }]));
  assert.equal(findLessonConflict(base, [{ ...base, id: 'b', status: 'cancelled' }]), undefined);
});

test('Academic rules protect real storage and retain historical records', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'studyhub-academic-rules-'));
  process.env.DATABASE_URL = '';
  process.env.STUDYHUB_DATA_DIR = directory;
  process.env.STUDYHUB_DEMO_MODE = 'false';
  const { getDatabase, closeDatabase } = await import('../database/connection.mjs');
  const { saveAcademicConfig, saveDirectory, saveLesson, bootstrapFor, getRoomAvailability } =
    await import('../lib/studyhub/auth-store.mjs');
  const admin = { id: 'admin' };
  try {
    const db = await getDatabase();
    for (const [id, role] of [
      ['admin', 'admin'],
      ['teacher', 'teacher'],
      ['teacher2', 'teacher'],
      ['student', 'student'],
      ['student2', 'student'],
      ['outsider', 'student'],
    ])
      await db
        .prepare(
          'INSERT INTO auth_users(id,name,email,password_hash,role,created_at) VALUES (?,?,?,?,?,?)',
        )
        .run(id, id, id + '@test.example', 'unused-test-hash', role, 0);
    for (const id of ['g', 'g2'])
      await db
        .prepare('INSERT INTO school_groups(id,name,name_key,course,language) VALUES (?,?,?,?,?)')
        .run(id, id, id, 1, 'kk');
    await db.prepare("UPDATE auth_users SET group_id='g' WHERE id IN ('student','student2')").run();
    await db.prepare("UPDATE auth_users SET group_id='g2' WHERE id='outsider'").run();
    for (const id of ['s', 's2', 's3', 's4'])
      await db
        .prepare('INSERT INTO school_subjects(id,name,name_key) VALUES (?,?,?)')
        .run(id, id, id);
    for (const [id, capacity] of [
      ['r', 25],
      ['r2', 25],
      ['small', 1],
    ])
      await db
        .prepare('INSERT INTO school_rooms(id,name,name_key,capacity) VALUES (?,?,?,?)')
        .run(id, id, id, capacity);
    for (const teacherId of ['teacher', 'teacher2']) {
      await saveAcademicConfig(admin, 'teacher-subjects', {
        teacherId,
        subjectIds: ['s', 's2', 's3'],
      });
      await saveAcademicConfig(admin, 'teacher-languages', { teacherId, languages: ['kk'] });
    }
    for (const groupId of ['g', 'g2'])
      await saveAcademicConfig(admin, 'group-subjects', {
        groupId,
        academicYear: 2090,
        semester: 1,
        subjectIds: ['s'],
      });
    const ordinary = {
      groupId: 'g',
      subjectId: 's',
      teacherId: 'teacher',
      roomId: 'r',
      date: '2090-11-05',
      slotId: 'p1',
      kind: 'lecture',
    };
    await assert.rejects(() => saveLesson(admin, ordinary), {
      code: 'TEACHING_ASSIGNMENT_REQUIRED',
    });
    assert.equal(
      (await db.prepare('SELECT COUNT(*) AS total FROM school_teaching_assignments').get()).total,
      0,
    );
    await saveDirectory(admin, 'teaching-assignments', {
      groupId: 'g',
      subjectId: 's',
      teacherId: 'teacher',
      date: ordinary.date,
    });
    await saveDirectory(admin, 'teaching-assignments', {
      groupId: 'g2',
      subjectId: 's',
      teacherId: 'teacher2',
      date: ordinary.date,
    });

    await t.test('Capabilities, language, slot and capacity are checked', async () => {
      await assert.rejects(
        () =>
          saveAcademicConfig(admin, 'teacher-subjects', {
            teacherId: 'teacher',
            subjectIds: ['s', 's2', 's3', 's4'],
          }),
        { code: 'INVALID_ACADEMIC_LIST' },
      );
      await assert.rejects(
        () =>
          saveAcademicConfig({ id: 'student' }, 'teacher-subjects', {
            teacherId: 'teacher',
            subjectIds: [],
          }),
        { code: 'FORBIDDEN' },
      );
      await assert.rejects(() => saveLesson(admin, { ...ordinary, subjectId: 's2' }), {
        code: 'SUBJECT_NOT_IN_CURRICULUM',
      });
      await assert.rejects(() => saveLesson(admin, { ...ordinary, slotId: 'p10' }), {
        code: 'INVALID_INTERVAL',
      });
      await assert.rejects(
        () => saveLesson(admin, { ...ordinary, date: undefined, slotId: undefined }),
        { code: 'INVALID_INTERVAL' },
      );
      await assert.rejects(() => saveLesson(admin, { ...ordinary, roomId: 'small' }), {
        code: 'ROOM_CAPACITY',
      });
      await saveAcademicConfig(admin, 'teacher-languages', {
        teacherId: 'teacher',
        languages: ['ru'],
      });
      await assert.rejects(() => saveLesson(admin, ordinary), {
        code: 'TEACHER_LANGUAGE_NOT_ALLOWED',
      });
      await saveAcademicConfig(admin, 'teacher-languages', {
        teacherId: 'teacher',
        languages: ['kk'],
      });
    });

    await t.test('Concurrent saves cannot double-book a room', async () => {
      const first = { ...ordinary, note: 'winner-1' };
      const second = { ...ordinary, groupId: 'g2', teacherId: 'teacher2', note: 'winner-2' };
      const outcomes = await Promise.allSettled([
        saveLesson(admin, first),
        saveLesson(admin, second),
      ]);
      assert.equal(outcomes.filter((item) => item.status === 'fulfilled').length, 1);
      assert.equal(
        outcomes.find((item) => item.status === 'rejected').reason.code,
        'SCHEDULE_CONFLICT',
      );
      const availability = await getRoomAvailability(
        { id: 'outsider' },
        { date: ordinary.date, slotId: 'p1', groupId: 'g2' },
      );
      assert.equal(availability.rooms.find((room) => room.roomId === 'r').available, false);
      assert.deepEqual(
        Object.keys(availability.rooms[0]).sort(),
        ['available', 'busyUntil', 'capacityOk', 'roomId'].sort(),
      );
      await assert.rejects(
        () =>
          getRoomAvailability(
            { id: 'student' },
            { date: ordinary.date, slotId: 'p1', groupId: 'g2' },
          ),
        { code: 'FORBIDDEN' },
      );
      await assert.rejects(
        () =>
          saveAcademicConfig(admin, 'teacher-subjects', { teacherId: 'teacher', subjectIds: [] }),
        { code: 'ACADEMIC_ASSIGNMENT_IN_USE' },
      );
    });

    await t.test(
      'SRSP follows practice without reserving a room or losing its own status',
      async () => {
        await saveLesson(admin, {
          ...ordinary,
          kind: 'practice',
          slotId: 'p3',
          note: 'parent-practice',
        });
        let practice = await db
          .prepare("SELECT * FROM school_lessons WHERE note='parent-practice'")
          .get();
        const srsp = {
          groupId: 'g',
          subjectId: 's',
          teacherId: 'teacher',
          kind: 'srsp',
          practiceId: practice.id,
          note: 'linked-srsp',
        };
        await assert.rejects(() => saveLesson(admin, { ...srsp, roomId: 'r' }), {
          code: 'SRSP_INHERITS_PRACTICE',
        });
        await saveLesson(admin, srsp);
        const child = await db
          .prepare("SELECT * FROM school_lessons WHERE note='linked-srsp'")
          .get();
        assert.equal(child.room_id, null);
        assert.equal(child.starts_at, null);
        assert.equal(child.slot_id, null);
        await assert.rejects(
          () => saveLesson(admin, { kind: 'lecture', version: practice.version }, practice.id),
          { code: 'PRACTICE_IN_USE' },
        );
        await saveLesson(
          admin,
          { date: '2090-11-06', slotId: 'p4', version: practice.version },
          practice.id,
        );
        practice = await db.prepare('SELECT * FROM school_lessons WHERE id=?').get(practice.id);
        let visible = (await bootstrapFor(admin)).lessons.find((item) => item.id === child.id);
        assert.equal(visible.date, '2090-11-06');
        assert.equal(visible.status, 'scheduled');
        await saveLesson(admin, { status: 'cancelled', version: practice.version }, practice.id);
        visible = (await bootstrapFor(admin)).lessons.find((item) => item.id === child.id);
        assert.equal(visible.status, 'cancelled');
        assert.equal(
          (await db.prepare('SELECT status FROM school_lessons WHERE id=?').get(child.id)).status,
          'scheduled',
        );
        practice = await db.prepare('SELECT * FROM school_lessons WHERE id=?').get(practice.id);
        await saveLesson(admin, { status: 'scheduled', version: practice.version }, practice.id);
        assert.equal(
          (await bootstrapFor(admin)).lessons.find((item) => item.id === child.id).status,
          'scheduled',
        );
      },
    );

    await t.test('Linked legacy lesson can move without changing its semantic type', async () => {
      await db
        .prepare(
          `INSERT INTO school_lessons(id,group_id,subject_id,teacher_id,room_id,starts_at,ends_at,kind,status)
        VALUES ('legacy-linked','g','s','teacher','r','2090-11-07T03:00:00.000Z','2090-11-07T03:50:00.000Z','Практика','scheduled')`,
        )
        .run();
      await db
        .prepare(
          `INSERT INTO school_assignments(id,group_id,subject_id,teacher_id,title,type,description,steps_json,due_at,lesson_id)
        VALUES ('legacy-task','g','s','teacher','Existing work','Практическая работа','Keep this work','[]','2090-12-01T10:00:00.000Z','legacy-linked')`,
        )
        .run();
      await saveLesson(admin, { date: '2090-11-08', slotId: 'p5', version: 1 }, 'legacy-linked');
      assert.equal(
        (await db.prepare("SELECT kind FROM school_lessons WHERE id='legacy-linked'").get()).kind,
        'practice',
      );
      assert.equal(
        (await db.prepare("SELECT due_at FROM school_assignments WHERE id='legacy-task'").get())
          .due_at,
        '2090-12-01T10:00:00.000Z',
      );
    });

    await t.test(
      'Ongoing lessons and linked SRSP protect capabilities, language and room capacity',
      async () => {
        for (const id of ['current-teacher', 'current-child-teacher']) {
          await db
            .prepare(
              'INSERT INTO auth_users(id,name,email,password_hash,role,created_at) VALUES (?,?,?,?,?,?)',
            )
            .run(id, id, id + '@test.example', 'unused-test-hash', 'teacher', 0);
          await saveAcademicConfig(admin, 'teacher-subjects', {
            teacherId: id,
            subjectIds: ['s4'],
          });
          await saveAcademicConfig(admin, 'teacher-languages', {
            teacherId: id,
            languages: ['kk'],
          });
        }
        await db
          .prepare(
            "INSERT INTO school_groups(id,name,name_key,course,language,intake_year) VALUES ('current-group','current-group','current-group',1,'kk',?)",
          )
          .run(lessonPeriod(campusDate()).academicYear - 1);
        const period = lessonPeriod(campusDate());
        await saveAcademicConfig(admin, 'group-subjects', {
          groupId: 'current-group',
          ...period,
          subjectIds: ['s4'],
        });
        const now = Date.now();
        await db
          .prepare(
            `INSERT INTO school_lessons(id,group_id,subject_id,teacher_id,room_id,starts_at,ends_at,kind,status)
        VALUES ('ongoing','current-group','s4','current-teacher','small',?,?,'Практика','scheduled')`,
          )
          .run(new Date(now - 60000).toISOString(), new Date(now + 60000).toISOString());
        await db
          .prepare(
            `INSERT INTO school_lessons(id,group_id,subject_id,teacher_id,room_id,starts_at,ends_at,kind,status,practice_id)
        VALUES ('ongoing-srsp','current-group','s4','current-child-teacher',NULL,NULL,NULL,'srsp','scheduled','ongoing')`,
          )
          .run();
        await assert.rejects(
          () =>
            saveAcademicConfig(admin, 'teacher-subjects', {
              teacherId: 'current-child-teacher',
              subjectIds: [],
            }),
          { code: 'ACADEMIC_ASSIGNMENT_IN_USE' },
        );
        await assert.rejects(
          () =>
            saveAcademicConfig(admin, 'teacher-languages', {
              teacherId: 'current-child-teacher',
              languages: ['ru'],
            }),
          { code: 'ACADEMIC_ASSIGNMENT_IN_USE' },
        );
        await assert.rejects(
          () =>
            saveAcademicConfig(admin, 'group-subjects', {
              groupId: 'current-group',
              ...period,
              subjectIds: [],
            }),
          { code: 'ACADEMIC_ASSIGNMENT_IN_USE' },
        );
        await assert.rejects(
          () =>
            saveDirectory(
              admin,
              'groups',
              { name: 'current-group', course: 2, curatorId: null, language: 'ru', version: 1 },
              'current-group',
            ),
          { code: 'GROUP_LANGUAGE_IN_USE' },
        );
        await saveDirectory(
          admin,
          'users',
          {
            name: 'Outsider',
            email: 'outsider@test.example',
            role: 'student',
            groupId: 'current-group',
            version: 1,
          },
          'outsider',
        );
        await assert.rejects(
          () =>
            saveDirectory(
              admin,
              'users',
              {
                name: 'Student',
                email: 'student@test.example',
                role: 'student',
                groupId: 'current-group',
                version: 1,
              },
              'student',
            ),
          { code: 'GROUP_ROOM_CAPACITY' },
        );
        assert.equal(
          (await bootstrapFor(admin)).groups.find((group) => group.id === 'current-group').course,
          2,
        );
      },
    );

    await t.test('Historical arbitrary intervals remain readable and cancellable', async () => {
      await db
        .prepare(
          `INSERT INTO school_lessons(id,group_id,subject_id,teacher_id,room_id,starts_at,ends_at,kind,status)
        VALUES ('historical','g','s','teacher','r','2024-01-01T03:30:00.000Z','2024-01-01T04:50:00.000Z','Лекция','scheduled')`,
        )
        .run();
      await saveLesson(admin, { status: 'cancelled', version: 1 }, 'historical');
      assert.equal(
        (await bootstrapFor(admin)).lessons.find((item) => item.id === 'historical').endsAt,
        '2024-01-01T04:50:00.000Z',
      );
    });
  } finally {
    await closeDatabase();
    assert.equal(dirname(directory), tmpdir());
    assert.ok(basename(directory).startsWith('studyhub-academic-rules-'));
    await rm(directory, { recursive: true, force: true });
  }
});
