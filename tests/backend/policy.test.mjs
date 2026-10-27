import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PolicyError, requireAdmin, requireTeaching, requireVersion,
  validateGradeInput, validateAttendanceInput, validateReviewInput,
  validateLessonTiming, requireCanReadSubmission, scopeBootstrap,
} from '../../lib/studyhub/policy.mjs';

const teacher = { id: 'teacher-a', role: 'teacher', groupId: null };
const student = { id: 'student-a', role: 'student', groupId: 'group-a' };
const assignment = { id: 'assignment-a', teacherId: 'teacher-a', groupId: 'group-a', subjectId: 'subject-a' };
const teaching = [{ teacherId: 'teacher-a', groupId: 'group-a', subjectId: 'subject-a' }];
const status = expected => error => error instanceof PolicyError && error.status === expected;

test('authentication and administrator access are checked independently', () => {
  assert.throws(() => requireAdmin(null), status(401));
  assert.throws(() => requireAdmin(student), status(403));
  assert.doesNotThrow(() => requireAdmin({ id: 'admin-a', role: 'admin' }));
});

test('teacher needs both ownership and the group-subject assignment', () => {
  assert.doesNotThrow(() => requireTeaching(teacher, assignment, teaching));
  assert.throws(() => requireTeaching(teacher, assignment, []), status(403));
  assert.throws(() => requireTeaching({ ...teacher, id: 'teacher-b' }, assignment, teaching), status(403));
  assert.throws(() => requireTeaching(teacher, { ...assignment, groupId: 'group-b' }, teaching), status(403));
});

test('student cannot read another student submission or an unrelated assignment', () => {
  const submission = { studentId: student.id, assignmentId: assignment.id };
  assert.doesNotThrow(() => requireCanReadSubmission(student, submission, assignment, teaching));
  assert.throws(() => requireCanReadSubmission(student, { ...submission, studentId: 'student-b' }, assignment, teaching), status(403));
  assert.throws(() => requireCanReadSubmission(student, submission, { ...assignment, id: 'assignment-b' }, teaching), status(403));
  assert.doesNotThrow(() => requireCanReadSubmission(teacher, submission, assignment, teaching));
});

test('grade requires an explicit number; null means remove, not zero', () => {
  assert.deepEqual(validateGradeInput({ grade: null, version: 2 }), { grade: null, version: 2 });
  assert.deepEqual(validateGradeInput({ grade: 5, version: null }), { grade: 5, version: null });
  for (const grade of [undefined, '', '5', false, 0, 1, 6, 2.5]) {
    assert.throws(() => validateGradeInput({ grade, version: 1 }), status(422));
  }
});

test('review return requires feedback and explicitly clears any grade', () => {
  assert.throws(() => validateReviewInput({ action: 'return', grade: 5, comment: '  ', version: 1 }), status(422));
  assert.deepEqual(validateReviewInput({ action: 'return', grade: 5, comment: ' Уточните решение. ', version: 2 }), {
    status: 'revision', grade: null, comment: 'Уточните решение.', version: 2,
  });
  assert.throws(() => validateReviewInput({ action: 'grade', grade: null, comment: '', version: 1 }), status(422));
  assert.throws(() => validateReviewInput({ action: 'unknown', grade: 5, comment: '', version: 1 }), status(422));
});

test('attendance validates each student, duplicate entry, status and version', () => {
  const value = { entries: [{ studentId: 's1', status: null }, { studentId: 's2', status: 'absent' }], version: 3 };
  assert.deepEqual(validateAttendanceInput(value, ['s1', 's2']), value);
  assert.throws(() => validateAttendanceInput(value, ['s1']), status(422));
  assert.throws(() => validateAttendanceInput({ entries: [value.entries[0], value.entries[0]], version: 3 }, ['s1']), status(422));
  assert.throws(() => validateAttendanceInput({ entries: [{ studentId: 's1', status: 'unknown' }], version: 3 }, ['s1']), status(422));
  assert.throws(() => validateAttendanceInput({ ...value, version: -1 }, ['s1', 's2']), status(422));
});

test('stale and missing versions produce conflict instead of silent overwrite', () => {
  assert.doesNotThrow(() => requireVersion(2, 2));
  assert.doesNotThrow(() => requireVersion(null, null));
  assert.throws(() => requireVersion(1, 2), status(409));
  assert.throws(() => requireVersion(null, 1), status(409));
  assert.throws(() => requireVersion(undefined, 1), status(422));
});

test('schedule permits adjacent lessons and rejects overlaps for each shared resource', () => {
  const base = { id: 'a', groupId: 'g1', teacherId: 't1', roomId: 'r1', startsAt: '2026-10-27T09:00:00+05:00', endsAt: '2026-10-27T10:20:00+05:00', status: 'scheduled' };
  const next = { ...base, id: 'b', startsAt: '2026-10-27T10:20:00+05:00', endsAt: '2026-10-27T11:40:00+05:00' };
  assert.doesNotThrow(() => validateLessonTiming(next, [base]));
  for (const resource of ['groupId', 'teacherId', 'roomId']) {
    const overlapping = { ...next, groupId: 'g2', teacherId: 't2', roomId: 'r2', startsAt: '2026-10-27T10:00:00+05:00', [resource]: base[resource] };
    assert.throws(() => validateLessonTiming(overlapping, [base]), status(409));
    assert.doesNotThrow(() => validateLessonTiming({ ...overlapping, status: 'cancelled' }, [base]));
  }
  assert.throws(() => validateLessonTiming({ ...base, endsAt: base.startsAt }, []), status(422));
  assert.throws(() => validateLessonTiming({ ...base, startsAt: '2026-10-27T09:00:00' }, []), status(422));
});

test('bootstrap projection excludes other groups and other student records', () => {
  const foreign = { id: 'assignment-b', teacherId: 'teacher-b', groupId: 'group-b', subjectId: 'subject-b' };
  const data = {
    users: [student, teacher, { id: 'student-b', role: 'student', groupId: 'group-a' }, { id: 'student-c', role: 'student', groupId: 'group-b' }],
    groups: [{ id: 'group-a' }, { id: 'group-b' }], subjects: [{ id: 'subject-a' }, { id: 'subject-b' }],
    rooms: [{ id: 'room-a' }, { id: 'room-b' }], teachingAssignments: [...teaching, { ...foreign }],
    lessons: [{ ...assignment, id: 'lesson-a', roomId: 'room-a' }, { ...foreign, id: 'lesson-b', roomId: 'room-b' }],
    assignments: [assignment, foreign],
    submissions: [{ id: 'sa', assignmentId: assignment.id, studentId: student.id }, { id: 'sb', assignmentId: assignment.id, studentId: 'student-b' }, { id: 'sc', assignmentId: foreign.id, studentId: 'student-c' }],
    grades: [{ lessonId: 'lesson-a', studentId: student.id }, { lessonId: 'lesson-a', studentId: 'student-b' }],
    attendance: [{ lessonId: 'lesson-a', studentId: student.id }, { lessonId: 'lesson-a', studentId: 'student-b' }],
    materials: [{ subjectId: 'subject-a' }, { subjectId: 'subject-b' }], announcements: [],
  };
  const result = scopeBootstrap(student, data);
  assert.deepEqual(result.groups.map(g => g.id), ['group-a']);
  assert.deepEqual(result.submissions.map(s => s.id), ['sa']);
  assert.deepEqual(result.grades.map(g => g.studentId), [student.id]);
  assert.deepEqual(result.attendance.map(a => a.studentId), [student.id]);
  assert.deepEqual(result.users.map(u => u.id), [student.id, teacher.id]);
  const teacherResult = scopeBootstrap(teacher, data);
  assert.deepEqual(teacherResult.submissions.map(s => s.id), ['sa', 'sb']);
  assert.equal(teacherResult.users.some(u => u.id === 'student-c'), false);
});
