import type { Mark } from './api-contract';
import type { Locale } from './i18n';
import { matchesDeadline, type DeadlineFilter } from './deadlines';

export type ReviewDraft = { grade: Mark | null; comment: string; version: number };

/** A completed request may only remove the draft that it actually published. */
export function discardPublishedReviewDraft(
  reviews: Record<string, ReviewDraft>,
  id: string,
  published: ReviewDraft,
): Record<string, ReviewDraft> {
  const current = reviews[id];
  if (
    !current ||
    current.grade !== published.grade ||
    current.comment !== published.comment ||
    current.version !== published.version
  )
    return reviews;
  const next = { ...reviews };
  delete next[id];
  return next;
}

export type TeacherTaskFilters = {
  groupId: string;
  subjectId: string;
  type: string;
  query: string;
  assignmentId: string;
  status: 'all' | 'submitted' | 'reviewed' | 'revision' | 'missing';
  deadline: DeadlineFilter;
};
export const emptyTeacherFilters: TeacherTaskFilters = {
  groupId: '',
  subjectId: '',
  type: '',
  query: '',
  assignmentId: '',
  status: 'all',
  deadline: 'all',
};
export type JournalFilters = { groupId: string; subjectId: string; query: string };
export const emptyJournalFilters: JournalFilters = { groupId: '', subjectId: '', query: '' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function isReviewDrafts(value: unknown): value is Record<string, ReviewDraft> {
  return (
    isRecord(value) &&
    Object.entries(value).every(
      ([id, draft]) =>
        id.length > 0 &&
        isRecord(draft) &&
        Object.keys(draft).length === 3 &&
        (draft.grade === null ||
          (typeof draft.grade === 'number' && Number.isFinite(draft.grade))) &&
        typeof draft.comment === 'string' &&
        draft.comment.length <= 2000 &&
        typeof draft.version === 'number' &&
        Number.isInteger(draft.version) &&
        draft.version >= 1,
    )
  );
}

export function isJournalFilters(value: unknown): value is JournalFilters {
  return (
    isRecord(value) &&
    Object.keys(value).length === 3 &&
    ['groupId', 'subjectId', 'query'].every((key) => typeof value[key] === 'string')
  );
}

export function isTeacherTaskFilters(value: unknown): value is TeacherTaskFilters {
  return (
    isRecord(value) &&
    Object.keys(value).length === 7 &&
    ['groupId', 'subjectId', 'type', 'query', 'assignmentId'].every(
      (key) => typeof value[key] === 'string',
    ) &&
    typeof value.status === 'string' &&
    ['all', 'submitted', 'reviewed', 'revision', 'missing'].includes(value.status) &&
    typeof value.deadline === 'string' &&
    ['all', 'overdue', 'today', 'week'].includes(value.deadline)
  );
}

// A teacher can filter by due date even while reviewing already submitted or marked work.
export function teacherDeadlineMatches(dueAt: string, filter: DeadlineFilter, now: number) {
  return matchesDeadline(dueAt, 'missing', filter, now);
}

export function academicTypeLabel(type: string, locale: Locale) {
  const names = {
    lecture: { ru: 'Лекция', kk: 'Дәріс', en: 'Lecture' },
    practice: { ru: 'Практика', kk: 'Практика', en: 'Practice' },
    srsp: { ru: 'СРСП', kk: 'ОСӨЖ', en: 'Supervised independent study' },
  };
  return Object.hasOwn(names, type) ? names[type as keyof typeof names][locale] : type;
}

export const teacherUi = {
  ru: {
    reset: 'Сбросить фильтры',
    results: 'Найдено',
    allTypes: 'Все типы',
    allSubjects: 'Все предметы',
    allStatuses: 'Все статусы',
    discard: 'Удалить черновик',
    stale:
      'Работа изменилась после сохранения черновика. Проверьте актуальный файл и сравните результат ниже. Публикация заблокирована до подтверждения.',
    compare: 'Сверить с актуальной работой',
    confirm: 'Я сверил работу, использовать мой черновик',
    current: 'Текущий результат на сервере',
    version: 'Версия',
    noComment: 'Комментария нет',
  },
  kk: {
    reset: 'Сүзгілерді тазарту',
    results: 'Табылды',
    allTypes: 'Барлық түрлер',
    allSubjects: 'Барлық пәндер',
    allStatuses: 'Барлық күйлер',
    discard: 'Қараламаны жою',
    stale:
      'Қаралама сақталғаннан кейін жұмыс өзгерді. Өзекті файлды тексеріп, төмендегі нәтижемен салыстырыңыз. Расталғанша жариялау бұғатталған.',
    compare: 'Өзекті жұмыспен салыстыру',
    confirm: 'Жұмысты тексердім, қараламамды қолдану',
    current: 'Сервердегі өзекті нәтиже',
    version: 'Нұсқа',
    noComment: 'Пікір жоқ',
  },
  en: {
    reset: 'Reset filters',
    results: 'Results',
    allTypes: 'All types',
    allSubjects: 'All subjects',
    allStatuses: 'All statuses',
    discard: 'Delete draft',
    stale:
      'This submission changed after the draft was saved. Check the current file and compare the result below. Confirm before publishing.',
    compare: 'Compare with current submission',
    confirm: 'I checked the submission, use my draft',
    current: 'Current server result',
    version: 'Version',
    noComment: 'No comment',
  },
};
