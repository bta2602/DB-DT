import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { TestClient } from './http-client.mjs';
import { campusDate, lessonInterval, lessonPeriod } from '../lib/studyhub/lesson-rules.mjs';

const baseUrl = process.env.TEST_BASE_URL;

test(
  'Academic HTTP API: authorization, room occupancy, linked work and SRSP',
  {
    skip: !baseUrl && 'Run through npm test against its isolated server.',
  },
  async (t) => {
    assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseUrl).hostname));
    const admin = new TestClient(baseUrl);
    const teacher = new TestClient(baseUrl);
    const student = new TestClient(baseUrl);
    const guest = new TestClient(baseUrl);
    await admin.demo('admin');
    await guest.session();
    const tag = randomUUID().slice(0, 8);
    const password = randomUUID() + 'A9!';
    const date = campusDate(Date.now() + 90 * 86400000);
    const movedDate = campusDate(Date.parse(`${date}T12:00:00+05:00`) + 86400000);
    const periods = new Map(
      [date, movedDate].map((value) => {
        const period = lessonPeriod(value);
        return [JSON.stringify(period), period];
      }),
    );
    const config = (kind, body, status = 200) =>
      admin.call(`/api/academic/${kind}`, { method: 'PUT', body }, status);
    const users = [];
    const groups = [];
    for (const index of [1, 2]) {
      const email = `academic-${tag}-${index}@example.test`;
      await admin.call('/api/users', {
        method: 'POST',
        body: {
          name: `Учитель ${tag}-${index}`,
          email,
          password,
          role: 'teacher',
          groupId: null,
        },
      });
      users.push((await admin.bootstrap()).users.find((item) => item.email === email));
      const name = `Учебная группа ${tag}-${index}`;
      await admin.call('/api/groups', {
        method: 'POST',
        body: { name, course: 2, language: 'kk', curatorId: users.at(-1).id },
      });
      groups.push((await admin.bootstrap()).groups.find((item) => item.name === name));
    }
    const subjectIds = [];
    for (let index = 0; index < 4; index++) {
      const name = `Дисциплина ${tag}-${index}`;
      await admin.call('/api/subjects', { method: 'POST', body: { name } });
      subjectIds.push((await admin.bootstrap()).subjects.find((item) => item.name === name).id);
    }
    const roomName = `Аудитория ${tag}`;
    await admin.call('/api/rooms', {
      method: 'POST',
      body: { name: roomName, capacity: 24, number: '205', floor: 2, type: 'computer' },
    });
    const room = (await admin.bootstrap()).rooms.find((item) => item.name === roomName);
    const email = `academic-student-${tag}@example.test`;
    await admin.call('/api/users', {
      method: 'POST',
      body: { name: `Студент ${tag}`, email, password, role: 'student', groupId: groups[0].id },
    });
    const studentUser = (await student.login(email, password)).user;
    await teacher.login(users[0].email, password);
    const common = {
      groupId: groups[0].id,
      subjectId: subjectIds[0],
      teacherId: users[0].id,
      roomId: room.id,
      date,
      slotId: 'p1',
      kind: 'practice',
    };
    let practice, srsp, assignment;

    await t.test('Academic configuration is admin-only and limited to three subjects', async () => {
      const path = '/api/academic/teacher-subjects';
      const body = { teacherId: users[0].id, subjectIds: [subjectIds[0]] };
      await guest.call(path, { method: 'PUT', body }, 401);
      await student.call(path, { method: 'PUT', body }, 403);
      await teacher.call(path, { method: 'PUT', body }, 403);
      await admin.call(path, { method: 'PUT', body, headers: { 'X-CSRF-Token': '' } }, 403);
      await config('teacher-subjects', { teacherId: users[0].id, subjectIds }, 422);
      for (let index = 0; index < 2; index++) {
        await config('teacher-subjects', {
          teacherId: users[index].id,
          subjectIds: [subjectIds[0]],
        });
        await config('teacher-languages', { teacherId: users[index].id, languages: ['kk'] });
        for (const period of periods.values()) {
          await config('group-subjects', {
            groupId: groups[index].id,
            ...period,
            subjectIds: [subjectIds[0]],
          });
        }
      }
    });

    await t.test('Saving a lesson cannot grant an assignment; slots are validated', async () => {
      await admin.call('/api/lessons', { method: 'POST', body: common }, 422);
      assert.ok(
        !(await admin.bootstrap()).teachingAssignments.some(
          (item) => item.teacherId === users[0].id,
        ),
      );
      for (let index = 0; index < 2; index++) {
        await admin.call('/api/teaching-assignments', {
          method: 'PUT',
          body: {
            teacherId: users[index].id,
            groupId: groups[index].id,
            subjectId: subjectIds[0],
            date,
          },
        });
      }
      await admin.call('/api/lessons', { method: 'POST', body: { ...common, slotId: 'p99' } }, 422);
      await admin.call(
        '/api/lessons',
        { method: 'POST', body: { ...common, subjectId: subjectIds[1] } },
        422,
      );
      const results = await Promise.all([
        admin.call('/api/lessons', { method: 'POST', body: { ...common, note: tag } }, [200, 409]),
        admin.call('/api/lessons', { method: 'POST', body: { ...common, note: tag } }, [200, 409]),
      ]);
      assert.deepEqual(results.map((result) => result.response.status).sort(), [200, 409]);
      practice = (await admin.bootstrap()).lessons.find((item) => item.note === tag);
      assert.equal(practice.startsAt, lessonInterval(date, 'p1').startsAt);
    });

    await t.test(
      'Room availability includes invisible lessons without leaking their details',
      async () => {
        await admin.call('/api/lessons', {
          method: 'POST',
          body: {
            ...common,
            groupId: groups[1].id,
            teacherId: users[1].id,
            slotId: 'p2',
            note: `hidden-${tag}`,
          },
        });
        const hidden = (await admin.bootstrap()).lessons.find(
          (item) => item.note === `hidden-${tag}`,
        );
        assert.ok(!(await student.bootstrap()).lessons.some((item) => item.id === hidden.id));
        const path = `/api/rooms/availability?date=${date}&slotId=p2&groupId=${groups[0].id}`;
        await guest.call(path, {}, 401);
        const { data } = await student.call(path);
        const state = data.rooms.find((item) => item.roomId === room.id);
        assert.equal(state.available, false);
        assert.equal(state.capacityOk, true);
        assert.equal(state.busyUntil, hidden.endsAt);
        assert.deepEqual(Object.keys(state).sort(), [
          'available',
          'busyUntil',
          'capacityOk',
          'roomId',
        ]);
        await student.call(path.replace(groups[0].id, groups[1].id), {}, 403);
        await teacher.call(`${path}&excludeLessonId=${hidden.id}`, {}, 403);
        await admin.call(`${path}&slotId=p3`, {}, 422);
      },
    );

    await t.test('SRSP links to practice and assignments derive their type', async () => {
      const input = {
        groupId: groups[0].id,
        subjectId: subjectIds[0],
        teacherId: users[0].id,
        kind: 'srsp',
        practiceId: practice.id,
        note: `srsp-${tag}`,
      };
      await admin.call(
        '/api/lessons',
        { method: 'POST', body: { ...input, practiceId: null } },
        422,
      );
      await admin.call(
        '/api/lessons',
        { method: 'POST', body: { ...input, roomId: room.id } },
        422,
      );
      await admin.call('/api/lessons', { method: 'POST', body: input });
      srsp = (await admin.bootstrap()).lessons.find((item) => item.note === input.note);
      assert.equal(srsp.date, date);
      assert.equal(srsp.startsAt, null);
      assert.equal(srsp.endsAt, null);
      assert.equal(srsp.roomId, null);
      await teacher.call(
        `/api/lessons/${srsp.id}/grades/${studentUser.id}`,
        { method: 'PUT', body: { grade: null, status: 'absent', version: null } },
        422,
      );
      assignment = {
        title: `СРСП ${tag}`,
        description: 'Подготовить SQL-запрос.',
        steps: ['Проверить запрос'],
        subjectId: subjectIds[0],
        groupId: groups[0].id,
        teacherId: users[0].id,
        lessonId: srsp.id,
        dueAt: new Date(Date.now() + 120 * 86400000).toISOString(),
      };
      await teacher.call(
        '/api/assignments',
        { method: 'POST', body: { ...assignment, lessonId: null } },
        422,
      );
      await teacher.call(
        '/api/assignments',
        { method: 'POST', body: { ...assignment, type: 'wrong' } },
        422,
      );
      await teacher.call('/api/assignments', { method: 'POST', body: assignment });
      const saved = (await student.bootstrap()).assignments.find(
        (item) => item.title === assignment.title,
      );
      assert.equal(saved.type, 'srsp');
      assert.equal(saved.lessonId, srsp.id);
    });

    await t.test(
      'Practice move/cancellation propagates without changing published deadline',
      async () => {
        await config('teacher-subjects', { teacherId: users[0].id, subjectIds: [] }, 409);
        await config('teacher-languages', { teacherId: users[0].id, languages: ['ru'] }, 409);
        await config(
          'group-subjects',
          { groupId: groups[0].id, ...lessonPeriod(date), subjectIds: [] },
          409,
        );
        await admin.call(`/api/lessons/${practice.id}`, {
          method: 'PATCH',
          body: { date: movedDate, slotId: 'p4', version: practice.version },
        });
        let data = await admin.bootstrap();
        practice = data.lessons.find((item) => item.id === practice.id);
        assert.equal(data.lessons.find((item) => item.id === srsp.id).date, movedDate);
        await admin.call(`/api/lessons/${practice.id}`, {
          method: 'PATCH',
          body: { status: 'cancelled', version: practice.version },
        });
        data = await admin.bootstrap();
        assert.equal(data.lessons.find((item) => item.id === srsp.id).status, 'cancelled');
        assert.equal(
          data.assignments.find((item) => item.title === assignment.title).dueAt,
          assignment.dueAt,
        );
        await teacher.call(
          '/api/assignments',
          { method: 'POST', body: { ...assignment, title: 'Отменённая СРСП' } },
          422,
        );
      },
    );
  },
);
