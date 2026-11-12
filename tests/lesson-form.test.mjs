import assert from 'node:assert/strict';
import test from 'node:test';
import {
  subjectsForDate,
  teachersForSubject,
  practicesForGroup,
  srspInput,
} from '../lib/studyhub/lesson-form.ts';

function fixture() {
  return {
    groups: [
      { id: 'g', language: 'kk' },
      { id: 'other', language: 'ru' },
    ],
    subjects: [{ id: 'math' }, { id: 'code' }],
    users: [
      { id: 'ok', role: 'teacher' },
      { id: 'wrong-language', role: 'teacher' },
      { id: 'unassigned', role: 'teacher' },
    ],
    teacherSubjects: ['ok', 'wrong-language', 'unassigned'].map((teacherId) => ({
      teacherId,
      subjectId: 'math',
    })),
    teacherLanguages: [
      { teacherId: 'ok', language: 'kk' },
      { teacherId: 'wrong-language', language: 'ru' },
      { teacherId: 'unassigned', language: 'kk' },
    ],
    teachingAssignments: [
      { teacherId: 'ok', groupId: 'g', subjectId: 'math' },
      { teacherId: 'wrong-language', groupId: 'g', subjectId: 'math' },
    ],
    groupSubjects: [
      { groupId: 'g', subjectId: 'math', academicYear: 2026, semester: 1 },
      { groupId: 'g', subjectId: 'code', academicYear: 2026, semester: 2 },
    ],
    lessons: [],
  };
}
test('curriculum changes at the January boundary and excludes malformed dates', () => {
  const data = fixture();
  assert.deepEqual(
    subjectsForDate(data, 'g', '2026-12-31').map((x) => x.id),
    ['math'],
  );
  assert.deepEqual(
    subjectsForDate(data, 'g', '2027-01-01').map((x) => x.id),
    ['code'],
  );
  assert.deepEqual(subjectsForDate(data, 'other', '2026-11-12'), []);
  assert.deepEqual(subjectsForDate(data, 'g', '2026-02-30'), []);
});
test('teacher must satisfy specialization, language and group assignment together', () => {
  const data = fixture();
  assert.deepEqual(
    teachersForSubject(data, 'g', 'math').map((x) => x.id),
    ['ok'],
  );
  data.groups[0].language = null;
  assert.deepEqual(teachersForSubject(data, 'g', 'math'), []);
});
test('SRSP can link a valid legacy-labelled practice but never cancelled or wrong-term lessons', () => {
  const data = fixture();
  const lesson = {
    id: 'p',
    groupId: 'g',
    subjectId: 'math',
    teacherId: 'ok',
    status: 'scheduled',
    kind: 'Практическая работа',
    date: '2026-11-12',
    startsAt: '2026-11-12T03:00:00.000Z',
  };
  data.lessons = [
    lesson,
    { ...lesson, id: 'cancelled', status: 'cancelled' },
    { ...lesson, id: 'lecture', kind: 'lecture' },
    { ...lesson, id: 'next-term', date: '2027-01-12' },
  ];
  assert.deepEqual(
    practicesForGroup(data, 'g').map((x) => x.id),
    ['p'],
  );
  assert.deepEqual(practicesForGroup(data, 'g', 'p'), []);
  const input = srspInput(lesson, 'Read chapter 3');
  assert.equal(input.practiceId, 'p');
  assert.equal(input.date, lesson.date);
  assert.equal(input.teacherId, lesson.teacherId);
  for (const key of ['roomId', 'slotId', 'startsAt', 'endsAt']) assert.equal(input[key], null);
});
