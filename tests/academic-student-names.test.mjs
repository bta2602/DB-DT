import assert from 'node:assert/strict';
import test from 'node:test';
import { academicStudentName } from '../database/seeds/academic-data.mjs';

test('New fictional student names use the language of the group', () => {
  assert.equal(academicStudentName(0, 'kk'), 'Айдана Серікқызы Ахметова');
  assert.equal(academicStudentName(1, 'kk'), 'Тимур Серікұлы Ахметов');
  assert.equal(academicStudentName(0, 'ru'), 'Алина Сергеевна Иванова');
  assert.equal(academicStudentName(1, 'ru'), 'Александр Сергеевич Иванов');
});

test('Generated names cover the complete roster without duplicates per language', () => {
  for (const language of ['kk', 'ru']) {
    const names = Array.from({ length: 360 }, (_, index) => academicStudentName(index, language));
    assert.equal(new Set(names).size, 360);
    assert.ok(names.every((name) => name.split(' ').length === 3));
  }
  for (const [index, language] of [
    [-1, 'kk'],
    [1.5, 'ru'],
    [0, 'en'],
  ]) {
    assert.throws(() => academicStudentName(index, language), RangeError);
  }
});
