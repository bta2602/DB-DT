import assert from 'node:assert/strict';
import test from 'node:test';
import { finalGradeFor } from '../lib/studyhub/final-grade.mjs';

test('Final grade weights the mean of the two ratings at 60% and the exam at 40%', () => {
  assert.equal(finalGradeFor({ r1: 80, r2: 90, examScore: 70, rk1: 100, rk2: 0 }), 79);
  assert.equal(finalGradeFor({ r1: 100, r2: 100, examScore: 0 }), 60);
  assert.equal(finalGradeFor({ r1: 0, r2: 0, examScore: 100 }), 40);
  assert.equal(finalGradeFor({ r1: 0, r2: 0, examScore: 0 }), 0);
  assert.equal(finalGradeFor({ r1: 100, r2: 100, examScore: 100 }), 100);
  assert.equal(finalGradeFor({ r1: 80.01, r2: 90, examScore: 70 }), 79.003);
});

test('An incomplete or invalid grade stays blank', () => {
  for (const field of ['r1', 'r2', 'examScore']) {
    for (const value of [null, undefined, '', NaN, -1, 100.01, 0.001]) {
      assert.equal(finalGradeFor({ r1: 80, r2: 90, examScore: 70, [field]: value }), null);
    }
  }
});
