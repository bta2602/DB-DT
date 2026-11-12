import type { Bootstrap, Room, RoomType } from './api-contract';
import { lessonPeriod } from './lesson-rules.mjs';

export const roomTypes: RoomType[] = ['computer', 'lecture', 'laboratory', 'ordinary'];
export type RoomFilters = { query: string; floor: string; type: string; occupancy: string };
export const emptyRoomFilters: RoomFilters = { query: '', floor: '', type: '', occupancy: '' };

export function isRoomFilters(value: unknown): value is RoomFilters {
  if (!value || typeof value !== 'object') return false;
  const item = value as RoomFilters;
  return (
    typeof item.query === 'string' &&
    item.query.length <= 100 &&
    typeof item.floor === 'string' &&
    /^(?:[1-9]\d?|100)?$/.test(item.floor) &&
    typeof item.type === 'string' &&
    ['', ...roomTypes].includes(item.type) &&
    ['', 'free', 'busy'].includes(item.occupancy)
  );
}

export function normalizeRoomFilters(
  filters: RoomFilters,
  rooms: Room[],
  availabilityKnown: boolean,
): RoomFilters {
  return {
    ...filters,
    floor: rooms.some((room) => String(room.floor ?? '') === filters.floor) ? filters.floor : '',
    occupancy: availabilityKnown ? filters.occupancy : '',
  };
}

export function matchesRoom(room: Room, filters: RoomFilters, occupied: boolean) {
  const query = filters.query.trim().toLocaleLowerCase();
  return (
    (!query || `${room.number ?? ''} ${room.name}`.toLocaleLowerCase().includes(query)) &&
    (!filters.floor || String(room.floor) === filters.floor) &&
    (!filters.type || room.type === filters.type) &&
    (!filters.occupancy || (filters.occupancy === 'busy' ? occupied : !occupied))
  );
}

export function groupDisplayName(program: string, intakeYear: number, language: string) {
  const prefix: Record<string, string> = { IS: 'ИС', VTIPO: 'ВТиПО', DS: 'DS' };
  if (
    !prefix[program] ||
    !Number.isInteger(intakeYear) ||
    intakeYear < 2000 ||
    intakeYear > 9998 ||
    !['kk', 'ru'].includes(language)
  )
    return '';
  return `${prefix[program]}-${String(intakeYear).slice(-2)}${language === 'kk' ? 'А' : 'Б'}`;
}

export function assignmentOptions(
  data: Bootstrap,
  groupId: string,
  subjectId: string,
  date: string,
) {
  let period;
  try {
    period = lessonPeriod(date);
  } catch {
    return { subjects: [], teachers: [] };
  }
  const group = data.groups.find((row) => row.id === groupId);
  const allowed = new Set(
    data.groupSubjects
      .filter(
        (row) =>
          row.groupId === groupId &&
          row.academicYear === period.academicYear &&
          row.semester === period.semester,
      )
      .map((row) => row.subjectId),
  );
  const subjects = data.subjects.filter((row) => allowed.has(row.id));
  const teachers =
    allowed.has(subjectId) && group?.language
      ? data.users.filter(
          (user) =>
            user.role === 'teacher' &&
            data.teacherSubjects.some(
              (row) => row.teacherId === user.id && row.subjectId === subjectId,
            ) &&
            data.teacherLanguages.some(
              (row) => row.teacherId === user.id && row.language === group.language,
            ),
        )
      : [];
  return { subjects, teachers };
}
