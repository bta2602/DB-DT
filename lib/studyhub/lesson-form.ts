import type { Bootstrap, Lesson, LessonInput, LessonKind } from './api-contract';
import { lessonPeriod, normalizeLessonKind } from './lesson-rules.mjs';

export function formLessonKind(value: string): LessonKind | '' {
  try {
    return normalizeLessonKind(value) as LessonKind;
  } catch {
    return '';
  }
}

export function subjectsForDate(data: Bootstrap, groupId: string, date: string) {
  let period;
  try {
    period = lessonPeriod(date);
  } catch {
    return [];
  }
  const ids = new Set(
    data.groupSubjects
      .filter(
        (row) =>
          row.groupId === groupId &&
          row.academicYear === period.academicYear &&
          row.semester === period.semester,
      )
      .map((row) => row.subjectId),
  );
  return data.subjects.filter((subject) => ids.has(subject.id));
}

export function teachersForSubject(data: Bootstrap, groupId: string, subjectId: string) {
  const group = data.groups.find((item) => item.id === groupId);
  if (!group?.language || !subjectId) return [];
  return data.users.filter(
    (user) =>
      user.role === 'teacher' &&
      data.teacherSubjects.some(
        (row) => row.teacherId === user.id && row.subjectId === subjectId,
      ) &&
      data.teacherLanguages.some(
        (row) => row.teacherId === user.id && row.language === group.language,
      ) &&
      data.teachingAssignments.some(
        (row) =>
          row.teacherId === user.id && row.groupId === groupId && row.subjectId === subjectId,
      ),
  );
}

export function practicesForGroup(data: Bootstrap, groupId: string, excludeId = '') {
  return data.lessons
    .filter(
      (lesson) =>
        lesson.id !== excludeId &&
        lesson.groupId === groupId &&
        lesson.status === 'scheduled' &&
        formLessonKind(lesson.kind) === 'practice' &&
        subjectsForDate(data, groupId, lesson.date).some(
          (subject) => subject.id === lesson.subjectId,
        ) &&
        teachersForSubject(data, groupId, lesson.subjectId).some(
          (teacher) => teacher.id === lesson.teacherId,
        ),
    )
    .sort((a, b) => (a.startsAt || '').localeCompare(b.startsAt || ''));
}

export function srspInput(practice: Lesson, note: string): LessonInput {
  return {
    kind: 'srsp',
    groupId: practice.groupId,
    subjectId: practice.subjectId,
    teacherId: practice.teacherId,
    practiceId: practice.id,
    date: practice.date,
    roomId: null,
    slotId: null,
    startsAt: null,
    endsAt: null,
    note,
  };
}
