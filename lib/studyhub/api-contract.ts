/** Контракт для подключения UI. Это типы, а не работающий сервер. */
export type Id = string;
export type Role = 'student' | 'teacher' | 'admin';
export type Mark = 2 | 3 | 4 | 5;
export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused';
export type User = { id: Id; name: string; email: string; role: Role; groupId: Id | null; version: number };
export type Group = { id: Id; name: string; course: number; curatorId: Id | null; version: number };
export type Subject = { id: Id; name: string };
export type Room = { id: Id; name: string; capacity: number | null; version: number };
export type TeachingAssignment = { teacherId: Id; groupId: Id; subjectId: Id };
export type Lesson = {
  id: Id; groupId: Id; subjectId: Id; teacherId: Id; roomId: Id;
  startsAt: string; endsAt: string; kind: string;
  status: 'scheduled' | 'cancelled'; note: string;
  version: number; attendanceVersion: number;
};
export type Assignment = {
  id: Id; subjectId: Id; groupId: Id; teacherId: Id;
  title: string; type: string; description: string; steps: string[];
  dueAt: string; version: number;
};
export type StoredFile = { id: Id; name: string; mimeType: string; bytes: number };
export type Submission = {
  id: Id; assignmentId: Id; studentId: Id;
  status: 'submitted' | 'reviewed' | 'revision'; submittedAt: string;
  file: StoredFile; grade: Mark | null; comment: string; version: number;
};
/** Снятая оценка остаётся в Bootstrap с grade:null и актуальной version. */
export type Grade = { lessonId: Id; studentId: Id; grade: Mark | null; version: number };
export type Attendance = { lessonId: Id; studentId: Id; status: AttendanceStatus };
export type Material = { id: Id; subjectId: Id; title: string; fileId: Id };
export type Announcement = { id: Id; title: string; body: string; publishedAt: string };
export type Bootstrap = {
  users: User[]; groups: Group[]; subjects: Subject[]; rooms: Room[];
  teachingAssignments: TeachingAssignment[]; lessons: Lesson[];
  assignments: Assignment[]; submissions: Submission[]; grades: Grade[];
  attendance: Attendance[]; materials: Material[]; announcements: Announcement[];
};
export type Session = { user: User | null; csrfToken: string };
export type MutationResult = { ok: true };
export type ApiError = { error: { code: string; message: string; fields?: Record<string, string> } };
export type LoginInput = { email: string; password: string };
export type GradeInput = { grade: Mark | null; version: number | null };
export type AttendanceInput = {
  entries: { studentId: Id; status: AttendanceStatus | null }[];
  version: number; // lesson.attendanceVersion, не lesson.version
};
export type ReviewInput = {
  action: 'grade' | 'return'; grade: Mark | null; comment: string; version: number;
};
export type LessonInput = Omit<Lesson, 'id' | 'version' | 'attendanceVersion'>;
export type LessonPatch = (LessonInput | { status: Lesson['status'] }) & { version: number };
export type AssignmentInput = Omit<Assignment, 'id' | 'version'>;
export type UserInput = Omit<User, 'id' | 'version'>;
export type GroupInput = Omit<Group, 'id' | 'version'>;
export type RoomInput = Omit<Room, 'id' | 'version'>;
export type ProfileInput = { name: string; version: number };

/** GET /api/session возвращает гостя с user:null, а не подставную роль. */
export const endpoints = {
  session: { method: 'GET', path: '/api/session', response: 'Session' },
  login: { method: 'POST', path: '/api/auth/login', request: 'LoginInput', response: 'MutationResult' },
  logout: { method: 'POST', path: '/api/auth/logout', request: '{}', response: 'MutationResult' },
  bootstrap: { method: 'GET', path: '/api/bootstrap', response: 'Bootstrap' },
  grade: { method: 'PUT', path: '/api/lessons/:id/grades/:studentId', request: 'GradeInput', response: 'MutationResult' },
  attendance: { method: 'PUT', path: '/api/lessons/:id/attendance', request: 'AttendanceInput', response: 'MutationResult' },
  review: { method: 'PATCH', path: '/api/submissions/:id/review', request: 'ReviewInput', response: 'MutationResult' },
  createAssignment: { method: 'POST', path: '/api/assignments', request: 'AssignmentInput', response: 'MutationResult' },
  submit: { method: 'POST', path: '/api/assignments/:id/submission', request: 'multipart/form-data: file', response: 'MutationResult' },
  file: { method: 'GET', path: '/api/files/:id', response: 'authorized binary' },
  createLesson: { method: 'POST', path: '/api/lessons', request: 'LessonInput', response: 'MutationResult' },
  updateLesson: { method: 'PATCH', path: '/api/lessons/:id', request: 'LessonPatch', response: 'MutationResult' },
  createUser: { method: 'POST', path: '/api/users', request: 'UserInput', response: 'MutationResult' },
  updateUser: { method: 'PATCH', path: '/api/users/:id', request: 'UserInput & {version:number}', response: 'MutationResult' },
  createGroup: { method: 'POST', path: '/api/groups', request: 'GroupInput', response: 'MutationResult' },
  updateGroup: { method: 'PATCH', path: '/api/groups/:id', request: 'GroupInput & {version:number}', response: 'MutationResult' },
  createRoom: { method: 'POST', path: '/api/rooms', request: 'RoomInput', response: 'MutationResult' },
  updateRoom: { method: 'PATCH', path: '/api/rooms/:id', request: 'RoomInput & {version:number}', response: 'MutationResult' },
  createSubject: { method: 'POST', path: '/api/subjects', request: '{name:string}', response: 'MutationResult' },
  updateSubject: { method: 'PATCH', path: '/api/subjects/:id', request: '{name:string}', response: 'MutationResult' },
  teachingAssignment: { method: 'PUT', path: '/api/teaching-assignments', request: 'TeachingAssignment', response: 'MutationResult' },
  profile: { method: 'PATCH', path: '/api/profile', request: 'ProfileInput', response: 'MutationResult' },
} as const;

/** Сервер и UI используют одну временную зону отображения. В API — ISO с offset/UTC. */
export const schoolTimeZone = 'Asia/Qyzylorda';
export const maxSubmissionBytes = 20 * 1024 * 1024;
export const allowedSubmissionExtensions = ['pdf', 'docx', 'zip', 'sql', 'txt', 'png', 'jpg', 'jpeg'] as const;
