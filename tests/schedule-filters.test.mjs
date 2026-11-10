import assert from 'node:assert/strict';
import test from 'node:test';
import {
  emptyScheduleFilters,
  isScheduleFilters,
  matchesScheduleFilters,
  normalizeScheduleFilters,
  scheduleScope,
} from '../lib/studyhub/schedule-filters.ts';

const records = {
  groups: [{ id: 'g1' }, { id: 'g2' }],
  subjects: [{ id: 's1' }, { id: 's2' }],
  users: [
    { id: 't1', role: 'teacher' },
    { id: 't2', role: 'teacher' },
  ],
  rooms: [{ id: 'r1' }, { id: 'r2' }],
  lessons: [
    { id: 'l1', groupId: 'g1', subjectId: 's1', teacherId: 't1', roomId: 'r1', kind: 'lecture' },
    { id: 'l2', groupId: 'g2', subjectId: 's2', teacherId: 't2', roomId: 'r2', kind: 'practice' },
    { id: 'l3', groupId: 'g1', subjectId: 's2', teacherId: 't2', roomId: 'r2', kind: 'practice' },
  ],
  teachingAssignments: [
    { groupId: 'g1', subjectId: 's1', teacherId: 't1' },
    { groupId: 'g2', subjectId: 's2', teacherId: 't2' },
    { groupId: 'g1', subjectId: 's2', teacherId: 't2' },
  ],
};

test('schedule scope limits lessons and filter choices before optional filters', () => {
  const teacher = scheduleScope(records, { id: 't1', role: 'teacher' });
  assert.deepEqual(
    teacher.lessons.map((item) => item.id),
    ['l1'],
  );
  assert.deepEqual(
    teacher.subjects.map((item) => item.id),
    ['s1'],
  );
  assert.deepEqual(
    teacher.groups.map((item) => item.id),
    ['g1'],
  );
  const student = scheduleScope(records, { id: 'u1', role: 'student', groupId: 'g1' });
  assert.deepEqual(
    student.lessons.map((item) => item.id),
    ['l1', 'l3'],
  );
  assert.deepEqual(scheduleScope(records, null).lessons, []);
  assert.deepEqual(
    scheduleScope(records, { id: 'u1', role: 'student', groupId: null }).lessons,
    [],
  );
  assert.equal(scheduleScope(records, { id: 'a1', role: 'admin' }).lessons.length, 3);
});

test('restoring filters drops removed or inaccessible values while keeping valid choices', () => {
  const user = { id: 'u1', role: 'student', groupId: 'g1' };
  const value = {
    group: 'g2',
    teacher: 'deleted-user',
    subject: 's2',
    room: 'r2',
    kind: 'seminar',
    mode: 'week',
  };
  const filters = normalizeScheduleFilters(value, scheduleScope(records, user), user);
  assert.deepEqual(filters, {
    group: '',
    teacher: '',
    subject: 's2',
    room: 'r2',
    kind: '',
    mode: 'week',
  });
  assert.equal('date' in filters, false);
  assert.deepEqual(
    scheduleScope(records, user)
      .lessons.filter((lesson) => matchesScheduleFilters(lesson, filters))
      .map((lesson) => lesson.id),
    ['l3'],
  );
});

test('combined lesson filters narrow records and runtime validation rejects malformed storage', () => {
  const filters = {
    ...emptyScheduleFilters,
    teacher: 't2',
    group: 'g1',
    subject: 's2',
    kind: 'practice',
  };
  assert.deepEqual(
    records.lessons
      .filter((lesson) => matchesScheduleFilters(lesson, filters))
      .map((lesson) => lesson.id),
    ['l3'],
  );
  assert.equal(isScheduleFilters(filters), true);
  for (const bad of [null, [], {}, { ...filters, mode: 'month' }, { ...filters, teacher: 42 }]) {
    assert.equal(isScheduleFilters(bad), false);
  }
});
