/** Чистые правила для будущего сервера. Не реализуют вход, HTTP или хранение. */
export class PolicyError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.status = status;
    this.body = { error: { code, message, ...(fields ? { fields } : {}) } };
  }
}
const deny = () => { throw new PolicyError(403, 'FORBIDDEN', 'Недостаточно прав.'); };
const invalid = (message, fields) => { throw new PolicyError(422, 'VALIDATION', message, fields); };
export const isGrade = value => Number.isInteger(value) && [2, 3, 4, 5].includes(value);
export const attendanceStatuses = new Set(['present', 'absent', 'late', 'excused']);

export function requireUser(user) {
  if (!user?.id) throw new PolicyError(401, 'UNAUTHENTICATED', 'Войдите в аккаунт.');
  return user;
}
export function requireAdmin(user) {
  if (requireUser(user).role !== 'admin') deny();
}
export function requireTeaching(user, resource, teachingAssignments) {
  requireUser(user);
  if (user.role !== 'teacher' || resource.teacherId !== user.id || !teachingAssignments.some(t =>
    t.teacherId === user.id && t.groupId === resource.groupId && t.subjectId === resource.subjectId)) deny();
}
export function requireStudentInGroup(student, groupId) {
  if (!student || student.role !== 'student' || student.groupId !== groupId) {
    invalid('Студент не состоит в группе занятия.', { studentId: 'Выберите студента этой группы.' });
  }
}
export function requireCanSubmit(user, assignment) {
  requireUser(user);
  if (user.role !== 'student' || !user.groupId || assignment.groupId !== user.groupId) deny();
}
export function requireCanReadSubmission(user, submission, assignment, teachingAssignments) {
  requireUser(user);
  if (submission.assignmentId !== assignment.id) deny();
  if (user.role === 'student') {
    if (submission.studentId !== user.id || assignment.groupId !== user.groupId) deny();
    return;
  }
  requireTeaching(user, assignment, teachingAssignments);
}
export function requireVersion(expected, actual) {
  const valid = value => value === null || (Number.isInteger(value) && value >= 0);
  if (!valid(expected) || !valid(actual)) invalid('Некорректная версия записи.');
  if (expected !== actual) throw new PolicyError(409, 'VERSION_CONFLICT', 'Запись уже изменена. Обновите данные.');
}
export function validateGradeInput(input) {
  if (!input || (input.grade !== null && !isGrade(input.grade))) {
    invalid('Выберите оценку от 2 до 5 или снимите её.', { grade: 'Допустимы 2, 3, 4, 5 или null.' });
  }
  if (input.version !== null && (!Number.isInteger(input.version) || input.version < 0)) invalid('Передайте версию оценки.');
  return { grade: input.grade, version: input.version };
}
export function validateAttendanceInput(input, allowedStudentIds) {
  if (!input || !Array.isArray(input.entries) || !Number.isInteger(input.version) || input.version < 0) {
    invalid('Передайте отметки и версию посещаемости.');
  }
  const allowed = new Set(allowedStudentIds), seen = new Set();
  const entries = input.entries.map(entry => {
    if (!entry || typeof entry.studentId !== 'string' || !allowed.has(entry.studentId) || seen.has(entry.studentId)) {
      invalid('В списке есть неизвестный студент или повторная запись.');
    }
    if (entry.status !== null && !attendanceStatuses.has(entry.status)) invalid('Неизвестная отметка посещаемости.');
    seen.add(entry.studentId);
    return { studentId: entry.studentId, status: entry.status };
  });
  return { entries, version: input.version };
}
export function validateReviewInput(input) {
  if (!input || !['grade', 'return'].includes(input.action) || !Number.isInteger(input.version) || input.version < 0) {
    invalid('Передайте действие и версию работы.');
  }
  if (typeof input.comment !== 'string' || input.comment.length > 2000) invalid('Комментарий должен содержать не более 2000 символов.');
  const comment = input.comment.trim();
  if (input.action === 'return') {
    if (!comment) invalid('Напишите, что нужно доработать.', { comment: 'Комментарий обязателен.' });
    return { status: 'revision', grade: null, comment, version: input.version };
  }
  if (!isGrade(input.grade)) invalid('Выберите оценку от 2 до 5.', { grade: 'Оценка обязательна.' });
  return { status: 'reviewed', grade: input.grade, comment, version: input.version };
}
function timestamp(value) {
  if (typeof value !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
    invalid('Передайте дату и время с часовым поясом.');
  }
  return Date.parse(value);
}
export function validateLessonTiming(lesson, existingLessons) {
  const start = timestamp(lesson.startsAt), end = timestamp(lesson.endsAt);
  if (end <= start) invalid('Окончание должно быть позже начала.', { endsAt: 'Проверьте время занятия.' });
  if (!['scheduled', 'cancelled'].includes(lesson.status)) invalid('Неизвестный статус занятия.');
  if (lesson.status === 'cancelled') return;
  const conflict = existingLessons.find(other => other.id !== lesson.id && other.status !== 'cancelled' &&
    Date.parse(other.startsAt) < end && start < Date.parse(other.endsAt) &&
    ['groupId', 'teacherId', 'roomId'].some(key => other[key] === lesson[key]));
  if (conflict) throw new PolicyError(409, 'SCHEDULE_CONFLICT', 'Группа, преподаватель или аудитория уже заняты.');
}

/** Только пример проекции. СУБД должна выполнять такое ограничение до выдачи данных. */
export function scopeBootstrap(user, data) {
  requireUser(user);
  if (user.role === 'admin') return data;
  if (!['student', 'teacher'].includes(user.role)) deny();
  const teachingAssignments = data.teachingAssignments.filter(t => user.role === 'teacher' ? t.teacherId === user.id : t.groupId === user.groupId);
  const allowed = resource => teachingAssignments.some(t => t.groupId === resource.groupId && t.subjectId === resource.subjectId &&
    (user.role === 'student' || (t.teacherId === user.id && resource.teacherId === user.id)));
  const groupIds = new Set(teachingAssignments.map(t => t.groupId));
  if (user.role === 'student' && user.groupId) groupIds.add(user.groupId);
  const subjectIds = new Set(teachingAssignments.map(t => t.subjectId));
  const lessons = data.lessons.filter(allowed), assignments = data.assignments.filter(allowed);
  const lessonIds = new Set(lessons.map(l => l.id)), assignmentIds = new Set(assignments.map(a => a.id));
  const roomIds = new Set(lessons.map(l => l.roomId));
  const teacherIds = new Set(teachingAssignments.map(t => t.teacherId));
  const users = data.users.filter(other => other.id === user.id || (user.role === 'teacher'
    ? other.role === 'student' && groupIds.has(other.groupId)
    : other.role === 'teacher' && teacherIds.has(other.id)));
  const rosterIds = new Set(users.filter(other => other.role === 'student').map(other => other.id));
  const studentVisible = id => user.role === 'student' ? id === user.id : rosterIds.has(id);
  return {
    users, groups: data.groups.filter(g => groupIds.has(g.id)),
    subjects: data.subjects.filter(s => subjectIds.has(s.id)), rooms: data.rooms.filter(r => roomIds.has(r.id)),
    teachingAssignments, lessons, assignments,
    submissions: data.submissions.filter(s => assignmentIds.has(s.assignmentId) && studentVisible(s.studentId)),
    grades: data.grades.filter(g => lessonIds.has(g.lessonId) && studentVisible(g.studentId)),
    attendance: data.attendance.filter(a => lessonIds.has(a.lessonId) && studentVisible(a.studentId)),
    materials: data.materials.filter(m => subjectIds.has(m.subjectId)),
    announcements: data.announcements,
  };
}
