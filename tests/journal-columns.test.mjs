import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { assessmentKind } from '../lib/studyhub/assessment-kind.mjs';

const typescriptImports = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === './client-utils' && context.parentURL?.endsWith('/journal-columns.ts'))
      return nextResolve('./client-utils.ts', context);
    return nextResolve(specifier, context);
  },
});
const { journalColumns, journalDate, journalStudentName } =
  await import('../lib/studyhub/journal-columns.ts');
typescriptImports.deregister();

const lesson = (id, kind, date, props = {}) => ({
  id,
  kind,
  startsAt: null,
  date,
  status: 'scheduled',
  ...props,
});

test('journal views order lectures, practice, and SRSP while keeping each grade link', () => {
  const lessons = [
    lesson('practice-early', 'Практика', '2026-11-03'),
    lesson('legacy-lab', 'Лабораторная', '2026-11-01'),
    lesson('project', 'Проектная работа', '2026-11-05'),
    lesson('lecture-late', 'Лекция', '2026-11-30'),
    lesson('srsp-without-mark', 'srsp', '2026-11-03'),
  ];
  const work = [
    { id: 'lecture-work', type: 'lecture', dueAt: '2026-11-20T20:20:00Z', title: 'Notes' },
    {
      id: 'independent-work',
      type: 'Самостоятельная работа',
      dueAt: '2026-11-02T20:20:00Z',
      title: 'Article',
    },
  ];
  const grades = [{ lessonId: 'legacy-lab' }];
  assert.deepEqual(
    journalColumns(lessons, work, grades, 'all').map((column) => [column.id, column.category]),
    [
      ['lecture-work', 'lecture'],
      ['lecture-late', 'lecture'],
      ['practice-early', 'practice'],
      ['project', 'practice'],
      ['legacy-lab', 'srsp'],
      ['independent-work', 'srsp'],
    ],
  );
  assert.deepEqual(
    journalColumns(lessons, work, grades, 'lecture').map((column) => column.id),
    ['lecture-work', 'lecture-late'],
  );
  assert.deepEqual(
    journalColumns(lessons, work, grades, 'practice-srsp').map((column) => column.id),
    ['practice-early', 'project', 'legacy-lab', 'independent-work'],
  );
  assert.equal(lessons[1].kind, 'Лабораторная');
  assert.equal(work[1].type, 'Самостоятельная работа');
});

test('archived lesson marks and imported direct SRSP marks remain accessible but read-only', () => {
  const lessons = [
    lesson('cancelled', 'lecture', '2026-11-30', { status: 'cancelled' }),
    lesson('archived', 'practice', '2026-11-30', { archivedAt: '2026-11-12T00:00:00Z' }),
    lesson('actual-srsp', 'srsp', '2026-11-29'),
    lesson('archived-unmarked', 'practice', '2026-11-30', { archivedAt: '2026-11-12T00:00:00Z' }),
  ];
  const grades = ['cancelled', 'archived', 'actual-srsp'].map((lessonId) => ({ lessonId }));
  assert.deepEqual(
    journalColumns(lessons, [], grades, 'all').map(({ id, editable }) => [id, editable]),
    [
      ['cancelled', false],
      ['archived', false],
      ['actual-srsp', false],
    ],
  );
});

test('journal uses DD.MM in the college timezone and puts the family name first', () => {
  assert.equal(journalDate('2026-11-30'), '30.11');
  assert.equal(journalDate('2026-11-29T20:00:00Z'), '30.11');
  assert.equal(journalDate('2026-01-02T05:00:00Z'), '02.01');
  assert.equal(journalDate('invalid'), '—');
  assert.equal(
    journalStudentName({ name: 'Айдана Абишева', familyName: 'Абишева', givenName: 'Айдана' }),
    'Абишева Айдана',
  );
  assert.equal(
    journalStudentName({
      name: 'Айдана Абишева',
      familyName: 'Абишева',
      givenName: 'Айдана',
      patronymic: 'Сериковна',
    }),
    'Абишева Айдана Сериковна',
  );
});

test('legacy laboratory and independent assignments use the SRSP category', () => {
  assert.equal(assessmentKind('Лабораторная работа'), 'srsp');
  assert.equal(assessmentKind('Самостоятельная работа'), 'srsp');
  assert.equal(assessmentKind('Мини-проект'), 'practice');
});
