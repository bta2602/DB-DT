import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { basename, isAbsolute } from 'node:path';
import test, { after } from 'node:test';
import { closeDatabase } from '../database/connection.mjs';
import { promisify } from 'node:util';
import {
  bootstrapFor,
  createGuestSession,
  readLearningFile,
  reviewSubmission,
  saveAssignment,
  saveGrade,
  saveLesson,
  saveSubmission,
  seedDemoDataset,
  signInDemo,
  updateOwnProfile,
} from '../lib/studyhub/auth-store.mjs';
import { createDemoData } from '../database/seeds/demo-data.mjs';
import { checkCampusData } from './campus-checks.mjs';

const runFile = promisify(execFile);
const directory = process.env.STUDYHUB_TEST_SEED_DIR;

after(async () => {
  await closeDatabase();
});

test(
  'The large campus dataset extends an existing database without losing work',
  {
    skip: !directory && 'Run through npm test to provide an isolated temporary directory.',
  },
  async () => {
    assert.ok(isAbsolute(directory) && basename(directory).startsWith('studyhub-api-tests-'));
    process.env.STUDYHUB_DATA_DIR = directory;
    process.env.STUDYHUB_DEMO_MODE = 'true';

    // Start with the previous small dataset and make changes through the same store as the API.
    const original = createDemoData();
    await seedDemoDataset(
      original,
      Object.fromEntries(
        original.data.users.map((user) => [user.id, 'isolated-upgrade-password-2026']),
      ),
    );
    const admin = (await signInDemo('admin', (await createGuestSession()).token)).user;
    const teacher = (await signInDemo('teacher', '')).user;
    const student = (await signInDemo('student', '')).user;
    await updateOwnProfile(student.id, 'Айдана Серикова — учебный проект', student.version);

    const small = await bootstrapFor(admin);
    const oldLesson = small.lessons.find(
      (lesson) =>
        lesson.teacherId === teacher.id &&
        lesson.groupId === student.groupId &&
        Date.parse(lesson.startsAt) < Date.now() &&
        lesson.status === 'scheduled',
    );
    assert.ok(
      oldLesson,
      'The baseline dataset needs a past lesson for the grade preservation check',
    );
    const oldGrade = small.grades.find(
      (grade) => grade.lessonId === oldLesson.id && grade.studentId === student.id,
    );
    await saveGrade(teacher, oldLesson.id, student.id, {
      grade: 80,
      version: oldGrade?.version ?? null,
    });

    const manualStart = new Date(Date.now() + 70 * 86400000);
    manualStart.setUTCHours(3, 30, 0, 0);
    while ([0, 6].includes(manualStart.getUTCDay()))
      manualStart.setUTCDate(manualStart.getUTCDate() + 1);
    await saveLesson(admin, {
      groupId: oldLesson.groupId,
      subjectId: oldLesson.subjectId,
      teacherId: teacher.id,
      roomId: small.rooms.find((room) => room.capacity >= 20).id,
      startsAt: manualStart.toISOString(),
      endsAt: new Date(+manualStart + 80 * 60000).toISOString(),
      kind: 'Консультация',
      status: 'scheduled',
      note: 'Занятие, добавленное до расширения базы',
    });
    await saveAssignment(teacher, {
      subjectId: oldLesson.subjectId,
      groupId: student.groupId,
      teacherId: teacher.id,
      title: 'Работа, созданная до расширения',
      type: 'Практическая работа',
      description: 'Сохраните SQL-запрос.',
      steps: ['Отправить файл'],
      dueAt: new Date(Date.now() + 86400000).toISOString(),
    });
    const task = (await bootstrapFor(admin)).assignments.find(
      (item) => item.title === 'Работа, созданная до расширения',
    );
    const content = "SELECT 'Сохранённая работа';\n";
    await saveSubmission(student, task.id, {
      name: 'saved.sql',
      bytes: new TextEncoder().encode(content),
    });
    const submitted = (await bootstrapFor(admin)).submissions.find(
      (item) => item.assignmentId === task.id,
    );
    await reviewSubmission(teacher, submitted.id, {
      action: 'grade',
      grade: 100,
      comment: 'Проверено до расширения базы.',
      version: submitted.version,
    });
    const before = await bootstrapFor(admin);
    const beforeWork = before.submissions.find((item) => item.id === submitted.id);
    const beforeGrade = before.grades.find(
      (item) => item.lessonId === oldLesson.id && item.studentId === student.id,
    );
    const manualLesson = before.lessons.find(
      (item) => item.note === 'Занятие, добавленное до расширения базы',
    );

    // This is the real public seed command, including its upgrade and marker handling.
    await runFile(process.execPath, ['scripts/seed-demo.mjs'], {
      env: process.env,
      timeout: 240000,
    });
    const expanded = await bootstrapFor(admin);
    checkCampusData(expanded);
    assert.equal(
      expanded.users.find((item) => item.id === student.id).name,
      'Айдана Серикова — учебный проект',
    );
    assert.deepEqual(
      expanded.assignments.find((item) => item.id === task.id),
      task,
    );
    assert.deepEqual(
      expanded.submissions.find((item) => item.id === submitted.id),
      beforeWork,
    );
    assert.deepEqual(
      expanded.grades.find(
        (item) => item.lessonId === oldLesson.id && item.studentId === student.id,
      ),
      beforeGrade,
    );
    assert.deepEqual(
      expanded.lessons.find((item) => item.id === manualLesson.id),
      manualLesson,
    );
    assert.equal(
      new TextDecoder().decode((await readLearningFile(student, beforeWork.file.id)).bytes),
      content,
    );

    await runFile(process.execPath, ['scripts/seed-demo.mjs'], {
      env: process.env,
      timeout: 240000,
    });
    assert.deepEqual(
      await bootstrapFor(admin),
      expanded,
      'A repeated seed must not duplicate or reset records',
    );
  },
);
