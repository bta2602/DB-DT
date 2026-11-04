import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

// Match the bundler's extensionless TypeScript imports without compiling a copy
// of the deadline logic or changing the application's module configuration.
const typescriptImports = registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (
        error.code !== 'ERR_MODULE_NOT_FOUND' ||
        !specifier.startsWith('.') ||
        !context.parentURL?.endsWith('.ts') ||
        /\.[a-z]+$/i.test(specifier)
      ) {
        throw error;
      }
      return nextResolve(`${specifier}.ts`, context);
    }
  },
});
let deadlineFlag, matchesDeadline;
try {
  ({ deadlineFlag, matchesDeadline } = await import('../lib/studyhub/deadlines.ts'));
} finally {
  typescriptImports.deregister();
}

const now = Date.parse('2026-11-04T10:00:00Z');
const day = 24 * 60 * 60 * 1000;
const at = (offset) => new Date(now + offset).toISOString();

test('missing and returned work warn at the overdue and 24-hour boundaries', () => {
  for (const status of ['missing', 'revision']) {
    for (const [offset, expected] of [
      [-1, 'overdue'],
      [0, 'soon'],
      [1, 'soon'],
      [day - 1, 'soon'],
      [day, null],
      [day + 1, null],
    ]) {
      assert.equal(deadlineFlag(at(offset), status, now), expected, `${status}, ${offset} ms`);
    }
    assert.equal(matchesDeadline(at(-1), status, 'overdue', now), true);
    assert.equal(matchesDeadline(at(0), status, 'overdue', now), false);
    assert.equal(matchesDeadline(at(1), status, 'overdue', now), false);
  }
});

test('submitted and reviewed work never need a deadline warning or action filter', () => {
  for (const status of ['submitted', 'reviewed']) {
    for (const dueAt of [at(-1), at(0), at(1), at(day)]) {
      assert.equal(deadlineFlag(dueAt, status, now), null, status);
      assert.equal(matchesDeadline(dueAt, status, 'all', now), true, status);
      for (const filter of ['overdue', 'today', 'week']) {
        assert.equal(matchesDeadline(dueAt, status, filter, now), false, `${status}, ${filter}`);
      }
    }
  }
});

test('invalid deadlines stay in the unfiltered list without crashing date filters', () => {
  for (const dueAt of ['', 'not-a-date']) {
    for (const status of ['missing', 'revision', 'submitted', 'reviewed']) {
      assert.equal(deadlineFlag(dueAt, status, now), null);
      assert.equal(matchesDeadline(dueAt, status, 'all', now), true);
      for (const filter of ['overdue', 'today', 'week']) {
        assert.equal(matchesDeadline(dueAt, status, filter, now), false);
      }
    }
  }
});

test('today uses Qyzylorda midnight rather than the UTC calendar day', () => {
  const lateUtc = Date.parse('2026-11-04T20:00:00Z'); // 5 November, 01:00 locally.
  for (const [dueAt, expected] of [
    ['2026-11-04T18:59:59.999Z', false],
    ['2026-11-04T19:00:00.000Z', true],
    ['2026-11-05T18:59:59.999Z', true],
    ['2026-11-05T19:00:00.000Z', false],
  ]) {
    assert.equal(matchesDeadline(dueAt, 'missing', 'today', lateUtc), expected, dueAt);
  }
  // Already-overdue work from this morning still belongs to Today's actionable work.
  assert.equal(deadlineFlag('2026-11-04T19:00:00Z', 'revision', lateUtc), 'overdue');
  assert.equal(matchesDeadline('2026-11-04T19:00:00Z', 'revision', 'today', lateUtc), true);
});

test('equivalent timestamps with different offsets receive the same deadline classification', () => {
  const lateUtc = Date.parse('2026-11-04T20:00:00Z');
  const equivalent = ['2026-11-04T19:00:00Z', '2026-11-05T00:00:00+05:00'];
  for (const dueAt of equivalent) {
    assert.equal(deadlineFlag(dueAt, 'missing', lateUtc), 'overdue');
    assert.equal(matchesDeadline(dueAt, 'missing', 'today', lateUtc), true);
    assert.equal(matchesDeadline(dueAt, 'missing', 'week', lateUtc), true);
  }
});

test('the current Monday-to-Sunday week can span two months', () => {
  const sunday = Date.parse('2026-11-01T10:00:00Z');
  for (const [dueAt, expected] of [
    ['2026-10-25T18:59:59.999Z', false],
    ['2026-10-25T19:00:00.000Z', true],
    ['2026-10-28T12:00:00.000Z', true],
    ['2026-11-01T18:59:59.999Z', true],
    ['2026-11-01T19:00:00.000Z', false],
  ]) {
    assert.equal(matchesDeadline(dueAt, 'revision', 'week', sunday), expected, dueAt);
  }
});

test('the current week can start in the previous calendar year', () => {
  const newYear = Date.parse('2027-01-01T10:00:00Z');
  for (const [dueAt, expected] of [
    ['2026-12-27T18:59:59.999Z', false],
    ['2026-12-27T19:00:00.000Z', true],
    ['2026-12-31T12:00:00.000Z', true],
    ['2027-01-03T18:59:59.999Z', true],
    ['2027-01-03T19:00:00.000Z', false],
  ]) {
    assert.equal(matchesDeadline(dueAt, 'missing', 'week', newYear), expected, dueAt);
  }
});

test('the week advances at local Monday midnight even while UTC is still Sunday', () => {
  const localMonday = Date.parse('2026-11-01T19:01:00Z');
  for (const [dueAt, expected] of [
    ['2026-11-01T18:59:59.999Z', false],
    ['2026-11-01T19:00:00.000Z', true],
    ['2026-11-08T18:59:59.999Z', true],
    ['2026-11-08T19:00:00.000Z', false],
  ]) {
    assert.equal(matchesDeadline(dueAt, 'missing', 'week', localMonday), expected, dueAt);
  }
});
