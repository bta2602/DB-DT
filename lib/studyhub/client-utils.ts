import type { Bootstrap, Grade, Lesson, Role } from './api-contract';

export const TIME_ZONE = 'Asia/Qyzylorda';
export const roles: Record<Role, string> = {
  student: 'Студент',
  teacher: 'Преподаватель',
  admin: 'Администратор',
};
export const statusNames: Record<string, string> = {
  submitted: 'На проверке',
  reviewed: 'Проверено',
  revision: 'На доработке',
  missing: 'Не сдано',
  current: 'Сейчас',
  upcoming: 'Предстоит',
  finished: 'Завершено',
  cancelled: 'Отменено',
  selfStudy: 'СРСП',
};
export const initials = (name = '') =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('');
// Создаём форматтеры один раз, а не заново для каждой ячейки расписания.
const keyFormatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const localeTags = { ru: 'ru-RU', kk: 'kk-KZ', en: 'en-GB' };
const dateFormatters = Object.fromEntries(
  Object.entries(localeTags)
    .filter(([locale]) => locale !== 'kk')
    .map(([locale, tag]) => [
      locale,
      new Intl.DateTimeFormat(tag, {
        timeZone: TIME_ZONE,
        day: 'numeric',
        month: 'long',
      }),
    ]),
);
// Some browsers lack Kazakh month names in ICU and display “M10”. Keep the
// standard CLDR names here and use numeric date parts in the college time zone.
const kazakhMonths = [
  'қаңтар',
  'ақпан',
  'наурыз',
  'сәуір',
  'мамыр',
  'маусым',
  'шілде',
  'тамыз',
  'қыркүйек',
  'қазан',
  'қараша',
  'желтоқсан',
];
const timeFormatter = new Intl.DateTimeFormat('ru-RU', {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
export const dateKey = (date: Date | string = new Date()) => keyFormatter.format(new Date(date));
export function formatDate(value?: string | null, locale: keyof typeof localeTags = 'ru') {
  if (!value) return '—';
  const date = new Date(value.length === 10 ? value + 'T12:00:00+05:00' : value);
  if (locale === 'kk') {
    const parts = keyFormatter.formatToParts(date);
    const day = Number(parts.find((part) => part.type === 'day')?.value);
    const month = Number(parts.find((part) => part.type === 'month')?.value);
    return `${day} ${kazakhMonths[month - 1]}`;
  }
  return dateFormatters[locale].format(date);
}
export const formatTime = (value?: string | null) =>
  value ? timeFormatter.format(new Date(value)) : '—';
export function lessonDay(lesson: Pick<Lesson, 'date' | 'startsAt'>) {
  return lesson.date || (lesson.startsAt ? dateKey(lesson.startsAt) : '');
}
export function lessonSortKey(lesson: Pick<Lesson, 'date' | 'startsAt'>) {
  return lesson.startsAt || `${lesson.date}T23:59:59+05:00`;
}
export function lessonKindLabel(kind: string) {
  return (
    ({ lecture: 'Лекция', practice: 'Практика', srsp: 'СРСП' } as Record<string, string>)[kind] ||
    kind
  );
}
export function average(values: (number | string | null | undefined)[]) {
  const marks = values
    .filter(
      (value) =>
        value !== null &&
        value !== undefined &&
        (typeof value !== 'string' || value.trim() !== '') &&
        Number.isInteger(Number(value)) &&
        Number(value) >= 0 &&
        Number(value) <= 100,
    )
    .map(Number);
  return marks.length ? marks.reduce((a, b) => a + b, 0) / marks.length : null;
}
export function numericGrade(record?: Pick<Grade, 'grade' | 'status'>) {
  return record?.status === 'graded' ? record.grade : null;
}
export function gradeLabel(record?: Pick<Grade, 'grade' | 'status'>) {
  if (record?.status === 'absent') return 'Н';
  if (record?.status === 'not_required') return 'н.п.';
  return numericGrade(record) ?? '—';
}
export function lessonStatus(
  lesson: Pick<Lesson, 'status' | 'startsAt' | 'endsAt'>,
  now = Date.now(),
) {
  if (lesson.status === 'cancelled') return 'cancelled';
  if (!lesson.startsAt || !lesson.endsAt) return 'selfStudy';
  if (+new Date(lesson.endsAt) <= now) return 'finished';
  return +new Date(lesson.startsAt) <= now ? 'current' : 'upcoming';
}
export function lessonConflicts(
  candidate: Partial<Lesson> & Pick<Lesson, 'startsAt' | 'endsAt'>,
  lessons: Lesson[],
) {
  if (candidate.status === 'cancelled' || !candidate.startsAt || !candidate.endsAt) return [];
  const startsAt = candidate.startsAt;
  const endsAt = candidate.endsAt;
  return lessons.filter(
    (lesson) =>
      lesson.id !== candidate.id &&
      lesson.status !== 'cancelled' &&
      lesson.startsAt !== null &&
      lesson.endsAt !== null &&
      +new Date(lesson.startsAt) < +new Date(endsAt) &&
      +new Date(startsAt) < +new Date(lesson.endsAt) &&
      (['groupId', 'teacherId', 'roomId'] as const).some(
        (key) => lesson[key] && candidate[key] && lesson[key] === candidate[key],
      ),
  );
}
export function emptyData(): Bootstrap {
  return {
    users: [],
    groups: [],
    subjects: [],
    rooms: [],
    teachingAssignments: [],
    teacherSubjects: [],
    teacherLanguages: [],
    groupSubjects: [],
    lessons: [],
    assignments: [],
    submissions: [],
    grades: [],
    attendance: [],
    materials: [],
    announcements: [],
  };
}
