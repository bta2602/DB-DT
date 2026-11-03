import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { TestClient, upload } from './http-client.mjs';
import { checkCampusData } from './campus-checks.mjs';

const baseUrl = process.env.TEST_BASE_URL || 'http://127.0.0.1:3101';
assert.ok(
  ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseUrl).hostname),
  'Integration tests must use an isolated local server.',
);

test('StudyHUB: API, permissions, forms and page routes', async (t) => {
  const suffix = randomUUID().slice(0, 8);
  const password = `${randomUUID()}A9!`;
  const admin = new TestClient(baseUrl);
  const teacher = new TestClient(baseUrl);
  const student = new TestClient(baseUrl);
  const peer = new TestClient(baseUrl);
  let teacherUser, studentUser, group, subject, room, lesson, assignment, submission;

  await t.test('Guest session, cookie flags and private API protection', async () => {
    const { data, response } = await admin.call('/api/session');
    assert.equal(data.user, null);
    assert.equal(data.demoEnabled, true);
    assert.match(data.csrfToken, /^[A-Za-z0-9_-]{43}$/);
    const cookie = response.headers.getSetCookie().join(';');
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    assert.match(response.headers.get('cache-control'), /no-store/);
    await admin.call('/api/bootstrap', {}, 401);
  });

  await t.test('Demo switch rotates sessions and rejects invalid roles / CSRF', async () => {
    const old = new TestClient(baseUrl);
    old.cookie = admin.cookie;
    const previousCookie = admin.cookie;
    const previousCsrf = admin.csrf;
    const session = await admin.demo('admin');
    assert.equal(session.user.role, 'admin');
    assert.notEqual(admin.cookie, previousCookie);
    assert.notEqual(admin.csrf, previousCsrf);
    await old.call('/api/bootstrap', {}, 401);
    await admin.call('/api/auth/demo', { method: 'POST', body: { role: 'owner' } }, 422);
    await admin.call(
      '/api/auth/demo',
      {
        method: 'POST',
        body: { role: 'teacher' },
        headers: { 'X-CSRF-Token': '' },
      },
      403,
    );
    await admin.call(
      '/api/auth/demo',
      {
        method: 'POST',
        body: { role: 'teacher' },
        headers: { Origin: 'https://other.example' },
      },
      403,
    );
    assert.equal((await admin.session()).user.role, 'admin');
  });

  await t.test('All three demo accounts have persisted and scoped data', async () => {
    const studentSession = await student.demo('student');
    const teacherSession = await teacher.demo('teacher');
    assert.equal(studentSession.user.role, 'student');
    assert.equal(teacherSession.user.role, 'teacher');
    const data = await admin.bootstrap();
    for (const key of [
      'users',
      'groups',
      'subjects',
      'rooms',
      'teachingAssignments',
      'lessons',
      'assignments',
      'submissions',
      'grades',
      'attendance',
      'materials',
      'announcements',
    ]) {
      assert.ok(Array.isArray(data[key]), `Missing collection: ${key}`);
      assert.ok(data[key].length, `Demo collection is empty: ${key}`);
    }
    checkCampusData(data);
    const privateKeys = /password|token|secret|contents/i;
    for (const user of data.users)
      assert.ok(!Object.keys(user).some((key) => privateKeys.test(key)));
    const scoped = await student.bootstrap();
    assert.ok(scoped.grades.every((row) => row.studentId === studentSession.user.id));
    assert.ok(scoped.submissions.every((row) => row.studentId === studentSession.user.id));
    assert.ok(scoped.lessons.every((row) => row.groupId === studentSession.user.groupId));
  });

  await t.test('Every navigation route returns a usable HTML page', async () => {
    const guest = new TestClient(baseUrl);
    const routes = [
      [guest, ['/', '/about', '/login', '/register']],
      [student, ['/today', '/schedule', '/subjects', '/tasks', '/profile']],
      [teacher, ['/journal', '/review', '/assignments', '/schedule', '/profile']],
      [admin, ['/overview', '/people', '/rooms', '/schedule', '/profile']],
    ];
    for (const [client, paths] of routes) {
      for (const path of paths) {
        const { response, data } = await client.call(path);
        assert.match(response.headers.get('content-type'), /text\/html/);
        assert.match(data, /StudyHUB/i, `Missing application content at ${path}`);
        if (path === '/about' && new URL(response.url).pathname !== '/') {
          // An async layout may start streaming before redirect() emits its refresh tag.
          assert.match(data, /<meta[^>]+http-equiv="refresh"[^>]+content="[^"]*url=\/"/i);
        }
      }
    }
    await guest.call('/page-that-does-not-exist', {}, 404);
    await guest.call('/studyhub/index.html');
  });

  await t.test('Admin creates teacher, group, subject, room and students', async () => {
    await admin.call('/api/users', {
      method: 'POST',
      body: {
        name: `Преподаватель ${suffix}`,
        email: `teacher-${suffix}@example.test`,
        role: 'teacher',
        groupId: null,
        password,
      },
    });
    teacherUser = (await admin.bootstrap()).users.find(
      (user) => user.email === `teacher-${suffix}@example.test`,
    );
    assert.ok(teacherUser);
    await admin.call('/api/groups', {
      method: 'POST',
      body: {
        name: `Группа ${suffix}`,
        course: 2,
        curatorId: teacherUser.id,
      },
    });
    await admin.call('/api/subjects', { method: 'POST', body: { name: `Предмет ${suffix}` } });
    await admin.call('/api/rooms', {
      method: 'POST',
      body: { name: `Аудитория ${suffix}`, capacity: 24 },
    });
    let data = await admin.bootstrap();
    group = data.groups.find((row) => row.name === `Группа ${suffix}`);
    subject = data.subjects.find((row) => row.name === `Предмет ${suffix}`);
    room = data.rooms.find((row) => row.name === `Аудитория ${suffix}`);
    for (const prefix of ['student', 'peer']) {
      await admin.call('/api/users', {
        method: 'POST',
        body: {
          name: `${prefix} ${suffix}`,
          email: `${prefix}-${suffix}@example.test`,
          role: 'student',
          groupId: group.id,
          password,
        },
      });
    }
    data = await admin.bootstrap();
    studentUser = data.users.find((user) => user.email === `student-${suffix}@example.test`);
    assert.equal(studentUser.groupId, group.id);
    await admin.call('/api/teaching-assignments', {
      method: 'PUT',
      body: {
        teacherId: teacherUser.id,
        groupId: group.id,
        subjectId: subject.id,
      },
    });
    await teacher.login(teacherUser.email, password);
    await student.login(studentUser.email, password);
    await peer.login(`peer-${suffix}@example.test`, password);
  });

  await t.test('Directory editing validates values and detects stale versions', async () => {
    await admin.call(`/api/groups/${group.id}`, {
      method: 'PATCH',
      body: {
        name: group.name,
        course: 3,
        curatorId: teacherUser.id,
        version: group.version,
      },
    });
    await admin.call(
      `/api/groups/${group.id}`,
      {
        method: 'PATCH',
        body: {
          name: group.name,
          course: 4,
          curatorId: teacherUser.id,
          version: group.version,
        },
      },
      409,
    );
    await admin.call(`/api/subjects/${subject.id}`, {
      method: 'PATCH',
      body: {
        name: `${subject.name} — обновлён`,
        version: subject.version,
      },
    });
    await admin.call(`/api/rooms/${room.id}`, {
      method: 'PATCH',
      body: {
        name: room.name,
        capacity: 30,
        version: room.version,
      },
    });
    await admin.call(
      '/api/rooms',
      { method: 'POST', body: { name: `Плохая ${suffix}`, capacity: 0 } },
      422,
    );
    await admin.call(
      '/api/groups',
      { method: 'POST', body: { name: `Плохая ${suffix}`, course: 9 } },
      422,
    );
    await admin.call(
      '/api/subjects',
      { method: 'POST', body: { name: `${subject.name} — обновлён` } },
      409,
    );
    await student.call(
      '/api/subjects',
      { method: 'POST', body: { name: 'Недоступно студенту' } },
      403,
    );
    await teacher.call(
      '/api/rooms',
      { method: 'POST', body: { name: 'Недоступно преподавателю' } },
      403,
    );
    const data = await admin.bootstrap();
    group = data.groups.find((row) => row.id === group.id);
    subject = data.subjects.find((row) => row.id === subject.id);
    room = data.rooms.find((row) => row.id === room.id);
    assert.equal(group.course, 3);
    assert.equal(room.capacity, 30);
  });

  await t.test('Admin edits account roles and active sessions use the new role', async () => {
    let user = (await admin.bootstrap()).users.find(
      (row) => row.email === `peer-${suffix}@example.test`,
    );
    await admin.call(`/api/users/${user.id}`, {
      method: 'PATCH',
      body: {
        name: user.name,
        email: user.email,
        role: 'teacher',
        groupId: null,
        version: user.version,
      },
    });
    assert.equal((await peer.session()).user.role, 'teacher');
    await admin.call(
      `/api/users/${user.id}`,
      {
        method: 'PATCH',
        body: {
          name: user.name,
          email: user.email,
          role: 'student',
          groupId: group.id,
          version: user.version,
        },
      },
      409,
    );
    user = (await admin.bootstrap()).users.find((row) => row.id === user.id);
    await admin.call(`/api/users/${user.id}`, {
      method: 'PATCH',
      body: {
        name: user.name,
        email: user.email,
        role: 'student',
        groupId: group.id,
        version: user.version,
      },
    });
    assert.equal((await peer.session()).user.role, 'student');
  });

  await t.test('Schedule creation, conflict prevention, cancellation and restoration', async () => {
    const start = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    start.setUTCHours(4, 0, 0, 0);
    const input = {
      groupId: group.id,
      subjectId: subject.id,
      teacherId: teacherUser.id,
      roomId: room.id,
      startsAt: start.toISOString(),
      endsAt: new Date(+start + 45 * 60000).toISOString(),
      kind: 'Практика',
      status: 'scheduled',
      note: `Проверка ${suffix}`,
    };
    await admin.call('/api/lessons', { method: 'POST', body: input });
    await admin.call('/api/lessons', { method: 'POST', body: input }, 409);
    await admin.call(
      '/api/lessons',
      { method: 'POST', body: { ...input, endsAt: input.startsAt } },
      422,
    );
    lesson = (await admin.bootstrap()).lessons.find((row) => row.note === input.note);
    assert.ok(lesson);
    await admin.call(`/api/lessons/${lesson.id}`, {
      method: 'PATCH',
      body: {
        status: 'cancelled',
        version: lesson.version,
      },
    });
    await admin.call(
      `/api/lessons/${lesson.id}`,
      {
        method: 'PATCH',
        body: {
          status: 'scheduled',
          version: lesson.version,
        },
      },
      409,
    );
    lesson = (await admin.bootstrap()).lessons.find((row) => row.id === lesson.id);
    assert.equal(lesson.status, 'cancelled');
    await admin.call(`/api/lessons/${lesson.id}`, {
      method: 'PATCH',
      body: {
        status: 'scheduled',
        version: lesson.version,
      },
    });
    await admin.call('/api/lessons', {
      method: 'POST',
      body: {
        ...input,
        startsAt: input.endsAt,
        endsAt: new Date(+start + 90 * 60000).toISOString(),
        note: 'Следующая пара',
      },
    });
    lesson = (await teacher.bootstrap()).lessons.find((row) => row.id === lesson.id);
    assert.equal(lesson.status, 'scheduled');
  });

  await t.test('Grade saves, optimistic locking, removal and student privacy', async () => {
    const path = `/api/lessons/${lesson.id}/grades/${studentUser.id}`;
    await teacher.call(path, { method: 'PUT', body: { grade: 0, version: null } });
    await teacher.call(path, { method: 'PUT', body: { grade: 50, version: null } }, 409);
    let grade = (await student.bootstrap()).grades.find((row) => row.lessonId === lesson.id);
    assert.equal(grade.grade, 0);
    assert.equal(grade.status, 'graded');
    await teacher.call(path, { method: 'PUT', body: { grade: null, version: grade.version } });
    grade = (await student.bootstrap()).grades.find((row) => row.lessonId === lesson.id);
    assert.equal(grade.grade, null);
    assert.equal(grade.status, 'unmarked');
    assert.equal(grade.version, 2);
    for (const status of ['not_required', 'absent', 'unmarked']) {
      const previousVersion = grade.version;
      await teacher.call(path, {
        method: 'PUT',
        body: { grade: null, status, version: previousVersion },
      });
      await teacher.call(
        path,
        { method: 'PUT', body: { grade: 10, status: 'graded', version: previousVersion } },
        409,
      );
      grade = (await student.bootstrap()).grades.find((row) => row.lessonId === lesson.id);
      assert.equal(grade.status, status);
      assert.equal(grade.grade, null);
      assert.equal(grade.version, previousVersion + 1);
    }
    for (const value of [-1, 101, 10.5, '50'])
      await teacher.call(
        path,
        { method: 'PUT', body: { grade: value, status: 'graded', version: grade.version } },
        422,
      );
    await teacher.call(
      path,
      { method: 'PUT', body: { grade: 0, status: 'not_required', version: grade.version } },
      422,
    );
    await teacher.call(
      path,
      { method: 'PUT', body: { grade: null, status: 'graded', version: grade.version } },
      422,
    );
    await teacher.call(path, {
      method: 'PUT',
      body: { grade: 100, status: 'graded', version: grade.version },
    });
    grade = (await student.bootstrap()).grades.find((row) => row.lessonId === lesson.id);
    assert.equal(grade.grade, 100);
    await student.call(
      path,
      { method: 'PUT', body: { grade: 100, status: 'graded', version: grade.version } },
      403,
    );
    assert.ok(!(await peer.bootstrap()).grades.some((row) => row.studentId === studentUser.id));
  });

  await t.test('Attendance saves atomically and stale changes are rejected', async () => {
    const path = `/api/lessons/${lesson.id}/attendance`;
    await teacher.call(
      path,
      {
        method: 'PUT',
        body: {
          entries: [{ studentId: studentUser.id, status: 'absent' }],
          version: lesson.attendanceVersion,
        },
      },
      409,
    );
    lesson = (await teacher.bootstrap()).lessons.find((row) => row.id === lesson.id);
    const input = {
      entries: [{ studentId: studentUser.id, status: 'absent' }],
      version: lesson.attendanceVersion,
    };
    await teacher.call(path, { method: 'PUT', body: input });
    await teacher.call(path, { method: 'PUT', body: input }, 409);
    let data = await student.bootstrap();
    assert.equal(data.attendance.find((row) => row.lessonId === lesson.id).status, 'absent');
    assert.equal(data.grades.find((row) => row.lessonId === lesson.id).grade, 100);
    const updated = (await teacher.bootstrap()).lessons.find((row) => row.id === lesson.id);
    await teacher.call(path, {
      method: 'PUT',
      body: {
        entries: [{ studentId: studentUser.id, status: null }],
        version: updated.attendanceVersion,
      },
    });
    data = await student.bootstrap();
    assert.ok(!data.attendance.some((row) => row.lessonId === lesson.id));
    assert.equal(data.grades.find((row) => row.lessonId === lesson.id).grade, 100);
    await student.call(path, { method: 'PUT', body: input }, 403);

    const grade = data.grades.find((row) => row.lessonId === lesson.id);
    await teacher.call(`/api/lessons/${lesson.id}/grades/${studentUser.id}`, {
      method: 'PUT',
      body: { grade: null, status: 'unmarked', version: grade.version },
    });
    let attendanceVersion = (await teacher.bootstrap()).lessons.find(
      (row) => row.id === lesson.id,
    ).attendanceVersion;
    for (const [status, journalStatus] of [
      ['absent', 'absent'],
      ['excused', 'absent'],
      ['present', 'unmarked'],
    ]) {
      await teacher.call(path, {
        method: 'PUT',
        body: { entries: [{ studentId: studentUser.id, status }], version: attendanceVersion++ },
      });
      data = await student.bootstrap();
      const mark = data.grades.find((row) => row.lessonId === lesson.id);
      assert.equal(mark.status, journalStatus);
      assert.equal(mark.grade, null);
    }
    const unmarked = data.grades.find((row) => row.lessonId === lesson.id);
    await teacher.call(`/api/lessons/${lesson.id}/grades/${studentUser.id}`, {
      method: 'PUT',
      body: { grade: null, status: 'not_required', version: unmarked.version },
    });
    await teacher.call(
      path,
      {
        method: 'PUT',
        body: {
          entries: [{ studentId: studentUser.id, status: 'absent' }],
          version: attendanceVersion,
        },
      },
      409,
    );
    attendanceVersion = (await teacher.bootstrap()).lessons.find(
      (row) => row.id === lesson.id,
    ).attendanceVersion;
    for (const status of ['absent', 'excused', 'present', null]) {
      await teacher.call(path, {
        method: 'PUT',
        body: { entries: [{ studentId: studentUser.id, status }], version: attendanceVersion++ },
      });
      const mark = (await student.bootstrap()).grades.find((row) => row.lessonId === lesson.id);
      assert.equal(mark.status, 'not_required');
      assert.equal(mark.grade, null);
    }
  });

  await t.test('Teacher publishes an assignment and student sees it', async () => {
    const input = {
      title: `Лабораторная ${suffix}`,
      type: 'Лабораторная работа',
      description: 'Создайте таблицу студентов и напишите SELECT.',
      steps: ['Создать таблицу', 'Добавить запрос'],
      subjectId: subject.id,
      groupId: group.id,
      teacherId: teacherUser.id,
      dueAt: new Date(Date.now() + 3 * 86400000).toISOString(),
    };
    await teacher.call('/api/assignments', { method: 'POST', body: input });
    await student.call('/api/assignments', { method: 'POST', body: input }, 403);
    await teacher.call(
      '/api/assignments',
      {
        method: 'POST',
        body: {
          ...input,
          dueAt: new Date(Date.now() - 86400000).toISOString(),
        },
      },
      422,
    );
    assignment = (await student.bootstrap()).assignments.find((row) => row.title === input.title);
    assert.equal(assignment.teacherId, teacherUser.id);
  });

  await t.test('File upload checks formats and stores actual SQL contents', async () => {
    const path = `/api/assignments/${assignment.id}/submission`;
    await student.call(path, { method: 'POST', body: upload('work.exe', 'not executable') }, 422);
    await student.call(path, { method: 'POST', body: upload('work.pdf', 'not a PDF') }, 422);
    await student.call(path, { method: 'POST', body: upload('work.sql', '') }, 422);
    await student.call(path, { method: 'POST', body: upload('work.sql', 'SELECT 1;\n') });
    submission = (await teacher.bootstrap()).submissions.find(
      (row) => row.assignmentId === assignment.id,
    );
    assert.equal(submission.status, 'submitted');
    const file = await teacher.call(`/api/files/${submission.file.id}`);
    assert.equal(file.data, 'SELECT 1;\n');
    assert.equal(file.response.headers.get('x-content-type-options'), 'nosniff');
    await peer.call(`/api/files/${submission.file.id}`, {}, [403, 404]);
    const guest = new TestClient(baseUrl);
    await guest.call(`/api/files/${submission.file.id}`, {}, 401);
  });

  await t.test('Revision, repeat submission and teacher review complete the workflow', async () => {
    const path = `/api/submissions/${submission.id}/review`;
    await teacher.call(path, {
      method: 'PATCH',
      body: {
        action: 'return',
        grade: null,
        comment: 'Добавьте CREATE TABLE.',
        version: submission.version,
      },
    });
    let work = (await student.bootstrap()).submissions.find((row) => row.id === submission.id);
    assert.equal(work.status, 'revision');
    const oldFileId = work.file.id;
    await student.call(`/api/assignments/${assignment.id}/submission`, {
      method: 'POST',
      body: upload('work.sql', 'CREATE TABLE students (id INTEGER PRIMARY KEY);\nSELECT 1;\n'),
    });
    work = (await teacher.bootstrap()).submissions.find((row) => row.id === submission.id);
    assert.notEqual(work.file.id, oldFileId);
    await student.call(`/api/files/${oldFileId}`, {}, [403, 404]);
    await student.call(
      path,
      {
        method: 'PATCH',
        body: {
          action: 'grade',
          grade: 100,
          comment: 'Попытка изменить свою оценку',
          version: work.version,
        },
      },
      403,
    );
    await teacher.call(path, {
      method: 'PATCH',
      body: {
        action: 'grade',
        grade: 0,
        comment: 'Работа выполнена верно.',
        version: work.version,
      },
    });
    await teacher.call(
      path,
      {
        method: 'PATCH',
        body: {
          action: 'grade',
          grade: 60,
          comment: 'Устаревшая форма',
          version: work.version,
        },
      },
      409,
    );
    work = (await student.bootstrap()).submissions.find((row) => row.id === submission.id);
    assert.equal(work.status, 'reviewed');
    assert.equal(work.grade, 0);
    assert.equal(work.comment, 'Работа выполнена верно.');
    for (const grade of [-1, 101, 50.5]) {
      await teacher.call(
        path,
        { method: 'PATCH', body: { action: 'grade', grade, comment: '', version: work.version } },
        422,
      );
    }
    await teacher.call(path, {
      method: 'PATCH',
      body: { action: 'grade', grade: 100, comment: work.comment, version: work.version },
    });
    work = (await student.bootstrap()).submissions.find((row) => row.id === submission.id);
    assert.equal(work.grade, 100);
    await student.call(
      `/api/assignments/${assignment.id}/submission`,
      {
        method: 'POST',
        body: upload('work.sql', 'SELECT 2;'),
      },
      409,
    );
  });

  await t.test('Materials and announcements are published through the database', async () => {
    const title = `Материал ${suffix}`;
    await teacher.call('/api/materials', {
      method: 'POST',
      body: upload('guide.txt', 'Памятка по SQL', {
        subjectId: subject.id,
        title,
      }),
    });
    const material = (await student.bootstrap()).materials.find((row) => row.title === title);
    assert.ok(material);
    assert.equal((await student.call(`/api/files/${material.fileId}`)).data, 'Памятка по SQL');
    await student.call(
      '/api/materials',
      {
        method: 'POST',
        body: upload('guide.txt', 'Запрещено', {
          subjectId: subject.id,
          title,
        }),
      },
      403,
    );
    await student.call(`/api/materials/${material.id}`, { method: 'DELETE', body: {} }, 403);
    await teacher.call(`/api/materials/${material.id}`, { method: 'DELETE', body: {} });
    assert.ok(!(await student.bootstrap()).materials.some((row) => row.id === material.id));
    await student.call(`/api/files/${material.fileId}`, {}, [403, 404]);
    const notice = { title: `Объявление ${suffix}`, body: 'Следующее занятие по расписанию.' };
    await admin.call('/api/announcements', { method: 'POST', body: notice });
    const announcement = (await student.bootstrap()).announcements.find(
      (row) => row.title === notice.title,
    );
    assert.ok(announcement);
    await teacher.call('/api/announcements', { method: 'POST', body: notice }, 403);
    await teacher.call(
      `/api/announcements/${announcement.id}`,
      { method: 'DELETE', body: {} },
      403,
    );
    await admin.call(`/api/announcements/${announcement.id}`, { method: 'DELETE', body: {} });
    assert.ok(!(await student.bootstrap()).announcements.some((row) => row.id === announcement.id));
  });

  await t.test('Profile editing survives reload and rejects stale writes', async () => {
    const session = await student.session();
    const input = { name: `Обновлённый студент ${suffix}`, version: session.user.version };
    await student.call('/api/profile', { method: 'PATCH', body: input });
    await student.call('/api/profile', { method: 'PATCH', body: input }, 409);
    assert.equal((await student.session()).user.name, input.name);
    await student.call('/api/profile', { method: 'PATCH', body: { name: '', version: 2 } }, 422);
  });

  await t.test('Registration, login and logout keep role assignment on the server', async () => {
    const account = new TestClient(baseUrl);
    await account.session();
    const input = {
      name: `Регистрация ${suffix}`,
      email: `registered-${suffix}@example.test`,
      password,
      passwordConfirmation: password,
    };
    await account.call(
      '/api/auth/register',
      { method: 'POST', body: { ...input, role: 'admin' } },
      422,
    );
    await account.call(
      '/api/auth/register',
      { method: 'POST', body: { ...input, passwordConfirmation: 'wrong' } },
      422,
    );
    await account.call('/api/auth/register', { method: 'POST', body: input });
    let session = await account.session();
    assert.equal(session.user.role, 'student');
    assert.equal(session.user.groupId, null);
    assert.equal((await account.bootstrap()).assignments.length, 0);
    const previous = new TestClient(baseUrl);
    previous.cookie = account.cookie;
    await account.call('/api/auth/logout', { method: 'POST', body: {} });
    await previous.call('/api/bootstrap', {}, 401);
    session = await account.session();
    assert.equal(session.user, null);
    await account.call(
      '/api/auth/login',
      { method: 'POST', body: { email: input.email, password: 'incorrect-password' } },
      401,
    );
    session = await account.login(input.email, password);
    assert.equal(session.user.name, input.name);
    await account.call('/api/auth/logout', { method: 'POST', body: {} });
    await account.session();
    await account.call('/api/auth/register', { method: 'POST', body: input }, 409);
  });
});
