export const lessonKinds = ['lecture', 'practice', 'srsp'];
export const lessonSlots = [
  ['08:00', '08:50'],
  ['08:55', '09:45'],
  ['09:50', '10:40'],
  ['10:55', '11:45'],
  ['11:50', '12:40'],
  ['12:45', '13:35'],
  ['13:50', '14:40'],
  ['14:45', '15:35'],
  ['15:40', '16:30'],
  ['16:45', '17:35'],
  ['17:40', '18:30'],
  ['18:35', '19:25'],
].map(([start, end], index) => ({ id: `p${index + 1}`, start, end }));

export function validateLessonDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new RangeError('Некорректная дата занятия.');
  const parsed = new Date(`${value}T00:00:00Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value ||
    Number(value.slice(0, 4)) < 1000
  )
    throw new RangeError('Некорректная дата занятия.');
  return value;
}

export function campusDate(value = Date.now()) {
  const time = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(time)) throw new RangeError('Некорректная дата занятия.');
  return new Date(time + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function lessonPeriod(date) {
  validateLessonDate(date);
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return { academicYear: month >= 9 ? year : year - 1, semester: month >= 9 ? 1 : 2 };
}

export function lessonInterval(date, slotId) {
  validateLessonDate(date);
  const slot = lessonSlots.find((item) => item.id === slotId);
  if (!slot) throw new RangeError('Выберите существующую пару.');
  return {
    date,
    slotId,
    startsAt: new Date(`${date}T${slot.start}:00+05:00`).toISOString(),
    endsAt: new Date(`${date}T${slot.end}:00+05:00`).toISOString(),
  };
}

export function slotForInterval(startsAt, endsAt) {
  const date = campusDate(startsAt);
  return (
    lessonSlots.find((slot) => {
      const interval = lessonInterval(date, slot.id);
      return interval.startsAt === startsAt && interval.endsAt === endsAt;
    })?.id ?? null
  );
}

export function normalizeLessonKind(value) {
  const legacy = {
    Лекция: 'lecture',
    Практика: 'practice',
    'Практическая работа': 'practice',
    'Лабораторная работа': 'practice',
    СРСП: 'srsp',
  };
  if (typeof value !== 'string') throw new RangeError('Выберите тип занятия.');
  const kind = legacy[value.trim()] || value.trim();
  if (!lessonKinds.includes(kind)) throw new RangeError('Выберите лекцию, практику или СРСП.');
  return kind;
}

export function intervalsOverlap(first, second) {
  return (
    first.startsAt != null &&
    first.endsAt != null &&
    second.startsAt != null &&
    second.endsAt != null &&
    Date.parse(first.startsAt) < Date.parse(second.endsAt) &&
    Date.parse(second.startsAt) < Date.parse(first.endsAt)
  );
}

export function findLessonConflict(candidate, lessons) {
  if (candidate.kind === 'srsp' || candidate.status !== 'scheduled') return undefined;
  return lessons.find(
    (lesson) =>
      lesson.id !== candidate.id &&
      lesson.status === 'scheduled' &&
      lesson.kind !== 'srsp' &&
      (lesson.groupId === candidate.groupId ||
        lesson.teacherId === candidate.teacherId ||
        lesson.roomId === candidate.roomId) &&
      intervalsOverlap(candidate, lesson),
  );
}
