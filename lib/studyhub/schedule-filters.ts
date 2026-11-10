import type { Bootstrap, Lesson, User } from './api-contract';

export type ScheduleFilters = {
  group: string;
  teacher: string;
  subject: string;
  room: string;
  kind: string;
  mode: 'day' | 'week';
};

export const emptyScheduleFilters: ScheduleFilters = {
  group: '',
  teacher: '',
  subject: '',
  room: '',
  kind: '',
  mode: 'day',
};

export function isScheduleFilters(value: unknown): value is ScheduleFilters {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    ['group', 'teacher', 'subject', 'room', 'kind'].every(
      (key) => typeof record[key] === 'string',
    ) &&
    (record.mode === 'day' || record.mode === 'week')
  );
}

/** Scope records before applying any optional user-selected filter. */
export function scheduleScope(data: Bootstrap, user: User | null) {
  const lessons = data.lessons.filter((lesson) => {
    if (user?.role === 'admin') return true;
    if (user?.role === 'teacher') return lesson.teacherId === user.id;
    return Boolean(user?.groupId && lesson.groupId === user.groupId);
  });
  const assignments = data.teachingAssignments.filter((item) => {
    if (user?.role === 'admin') return true;
    if (user?.role === 'teacher') return item.teacherId === user.id;
    return Boolean(user?.groupId && item.groupId === user.groupId);
  });
  const groupIds = new Set([...lessons, ...assignments].map((item) => item.groupId));
  const subjectIds = new Set([...lessons, ...assignments].map((item) => item.subjectId));
  const teacherIds = new Set([...lessons, ...assignments].map((item) => item.teacherId));
  const roomIds = new Set(lessons.map((item) => item.roomId));
  const admin = user?.role === 'admin';
  return {
    lessons,
    groups: data.groups.filter((item) => admin || groupIds.has(item.id)),
    subjects: data.subjects.filter((item) => admin || subjectIds.has(item.id)),
    teachers: data.users.filter(
      (item) => item.role === 'teacher' && (admin || teacherIds.has(item.id)),
    ),
    rooms: data.rooms.filter((item) => admin || roomIds.has(item.id)),
    kinds: [...new Set(lessons.map((item) => item.kind))].sort(),
  };
}

export function normalizeScheduleFilters(
  value: ScheduleFilters,
  scope: ReturnType<typeof scheduleScope>,
  user: User | null,
): ScheduleFilters {
  const available = (items: { id: string }[], id: string) =>
    items.some((item) => item.id === id) ? id : '';
  return {
    group: user?.role === 'student' ? '' : available(scope.groups, value.group),
    teacher: user?.role === 'teacher' ? '' : available(scope.teachers, value.teacher),
    subject: available(scope.subjects, value.subject),
    room: available(scope.rooms, value.room),
    kind: scope.kinds.includes(value.kind) ? value.kind : '',
    mode: value.mode,
  };
}

export function matchesScheduleFilters(lesson: Lesson, filters: ScheduleFilters) {
  return (
    (!filters.group || lesson.groupId === filters.group) &&
    (!filters.teacher || lesson.teacherId === filters.teacher) &&
    (!filters.subject || lesson.subjectId === filters.subject) &&
    (!filters.room || lesson.roomId === filters.room) &&
    (!filters.kind || lesson.kind === filters.kind)
  );
}

export const scheduleFilterLabels = {
  ru: {
    allTeachers: 'Все преподаватели',
    allRooms: 'Все аудитории',
    allSubjects: 'Все предметы',
    allKinds: 'Все типы',
    reset: 'Сбросить фильтры',
    results: 'Найдено занятий',
    occupiedRooms: 'Аудиторий на выбранных занятиях',
    previous: 'Назад',
    next: 'Вперёд',
    allCourses: 'Все курсы',
    allOccupancy: 'Любая занятость',
    busy: 'Занята сейчас',
    occupancy: 'Занятость',
    found: 'Найдено записей',
    storageError: 'Не удалось сохранить фильтры в браузере. Они действуют до закрытия страницы.',
    lecture: 'Лекция',
    practice: 'Практика',
    srsp: 'СРСП',
  },
  kk: {
    allTeachers: 'Барлық оқытушылар',
    allRooms: 'Барлық аудиториялар',
    allSubjects: 'Барлық пәндер',
    allKinds: 'Барлық түрлер',
    reset: 'Сүзгілерді тазарту',
    results: 'Табылған сабақтар',
    occupiedRooms: 'Таңдалған сабақтардың аудиториялары',
    previous: 'Артқа',
    next: 'Алға',
    allCourses: 'Барлық курстар',
    allOccupancy: 'Кез келген күй',
    busy: 'Қазір бос емес',
    occupancy: 'Бос болуы',
    found: 'Табылған жазбалар',
    storageError: 'Сүзгілер браузерде сақталмады. Олар бет жабылғанға дейін қолданылады.',
    lecture: 'Дәріс',
    practice: 'Практика',
    srsp: 'ОСӨЖ',
  },
  en: {
    allTeachers: 'All teachers',
    allRooms: 'All rooms',
    allSubjects: 'All subjects',
    allKinds: 'All types',
    reset: 'Reset filters',
    results: 'Lessons found',
    occupiedRooms: 'Rooms used by selected lessons',
    previous: 'Previous',
    next: 'Next',
    allCourses: 'All years',
    allOccupancy: 'Any occupancy',
    busy: 'Occupied now',
    occupancy: 'Occupancy',
    found: 'Records found',
    storageError: 'Filters could not be saved in this browser. They apply until the page closes.',
    lecture: 'Lecture',
    practice: 'Practice',
    srsp: 'Guided independent study',
  },
};
