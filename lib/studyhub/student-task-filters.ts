import type { Assignment } from './api-contract';
import type { DeadlineFilter } from './deadlines';

export const taskStatuses = ['all', 'missing', 'submitted', 'revision', 'reviewed'] as const;
export type StudentTaskFilters = {
  query: string;
  status: (typeof taskStatuses)[number];
  deadline: DeadlineFilter;
  subjectId: string;
  type: string;
};

export const defaultTaskFilters: StudentTaskFilters = {
  query: '',
  status: 'all',
  deadline: 'all',
  subjectId: '',
  type: '',
};

export function isStudentTaskFilters(value: unknown): value is StudentTaskFilters {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.query === 'string' &&
    item.query.length <= 500 &&
    typeof item.status === 'string' &&
    taskStatuses.some((status) => status === item.status) &&
    typeof item.deadline === 'string' &&
    ['all', 'overdue', 'today', 'week'].includes(item.deadline) &&
    typeof item.subjectId === 'string' &&
    typeof item.type === 'string'
  );
}

/** Only selections present in this student's authorized assignments can be restored. */
export function normalizeTaskFilters(
  value: StudentTaskFilters,
  assignments: Assignment[],
): StudentTaskFilters {
  return {
    ...value,
    subjectId: assignments.some((item) => item.subjectId === value.subjectId)
      ? value.subjectId
      : '',
    type: assignments.some((item) => item.type === value.type) ? value.type : '',
  };
}

export const studentFilterLabels = {
  ru: {
    subject: 'Предмет',
    type: 'Тип задания',
    allSubjects: 'Все предметы',
    allTypes: 'Все типы',
    reset: 'Сбросить фильтры',
    results: 'Найдено заданий',
    empty: 'Измените поиск, предмет, тип, статус или срок задания.',
  },
  kk: {
    subject: 'Пән',
    type: 'Тапсырма түрі',
    allSubjects: 'Барлық пәндер',
    allTypes: 'Барлық түрлер',
    reset: 'Сүзгілерді тазарту',
    results: 'Табылған тапсырмалар',
    empty: 'Іздеуді, пәнді, түрді, күйді немесе мерзімді өзгертіңіз.',
  },
  en: {
    subject: 'Subject',
    type: 'Assignment type',
    allSubjects: 'All subjects',
    allTypes: 'All types',
    reset: 'Reset filters',
    results: 'Assignments found',
    empty: 'Change the search, subject, type, status or deadline.',
  },
};
