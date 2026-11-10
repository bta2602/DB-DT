import assert from 'node:assert/strict';
import test from 'node:test';
import {
  emptyData,
  formatTime,
  lessonConflicts,
  lessonDay,
  lessonKindLabel,
  lessonSortKey,
  lessonStatus,
} from '../lib/studyhub/client-utils.ts';

const practice = {
  id: 'practice',
  groupId: 'group',
  teacherId: 'teacher',
  subjectId: 'subject',
  roomId: 'room',
  date: '2026-11-10',
  startsAt: '2026-11-10T03:00:00.000Z',
  endsAt: '2026-11-10T03:50:00.000Z',
  kind: 'practice',
  status: 'scheduled',
  practiceId: null,
  slotId: 'p1',
};
const srsp = {
  ...practice,
  id: 'srsp',
  kind: 'srsp',
  practiceId: practice.id,
  slotId: null,
  roomId: null,
  startsAt: null,
  endsAt: null,
};

test('guided self-study has a date but never occupies a live slot or room', () => {
  const during = Date.parse('2026-11-10T03:10:00Z');
  assert.equal(lessonDay(srsp), '2026-11-10');
  assert.equal(formatTime(srsp.startsAt), '—');
  assert.equal(lessonStatus(srsp, during), 'selfStudy');
  assert.equal(lessonStatus(practice, during), 'current');
  assert.equal(lessonStatus({ ...srsp, status: 'cancelled' }, during), 'cancelled');
  assert.deepEqual(lessonConflicts(srsp, [practice]), []);
  assert.deepEqual(lessonConflicts(practice, [srsp]), []);
  assert(lessonSortKey(srsp).startsWith(srsp.date));
});

test('normal lesson conflicts retain cancellation, self-edit and boundary handling', () => {
  assert.deepEqual(lessonConflicts(practice, [practice]), []);
  assert.equal(lessonConflicts({ ...practice, id: 'second' }, [practice]).length, 1);
  assert.deepEqual(
    lessonConflicts(
      { ...practice, id: 'second', startsAt: practice.endsAt, endsAt: '2026-11-10T04:40:00Z' },
      [practice],
    ),
    [],
  );
  assert.deepEqual(
    lessonConflicts(practice, [{ ...practice, id: 'cancelled', status: 'cancelled' }]),
    [],
  );
});

test('academic bootstrap arrays and normalized labels remain usable by clients', () => {
  for (const name of ['teacherSubjects', 'teacherLanguages', 'groupSubjects']) {
    assert.deepEqual(emptyData()[name], []);
  }
  assert.equal(lessonKindLabel('lecture'), 'Лекция');
  assert.equal(lessonKindLabel('srsp'), 'СРСП');
  assert.equal(lessonKindLabel('Историческая лабораторная'), 'Историческая лабораторная');
});
