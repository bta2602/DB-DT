import { dateKey } from './client-utils';

export type DeadlineFilter = 'all' | 'overdue' | 'today' | 'week';

export const deadlineFilters: DeadlineFilter[] = ['all', 'overdue', 'today', 'week'];

export const deadlineLabels = {
  ru: {
    title: 'Срок задания',
    all: 'Любой срок',
    overdue: 'Просрочено',
    today: 'Сегодня',
    week: 'На этой неделе',
    soon: 'Меньше суток до сдачи',
    count: 'Просроченных заданий',
    empty: 'Измените поисковый запрос, статус или срок задания.',
  },
  kk: {
    title: 'Тапсыру мерзімі',
    all: 'Барлық мерзімдер',
    overdue: 'Мерзімі өткен',
    today: 'Бүгін',
    week: 'Осы аптада',
    soon: '24 сағаттан аз қалды',
    count: 'Мерзімі өткен тапсырмалар',
    empty: 'Іздеу сұрауын, тапсырма күйін немесе тапсыру мерзімін өзгертіңіз.',
  },
  en: {
    title: 'Deadline',
    all: 'Any deadline',
    overdue: 'Overdue',
    today: 'Today',
    week: 'This week',
    soon: 'Less than 24 hours left',
    count: 'Overdue assignments',
    empty: 'Change your search, assignment status or deadline filter.',
  },
};

function needsWork(status: string) {
  return status === 'missing' || status === 'revision';
}

export function deadlineFlag(dueAt: string, status: string, now: number) {
  const due = Date.parse(dueAt);
  if (!needsWork(status) || !Number.isFinite(due)) return null;
  if (due < now) return 'overdue';
  return due - now < 24 * 60 * 60 * 1000 ? 'soon' : null;
}

export function matchesDeadline(
  dueAt: string,
  status: string,
  filter: DeadlineFilter,
  now: number,
) {
  if (filter === 'all') return true;
  const due = Date.parse(dueAt);
  if (!needsWork(status) || !Number.isFinite(due)) return false;
  if (filter === 'overdue') return due < now;

  const today = dateKey(new Date(now));
  const dueDay = dateKey(dueAt);
  if (filter === 'today') return dueDay === today;

  // Use the project's calendar date; UTC arithmetic avoids the computer's time zone.
  const monday = new Date(today + 'T12:00:00Z');
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const start = monday.toISOString().slice(0, 10);
  monday.setUTCDate(monday.getUTCDate() + 7);
  const end = monday.toISOString().slice(0, 10);
  return dueDay >= start && dueDay < end;
}
