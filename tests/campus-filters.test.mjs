import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assignmentOptions,
  emptyRoomFilters,
  groupDisplayName,
  isRoomFilters,
  matchesRoom,
  normalizeRoomFilters,
} from '../lib/studyhub/campus-filters.ts';

test('room filters reject corrupted browser storage and unsupported values', () => {
  assert.equal(isRoomFilters(null), false);
  assert.equal(isRoomFilters({ ...emptyRoomFilters, floor: '-1' }), false);
  assert.equal(isRoomFilters({ ...emptyRoomFilters, type: 'gym' }), false);
  assert.equal(isRoomFilters({ ...emptyRoomFilters, occupancy: 'unknown' }), false);
  assert.equal(isRoomFilters({ ...emptyRoomFilters, floor: '100' }), true);
});

test('stale floor resets and restricted timetable never implies availability', () => {
  const rooms = [{ id: 'r1', name: '301', floor: 3 }];
  assert.deepEqual(
    normalizeRoomFilters({ ...emptyRoomFilters, floor: '8', occupancy: 'free' }, rooms, false),
    emptyRoomFilters,
  );
  assert.equal(
    normalizeRoomFilters({ ...emptyRoomFilters, floor: '3', occupancy: 'busy' }, rooms, true)
      .occupancy,
    'busy',
  );
});

test('room filters combine floor, type, search and occupancy', () => {
  const room = { number: '301', name: '301 · Компьютерный класс', floor: 3, type: 'computer' };
  const filters = { query: ' КОМПЬЮТЕР ', floor: '3', type: 'computer', occupancy: 'free' };
  assert.equal(matchesRoom(room, filters, false), true);
  assert.equal(matchesRoom(room, filters, true), false);
  assert.equal(matchesRoom({ ...room, type: null }, filters, false), false);
  assert.equal(matchesRoom(room, { ...filters, floor: '2' }, false), false);
});

test('group suffix uses Cyrillic А / Б and admission year', () => {
  assert.equal(groupDisplayName('VTIPO', 2024, 'kk'), 'ВТиПО-24А');
  assert.equal(groupDisplayName('IS', 2025, 'ru'), 'ИС-25Б');
  assert.equal(groupDisplayName('DS', 2026, 'kk'), 'DS-26А');
  assert.equal(groupDisplayName('', 2026, 'kk'), '');
  assert.equal(groupDisplayName('IS', 0, 'kk'), '');
});

test('assignment options require curriculum semester, subject specialty and group language', () => {
  const data = {
    groups: [{ id: 'g', language: 'kk' }],
    subjects: [{ id: 'python' }, { id: 'math' }],
    users: [
      { id: 'teacher-kk', role: 'teacher' },
      { id: 'teacher-ru', role: 'teacher' },
      { id: 'student', role: 'student' },
    ],
    teacherSubjects: [
      { teacherId: 'teacher-kk', subjectId: 'python' },
      { teacherId: 'teacher-ru', subjectId: 'python' },
      { teacherId: 'student', subjectId: 'python' },
    ],
    teacherLanguages: [
      { teacherId: 'teacher-kk', language: 'kk' },
      { teacherId: 'teacher-ru', language: 'ru' },
      { teacherId: 'student', language: 'kk' },
    ],
    groupSubjects: [
      { groupId: 'g', subjectId: 'python', academicYear: 2026, semester: 1 },
      { groupId: 'g', subjectId: 'math', academicYear: 2026, semester: 2 },
    ],
  };
  assert.deepEqual(
    assignmentOptions(data, 'g', 'python', '2026-11-12').teachers.map((item) => item.id),
    ['teacher-kk'],
  );
  assert.deepEqual(
    assignmentOptions(data, 'g', 'python', '2027-01-12').subjects.map((item) => item.id),
    ['math'],
  );
  assert.deepEqual(assignmentOptions(data, 'g', 'python', '2027-01-12').teachers, []);
  assert.deepEqual(assignmentOptions(data, 'g', 'python', '').subjects, []);
  assert.deepEqual(
    assignmentOptions(
      { ...data, groups: [{ id: 'g', language: null }] },
      'g',
      'python',
      '2026-11-12',
    ).teachers,
    [],
  );
});
