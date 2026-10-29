import type { Bootstrap, Lesson, Role } from './api-contract';

export const TIME_ZONE = 'Asia/Qyzylorda';
export const roles: Record<Role, string> = { student: 'Студент', teacher: 'Преподаватель', admin: 'Администратор' };
export const statusNames: Record<string, string> = { submitted: 'На проверке', reviewed: 'Проверено', revision: 'На доработке', missing: 'Не сдано', current: 'Сейчас', upcoming: 'Предстоит', finished: 'Завершено', cancelled: 'Отменено' };
export const initials = (name = '') => name.split(' ').filter(Boolean).slice(0, 2).map(word => word[0]).join('');
export const dateKey = (date: Date | string = new Date()) => new Intl.DateTimeFormat('sv-SE', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(date));
export const formatDate = (value?: string | null) => value ? new Intl.DateTimeFormat('ru-RU', { timeZone: TIME_ZONE, day: 'numeric', month: 'long' }).format(new Date(value.length === 10 ? value + 'T12:00:00+05:00' : value)) : '—';
export const formatTime = (value?: string | null) => value ? new Intl.DateTimeFormat('ru-RU', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) : '—';
export function average(values: (number | string | null | undefined)[]) {
  const marks = values.filter(value => value !== null && value !== undefined && value !== '' && [2, 3, 4, 5].includes(Number(value))).map(Number);
  return marks.length ? marks.reduce((a, b) => a + b, 0) / marks.length : null;
}
export function lessonStatus(lesson: Pick<Lesson, 'status' | 'startsAt' | 'endsAt'>, now = Date.now()) {
  if (lesson.status === 'cancelled') return 'cancelled';
  if (+new Date(lesson.endsAt) <= now) return 'finished';
  return +new Date(lesson.startsAt) <= now ? 'current' : 'upcoming';
}
export function lessonConflicts(candidate: Partial<Lesson> & Pick<Lesson, 'startsAt' | 'endsAt'>, lessons: Lesson[]) {
  if (candidate.status === 'cancelled') return [];
  return lessons.filter(lesson => lesson.id !== candidate.id && lesson.status !== 'cancelled' &&
    +new Date(lesson.startsAt) < +new Date(candidate.endsAt) && +new Date(candidate.startsAt) < +new Date(lesson.endsAt) &&
    (['groupId', 'teacherId', 'roomId'] as const).some(key => lesson[key] && candidate[key] && lesson[key] === candidate[key]));
}
export function emptyData(): Bootstrap {
  return { users: [], groups: [], subjects: [], rooms: [], teachingAssignments: [], lessons: [], assignments: [], submissions: [], grades: [], attendance: [], materials: [], announcements: [] };
}
