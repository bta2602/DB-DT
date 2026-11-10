import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

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
      )
        throw error;
      return nextResolve(`${specifier}.ts`, context);
    }
  },
});
let filters;
try {
  filters = await import('../lib/studyhub/teacher-filters.ts');
} finally {
  typescriptImports.deregister();
}

test('review draft validation preserves the captured submission version', () => {
  const stored = { work1: { grade: 84, comment: 'Check the last step', version: 2 } };
  const restored = JSON.parse(JSON.stringify(stored));
  assert.equal(filters.isReviewDrafts(restored), true);
  assert.deepEqual(restored, stored);
  // A resubmission at version 3 must not silently rebase the restored draft.
  assert.notEqual(restored.work1.version, 3);
  assert.equal(filters.isReviewDrafts({ work1: { grade: null, comment: '', version: 1 } }), true);
});

test('a delayed publication preserves a newer draft for the same work and other work', async () => {
  const captured = { grade: 84, comment: 'Original review', version: 2 };
  const other = { grade: null, comment: 'Another student', version: 1 };
  for (const newer of [
    { ...captured, grade: 91 },
    { ...captured, comment: 'Revised after reopening' },
    { ...captured, version: 3 },
  ]) {
    let reviews = { workA: captured };
    let completeRequest;
    const publication = new Promise((resolve) => {
      completeRequest = resolve;
    }).then(() => {
      reviews = filters.discardPublishedReviewDraft(reviews, 'workA', captured);
    });
    // The original editor was closed; the same work and another work were edited
    // while the publication response was still pending.
    reviews = { workA: newer, workB: other };
    completeRequest();
    await publication;
    assert.deepEqual(reviews, { workA: newer, workB: other });
  }
});

test('publication removes only its unchanged draft without mutating unrelated drafts', () => {
  const published = { grade: 84, comment: 'Ready to publish', version: 2 };
  const other = { grade: null, comment: 'Keep this draft', version: 1 };
  const reviews = { workA: { ...published }, workB: other };
  const after = filters.discardPublishedReviewDraft(reviews, 'workA', published);
  assert.deepEqual(after, { workB: other });
  assert.deepEqual(reviews, { workA: published, workB: other });
  assert.equal(filters.discardPublishedReviewDraft(after, 'workA', published), after);
});

test('academic type captions translate stable codes and preserve arbitrary legacy labels', () => {
  assert.equal(filters.academicTypeLabel('lecture', 'en'), 'Lecture');
  for (const label of ['Лабораторная работа', 'toString', 'constructor', '__proto__']) {
    assert.equal(filters.academicTypeLabel(label, 'en'), label);
  }
});

test('review drafts reject malformed values and extra sensitive fields', () => {
  const valid = { grade: null, comment: '', version: 1 };
  for (const value of [
    null,
    [],
    { work1: null },
    { work1: { ...valid, version: '1' } },
    { work1: { ...valid, version: 0 } },
    { work1: { ...valid, version: 1.5 } },
    { work1: { ...valid, grade: NaN } },
    { work1: { ...valid, grade: '80' } },
    { work1: { ...valid, comment: 'x'.repeat(2001) } },
    { work1: { ...valid, token: 'must-not-be-retained' } },
  ]) {
    assert.equal(filters.isReviewDrafts(value), false);
  }
});

test('journal and teacher filters validate every stored field', () => {
  assert.equal(filters.isJournalFilters(filters.emptyJournalFilters), true);
  assert.equal(filters.isTeacherTaskFilters(filters.emptyTeacherFilters), true);
  assert.equal(filters.isJournalFilters({ groupId: '', subjectId: '', query: null }), false);
  assert.equal(
    filters.isTeacherTaskFilters({ ...filters.emptyTeacherFilters, status: 'admin' }),
    false,
  );
  assert.equal(
    filters.isTeacherTaskFilters({ ...filters.emptyTeacherFilters, deadline: 'tomorrow' }),
    false,
  );
  assert.equal(filters.isTeacherTaskFilters({ ...filters.emptyTeacherFilters, query: [] }), false);
  assert.equal(
    filters.isTeacherTaskFilters({ ...filters.emptyTeacherFilters, token: 'secret' }),
    false,
  );
});

test('teacher deadline filter uses school calendar and permits checking completed work', () => {
  const now = Date.parse('2026-11-10T19:10:00Z'); // November 11 at 00:10, school time.
  assert.equal(filters.teacherDeadlineMatches('2026-11-10T19:01:00Z', 'today', now), true);
  assert.equal(filters.teacherDeadlineMatches('2026-11-10T18:59:00Z', 'today', now), false);
  assert.equal(filters.teacherDeadlineMatches('2026-11-10T18:59:00Z', 'overdue', now), true);
  assert.equal(filters.teacherDeadlineMatches('2026-11-15T18:59:00Z', 'week', now), true);
  assert.equal(filters.teacherDeadlineMatches('2026-11-15T19:00:00Z', 'week', now), false);
  assert.equal(filters.teacherDeadlineMatches('invalid', 'today', now), false);
});
