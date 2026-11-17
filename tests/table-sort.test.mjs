import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextSort, sortRows } from '../lib/studyhub/table-sort.ts';

test('natural room numbers, stable equal cells, original array unchanged', () => {
  const rows = [
    { value: '1101', id: 1 },
    { value: '201', id: 2 },
    { value: '201', id: 3 },
  ];
  const result = sortRows(rows, { key: 'room', direction: 'asc' }, (row) => row.value);
  assert.deepEqual(
    result.map((row) => row.id),
    [2, 3, 1],
  );
  assert.deepEqual(
    rows.map((row) => row.id),
    [1, 2, 3],
  );
});

test('numeric grades preserve zero; empty and nonnumeric cells remain last in both directions', () => {
  const rows = [null, 100, 9, 0, undefined, NaN];
  assert.deepEqual(
    sortRows(rows, { key: 'grade', direction: 'asc' }, (row) => row),
    [0, 9, 100, null, undefined, NaN],
  );
  assert.deepEqual(
    sortRows(rows, { key: 'grade', direction: 'desc' }, (row) => row),
    [100, 9, 0, null, undefined, NaN],
  );
});

test('switching columns resets direction, sorting happens before taking a page', () => {
  assert.deepEqual(nextSort({ key: 'date', direction: 'asc' }, 'date'), {
    key: 'date',
    direction: 'desc',
  });
  assert.deepEqual(nextSort({ key: 'date', direction: 'desc' }, 'name'), {
    key: 'name',
    direction: 'asc',
  });
  const result = sortRows([30, 20, 10], { key: 'score', direction: 'asc' }, (row) => row);
  assert.deepEqual(result.slice(0, 2), [10, 20]);
});
