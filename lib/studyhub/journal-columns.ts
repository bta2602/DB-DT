import type { Assignment, Grade, Lesson } from './api-contract';
import { assessmentKind } from './assessment-kind.mjs';
import { dateKey } from './client-utils';

export const journalModes = ['lecture', 'practice-srsp', 'all'] as const;
export type JournalMode = (typeof journalModes)[number];
type Category = ReturnType<typeof assessmentKind>;

type JournalColumn = {
  kind: 'lesson' | 'assignment';
  id: string;
  date: string;
  category: Category;
  title: string;
  editable: boolean;
};

const groupOrder: Record<Category, number> = { lecture: 0, practice: 1, srsp: 2 };

export function journalColumns(
  lessons: Lesson[],
  assignments: Assignment[],
  grades: Pick<Grade, 'lessonId'>[],
  mode: JournalMode,
): JournalColumn[] {
  const graded = new Set(grades.map((grade) => grade.lessonId));
  const columns: JournalColumn[] = [
    ...lessons
      .filter(
        (lesson) =>
          graded.has(lesson.id) ||
          (lesson.kind !== 'srsp' && !lesson.archivedAt && lesson.status !== 'cancelled'),
      )
      .map((lesson) => ({
        kind: 'lesson' as const,
        id: lesson.id,
        date: lesson.startsAt || lesson.date,
        category: assessmentKind(lesson.kind),
        title: '',
        editable: lesson.kind !== 'srsp' && !lesson.archivedAt && lesson.status !== 'cancelled',
      })),
    ...assignments.map((assignment) => ({
      kind: 'assignment' as const,
      id: assignment.id,
      date: assignment.dueAt,
      category: assessmentKind(assignment.type),
      title: assignment.title,
      editable: false,
    })),
  ];
  return columns
    .filter((column) => {
      if (mode === 'all') return true;
      return mode === 'lecture' ? column.category === 'lecture' : column.category !== 'lecture';
    })
    .sort(
      (a, b) =>
        groupOrder[a.category] - groupOrder[b.category] ||
        (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0) ||
        a.id.localeCompare(b.id),
    );
}

/** Use the college's local calendar date for timestamps near midnight. */
export function journalDate(value: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return '—';
  const [, month, day] = (/^\d{4}-\d{2}-\d{2}$/.test(value) ? value : dateKey(value)).split('-');
  return `${day}.${month}`;
}

export function journalStudentName(user: {
  name: string;
  familyName?: string | null;
  givenName?: string | null;
  patronymic?: string | null;
}) {
  return user.familyName && user.givenName
    ? [user.familyName, user.givenName, user.patronymic].filter(Boolean).join(' ')
    : user.name;
}

export const journalModeLabels = {
  ru: {
    group: 'Вид журнала',
    lecture: 'Лекции',
    'practice-srsp': 'Практика и СРСП',
    all: 'Общий журнал',
  },
  kk: {
    group: 'Журнал түрі',
    lecture: 'Дәрістер',
    'practice-srsp': 'Практика және ОСӨЖ',
    all: 'Жалпы журнал',
  },
  en: {
    group: 'Gradebook view',
    lecture: 'Lectures',
    'practice-srsp': 'Practice and independent study',
    all: 'Full gradebook',
  },
};
