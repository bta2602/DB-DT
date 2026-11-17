import assert from 'node:assert/strict';
import test from 'node:test';
import { lessonSchedule, isVisibleLesson, lessonConflicts } from '../lib/studyhub/client-utils.ts';
import {
  scheduleScope,
  matchesScheduleFilters,
  emptyScheduleFilters,
} from '../lib/studyhub/schedule-filters.ts';
import { scopeBootstrap } from '../lib/studyhub/policy.mjs';

const practice = {
  id: 'p',
  groupId: 'g',
  teacherId: 't',
  roomId: 'r',
  kind: 'practice',
  status: 'scheduled',
  slotId: 'p1',
  date: '2026-11-17',
  startsAt: '2026-11-17T03:00:00.000Z',
  endsAt: '2026-11-17T03:50:00.000Z',
};
const srsp = {
  ...practice,
  id: 's',
  kind: 'srsp',
  practiceId: 'p',
  roomId: null,
  slotId: null,
  startsAt: null,
  endsAt: null,
};
test('SRSP display follows only its linked practice and does not mutate the stored lesson', () => {
  const other = { ...practice, id: 'other', roomId: 'elsewhere' };
  const moved = {
    ...practice,
    roomId: '1101',
    slotId: 'p12',
    date: '2026-11-18',
    startsAt: '2026-11-18T13:35:00.000Z',
    endsAt: '2026-11-18T14:25:00.000Z',
  };
  assert.deepEqual(lessonSchedule(srsp, [other, moved]), {
    roomId: '1101',
    slotId: 'p12',
    date: moved.date,
    startsAt: moved.startsAt,
    endsAt: moved.endsAt,
  });
  assert.equal(srsp.roomId, null);
  assert.equal(srsp.startsAt, null);
  assert.equal(lessonSchedule(other, [moved]).roomId, 'elsewhere');
});
test('Archived timetable records are hidden and do not occupy a room', () => {
  const hidden = { ...practice, archivedAt: '2026-11-17T10:00:00.000Z' };
  const candidate = { ...practice, id: 'new' };
  assert.equal(isVisibleLesson(practice), true);
  assert.equal(isVisibleLesson(hidden), false);
  assert.equal(lessonConflicts(candidate, [practice]).length, 1);
  assert.deepEqual(lessonConflicts(candidate, [hidden, srsp]), []);
});

test('Room filters include SRSP under the room of its own practice', () => {
  const filter = { ...emptyScheduleFilters, room: 'r' };
  assert.equal(matchesScheduleFilters(srsp, filter, [practice, srsp]), true);
  assert.equal(matchesScheduleFilters(srsp, { ...filter, room: 'elsewhere' }, [practice]), false);
  assert.equal(matchesScheduleFilters(practice, filter, [practice]), true);
});

test('Timetables hide archived lessons while authorized teacher and student history retains them', () => {
  const teacher = { id: 't', role: 'teacher', groupId: null };
  const student = { id: 'student', role: 'student', groupId: 'g' };
  const hidden = {
    ...practice,
    id: 'hidden',
    subjectId: 'subject',
    archivedAt: '2026-11-17T10:00:00.000Z',
  };
  const data = {
    users: [teacher, student, { id: 'other', role: 'teacher', groupId: null }],
    groups: [{ id: 'g' }, { id: 'foreign' }],
    subjects: [{ id: 'subject' }],
    rooms: [{ id: 'r' }],
    teachingAssignments: [{ teacherId: 't', groupId: 'g', subjectId: 'subject' }],
    teacherSubjects: [],
    teacherLanguages: [],
    groupSubjects: [],
    lessons: [
      { ...practice, subjectId: 'subject' },
      hidden,
      { ...hidden, id: 'foreign', groupId: 'foreign', teacherId: 'other' },
    ],
    assignments: [
      { id: 'assignment', teacherId: 't', groupId: 'g', subjectId: 'subject', lessonId: 'hidden' },
    ],
    submissions: [{ id: 'work', assignmentId: 'assignment', studentId: 'student', grade: 87 }],
    grades: [{ lessonId: 'hidden', studentId: 'student', grade: 84 }],
    attendance: [{ lessonId: 'hidden', studentId: 'student', status: 'present' }],
    materials: [],
    announcements: [],
  };
  for (const user of [teacher, student]) {
    const history = scopeBootstrap(user, data);
    assert.deepEqual(
      history.lessons.map((row) => row.id),
      ['p', 'hidden'],
    );
    assert.deepEqual(history.grades, data.grades);
    assert.deepEqual(history.submissions, data.submissions);
    assert.deepEqual(
      scheduleScope(history, user).lessons.map((row) => row.id),
      ['p'],
    );
  }
  assert.deepEqual(
    scheduleScope(data, { id: 'admin', role: 'admin' }).lessons.map((row) => row.id),
    ['p'],
  );
  assert.deepEqual(scheduleScope(data, null).lessons, []);
});
