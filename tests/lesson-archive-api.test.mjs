import assert from 'node:assert/strict';
import test from 'node:test';
import { TestClient } from './http-client.mjs';

const baseUrl = process.env.TEST_BASE_URL;
test(
  'Lesson archive HTTP boundary: session, role, CSRF, version and retained history',
  {
    skip: !baseUrl && 'Run with npm test against its isolated server.',
  },
  async () => {
    assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseUrl).hostname));
    const admin = new TestClient(baseUrl),
      teacher = new TestClient(baseUrl),
      student = new TestClient(baseUrl),
      guest = new TestClient(baseUrl);
    await admin.demo('admin');
    await teacher.demo('teacher');
    await student.demo('student');
    await guest.session();
    const before = await admin.bootstrap();
    const lesson = before.lessons.find(
      (row) => row.status === 'scheduled' && row.kind !== 'srsp' && !row.archivedAt,
    );
    assert.ok(lesson);
    const path = `/api/lessons/${encodeURIComponent(lesson.id)}`,
      body = { version: lesson.version };
    await guest.call(path, { method: 'DELETE', body }, 401);
    await teacher.call(path, { method: 'DELETE', body }, 403);
    await student.call(path, { method: 'DELETE', body }, 403);
    await admin.call(path, { method: 'DELETE', body, headers: { 'X-CSRF-Token': '' } }, 403);
    await admin.call(path, { method: 'DELETE', body: { version: lesson.version + 100 } }, 409);
    await admin.call(path, { method: 'DELETE', body });
    const after = await admin.bootstrap();
    assert.equal(after.lessons.length, before.lessons.length);
    assert.ok(after.lessons.find((row) => row.id === lesson.id).archivedAt);
    for (const key of ['grades', 'attendance', 'assignments', 'submissions', 'materials'])
      assert.deepEqual(after[key], before[key], key);
    await admin.call(path, { method: 'DELETE', body }, 409);
  },
);
