import assert from 'node:assert/strict';

const localTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Qyzylorda',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const starts = new Set(['08:30', '10:10', '11:50', '14:00', '15:40', '17:20']);

// Check the result stored in the database, independently of the seed generator.
export function checkCampusData(data) {
  const students = data.users.filter((user) => user.role === 'student');
  const teachers = data.users.filter((user) => user.role === 'teacher');
  assert.ok(students.length > 100, `Expected over 100 students, got ${students.length}`);
  assert.ok(teachers.length > 10, `Expected over 10 teachers, got ${teachers.length}`);
  assert.ok(data.groups.length > 15, `Expected over 15 groups, got ${data.groups.length}`);

  const groupIds = new Set(data.groups.map((group) => group.id));
  const teacherIds = new Set(teachers.map((teacher) => teacher.id));
  const subjects = new Set(data.subjects.map((subject) => subject.id));
  const rooms = new Map(data.rooms.map((room) => [room.id, room]));
  const rosterSizes = new Map();
  for (const student of students) {
    assert.ok(groupIds.has(student.groupId), `Student ${student.id} has no existing group`);
    rosterSizes.set(student.groupId, (rosterSizes.get(student.groupId) || 0) + 1);
  }
  const pairs = new Set(
    data.teachingAssignments.map((row) => `${row.teacherId}/${row.groupId}/${row.subjectId}`),
  );
  const lessons = data.lessons.filter((lesson) => lesson.status !== 'cancelled');
  const groupLessonCounts = new Map();
  const groupWeeks = new Map();
  for (const lesson of lessons) {
    assert.ok(groupIds.has(lesson.groupId), `Unknown lesson group: ${lesson.id}`);
    assert.ok(teacherIds.has(lesson.teacherId), `Unknown lesson teacher: ${lesson.id}`);
    assert.ok(subjects.has(lesson.subjectId), `Unknown lesson subject: ${lesson.id}`);
    assert.ok(
      pairs.has(`${lesson.teacherId}/${lesson.groupId}/${lesson.subjectId}`),
      `Teacher not assigned to lesson: ${lesson.id}`,
    );
    const room = rooms.get(lesson.roomId);
    assert.ok(room, `Unknown lesson room: ${lesson.id}`);
    assert.ok(
      room.capacity >= (rosterSizes.get(lesson.groupId) || 0),
      `Room ${room.name} does not fit group ${lesson.groupId}`,
    );
    assert.ok(Date.parse(lesson.endsAt) > Date.parse(lesson.startsAt));
    groupLessonCounts.set(lesson.groupId, (groupLessonCounts.get(lesson.groupId) || 0) + 1);
    const parts = Object.fromEntries(
      localTime.formatToParts(new Date(lesson.startsAt)).map((part) => [part.type, part.value]),
    );
    const monday = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`);
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    if (!groupWeeks.has(lesson.groupId)) groupWeeks.set(lesson.groupId, new Set());
    groupWeeks.get(lesson.groupId).add(monday.toISOString().slice(0, 10));
    assert.ok(!['Sat', 'Sun'].includes(parts.weekday), `Weekend lesson: ${lesson.id}`);
    assert.ok(starts.has(`${parts.hour}:${parts.minute}`), `Nonstandard lesson time: ${lesson.id}`);
    assert.equal(
      Date.parse(lesson.endsAt) - Date.parse(lesson.startsAt),
      80 * 60000,
      `Expected an 80 minute lesson: ${lesson.id}`,
    );
  }
  for (const group of data.groups) {
    assert.ok(
      (rosterSizes.get(group.id) || 0) >= 20,
      `Group ${group.name} has fewer than 20 students`,
    );
    assert.ok(
      (groupLessonCounts.get(group.id) || 0) >= 15,
      `Group ${group.name} lacks a useful schedule`,
    );
    assert.ok(
      (groupWeeks.get(group.id)?.size || 0) >= 4,
      `Group ${group.name} needs lessons across at least four weeks`,
    );
  }

  // Sort each resource separately: an adjacent overlap means a scheduling conflict.
  for (const resource of ['teacherId', 'groupId', 'roomId']) {
    const calendars = new Map();
    for (const lesson of lessons) {
      if (!calendars.has(lesson[resource])) calendars.set(lesson[resource], []);
      calendars.get(lesson[resource]).push(lesson);
    }
    for (const calendar of calendars.values()) {
      calendar.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      for (let index = 1; index < calendar.length; index++) {
        assert.ok(
          calendar[index].startsAt >= calendar[index - 1].endsAt,
          `Schedule collision (${resource}): ${calendar[index - 1].id} / ${calendar[index].id}`,
        );
      }
    }
  }
}
