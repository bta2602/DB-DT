export const TIME_ZONE = 'Asia/Qyzylorda';
export const dateKey = (date = new Date()) => new Intl.DateTimeFormat('sv-SE', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(date));
export const validGrade = value => value !== null && value !== '' && [2, 3, 4, 5].includes(Number(value));
export function average(values) { const grades = values.filter(validGrade).map(Number); return grades.length ? grades.reduce((a,b) => a+b,0)/grades.length : null; }
export function lessonStatus(lesson, now = Date.now()) {
  if (lesson.status === 'cancelled') return 'cancelled';
  if (+new Date(lesson.endsAt) <= now) return 'finished';
  return +new Date(lesson.startsAt) <= now ? 'current' : 'upcoming';
}
export function lessonConflicts(candidate, lessons) {
  if (candidate.status === 'cancelled') return [];
  return lessons.filter(l => l.id !== candidate.id && l.status !== 'cancelled' &&
    +new Date(l.startsAt) < +new Date(candidate.endsAt) && +new Date(candidate.startsAt) < +new Date(l.endsAt) &&
    ['groupId','teacherId','roomId'].some(key => l[key] && candidate[key] && l[key] === candidate[key]));
}
export function markUnmarked(entries, studentIds) {
  const next = { ...entries };
  for (const id of studentIds) if (!['present','absent','late','excused'].includes(next[id])) next[id] = 'present';
  return next;
}
export function emptyData() { return Object.fromEntries(['users','groups','subjects','rooms','teachingAssignments','lessons','assignments','submissions','grades','attendance','materials','announcements'].map(key => [key, []])); }
