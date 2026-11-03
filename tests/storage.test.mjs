import assert from 'node:assert/strict';
import { basename, dirname, isAbsolute, join } from 'node:path';
import test from 'node:test';
import {
  createGuestSession,
  bootstrapFor,
  isDemoEnabled,
  readSession,
  registerStudent,
  saveDirectory,
  seedDemoDataset,
  signInDemo,
} from '../lib/studyhub/auth-store.mjs';
import { createDemoData } from '../database/seeds/demo-data.mjs';

const directory = process.env.STUDYHUB_TEST_STORAGE_DIR;

test(
  'An ordinary account database cannot be opened through demo role switching',
  {
    skip: !directory && 'Run through npm test to provide an isolated temporary directory.',
  },
  async () => {
    assert.ok(
      isAbsolute(directory) && basename(dirname(directory)).startsWith('studyhub-api-tests-'),
    );
    process.env.STUDYHUB_DATA_DIR = directory;
    process.env.STUDYHUB_DEMO_MODE = 'false';
    const guest = createGuestSession();
    const session = await registerStudent(
      {
        name: 'Пользователь отдельной рабочей базы',
        email: 'isolated-real-account@example.test',
        password: 'storage-test-password-2026',
        passwordConfirmation: 'storage-test-password-2026',
      },
      guest.token,
    );
    assert.equal(isDemoEnabled(), false);
    assert.throws(
      () => signInDemo('admin', session.token),
      (error) => error.code === 'DEMO_DISABLED',
    );

    process.env.STUDYHUB_DEMO_MODE = 'true';
    assert.throws(
      () => isDemoEnabled(),
      (error) => error.code === 'DEMO_REQUIRES_EMPTY_DATABASE',
    );
    assert.throws(
      () => signInDemo('admin', session.token),
      (error) => error.code === 'DEMO_REQUIRES_EMPTY_DATABASE',
    );

    process.env.STUDYHUB_DEMO_MODE = 'false';
    assert.equal(readSession(session.token).user.id, session.user.id);
    assert.equal(readSession(session.token).user.role, 'student');

    process.env.STUDYHUB_DEMO_MODE = 'true';
    delete process.env.STUDYHUB_DATA_DIR;
    assert.throws(
      () => isDemoEnabled(),
      (error) => error.code === 'DEMO_STORAGE_REQUIRED',
    );
  },
);

test(
  'Reserved demo roles stay switchable while profile details and other account roles can change',
  {
    skip: !directory && 'Run through npm test to provide an isolated temporary directory.',
  },
  async () => {
    assert.ok(
      isAbsolute(directory) && basename(dirname(directory)).startsWith('studyhub-api-tests-'),
    );
    process.env.STUDYHUB_DATA_DIR = join(dirname(directory), 'protected-demo-roles');
    process.env.STUDYHUB_DEMO_MODE = 'true';
    const snapshot = createDemoData();
    const passwords = Object.fromEntries(
      snapshot.data.users.map((user) => [user.id, 'isolated-test-password-2026']),
    );
    await seedDemoDataset(snapshot, passwords);
    const admin = signInDemo('admin', createGuestSession().token).user;

    for (const role of ['admin', 'teacher', 'student']) {
      const profile = signInDemo(role, '').user;
      const input = {
        name: profile.name,
        email: profile.email,
        role: role === 'student' ? 'teacher' : 'student',
        groupId: null,
        version: profile.version,
      };
      await assert.rejects(
        saveDirectory(admin, 'users', input, profile.id),
        (error) => error.status === 409 && error.code === 'DEMO_PROFILE_REQUIRED',
      );

      await saveDirectory(
        admin,
        'users',
        {
          ...input,
          name: `Изменённый профиль: ${role}`,
          email: `edited-${role}@example.test`,
          role,
          groupId: profile.groupId,
        },
        profile.id,
      );
      const switched = signInDemo(role, '').user;
      assert.equal(switched.role, role);
      assert.equal(switched.name, `Изменённый профиль: ${role}`);
      assert.equal(switched.email, `edited-${role}@example.test`);
    }

    await saveDirectory(admin, 'users', {
      name: 'Дополнительный учебный аккаунт',
      email: 'changeable-role@example.test',
      role: 'student',
      groupId: null,
      password: 'isolated-test-password-2026',
    });
    const ordinary = bootstrapFor(admin).users.find(
      (user) => user.email === 'changeable-role@example.test',
    );
    assert.ok(ordinary);
    await saveDirectory(
      admin,
      'users',
      {
        name: ordinary.name,
        email: ordinary.email,
        role: 'teacher',
        groupId: null,
        version: ordinary.version,
      },
      ordinary.id,
    );
    assert.equal(bootstrapFor(admin).users.find((user) => user.id === ordinary.id).role, 'teacher');
  },
);
