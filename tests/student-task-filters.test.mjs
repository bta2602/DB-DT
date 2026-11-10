import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defaultTaskFilters,
  isStudentTaskFilters,
  normalizeTaskFilters,
} from '../lib/studyhub/student-task-filters.ts';

test('task filter payload validates types and enum values before restoring', () => {
  assert.equal(isStudentTaskFilters(defaultTaskFilters), true);
  for (const value of [
    null,
    [],
    {},
    { ...defaultTaskFilters, status: 'admin' },
    { ...defaultTaskFilters, query: 7 },
    { ...defaultTaskFilters, deadline: 'yesterday' },
    { ...defaultTaskFilters, subjectId: null },
    { ...defaultTaskFilters, type: [] },
  ]) {
    assert.equal(isStudentTaskFilters(value), false);
  }
});

test('restoration removes inaccessible selections without losing other filters', () => {
  const saved = {
    ...defaultTaskFilters,
    query: 'SQL',
    status: 'revision',
    subjectId: 'another-group-subject',
    type: 'unknown',
  };
  const actual = normalizeTaskFilters(saved, [{ subjectId: 'my-subject', type: 'Практика' }]);
  assert.deepEqual(actual, { ...saved, subjectId: '', type: '' });
  assert.equal(saved.subjectId, 'another-group-subject');
});

test('available selections survive restoration and disappear when access changes', () => {
  const saved = { ...defaultTaskFilters, subjectId: 'my-subject', type: 'Практика' };
  assert.deepEqual(
    normalizeTaskFilters(saved, [{ subjectId: 'my-subject', type: 'Практика' }]),
    saved,
  );
  assert.deepEqual(normalizeTaskFilters(saved, []), defaultTaskFilters);
});
