import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewedJournalTarget, reviewJournalHref } from '../lib/studyhub/review-journal.ts';

const reviewed = {
  assignment: { id: 'task-1' },
  student: { id: 'student-1' },
  work: { id: 'work-1', status: 'reviewed' },
};
const submitted = {
  assignment: { id: 'task-1' },
  student: { id: 'student-2' },
  work: { id: 'work-2', status: 'submitted' },
};
const records = [reviewed, submitted];

test('journal navigation targets the exact graded submission, not a student with a similar name', () => {
  assert.equal(reviewedJournalTarget(records, 'task-1', 'student-1', 'work-1'), reviewed);
  assert.equal(reviewedJournalTarget(records, 'task-1', 'student-2', 'work-1'), undefined);
  assert.equal(reviewedJournalTarget(records, 'another-task', 'student-1', 'work-1'), undefined);
});

test('unreviewed, missing and out-of-scope submissions cannot become highlighted journal targets', () => {
  assert.equal(reviewedJournalTarget(records, 'task-1', 'student-2', 'work-2'), undefined);
  assert.equal(reviewedJournalTarget(records, '', 'student-1', 'work-1'), undefined);
  assert.equal(reviewedJournalTarget([], 'task-1', 'student-1', 'work-1'), undefined);
});

test('navigation round-trips identifiers and never treats an identifier as a redirect', () => {
  const href = reviewJournalHref('task&a=2', 'student/1', 'https://example.org/#work');
  const url = new URL(href, 'http://localhost:3000');
  assert.equal(url.pathname, '/journal');
  assert.equal(url.origin, 'http://localhost:3000');
  assert.equal(url.searchParams.get('assignmentId'), 'task&a=2');
  assert.equal(url.searchParams.get('studentId'), 'student/1');
  assert.equal(url.searchParams.get('reviewId'), 'https://example.org/#work');
});
