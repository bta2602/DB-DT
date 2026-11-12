import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const origin = new URL(process.env.STUDYHUB_QA_ORIGIN || 'http://127.0.0.1:3000').origin;
assert.match(origin, /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/, 'Use a local demo server');
// A localhost URL and demoEnabled do not prove SQLite isolation. Before running,
// start the server with DATABASE_URL='' and a separate STUDYHUB_DATA_DIR.
const accounts = ['A', 'B'].map((slot) => ({
  email: process.env['STUDYHUB_QA_EMAIL_' + slot],
  password: process.env['STUDYHUB_QA_PASSWORD_' + slot],
}));
assert.ok(
  accounts.every(({ email, password }) => email && password),
  'Set STUDYHUB_QA_EMAIL_A/B and STUDYHUB_QA_PASSWORD_A/B for two demo students in the same group',
);
assert.notEqual(accounts[0].email, accounts[1].email);

const playwrightDir = process.env.STUDYHUB_PLAYWRIGHT_DIR;
const require = createRequire(
  playwrightDir ? resolve(playwrightDir, 'package.json') : import.meta.url,
);
const { chromium } = require('playwright-core');
const browser = await chromium.launch({ channel: 'chrome' });

try {
  // Both accounts use the same browser context and origin throughout the scenario.
  const context = await browser.newContext({ baseURL: origin });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  const downloads = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('download', (download) => downloads.push(download.suggestedFilename()));

  async function json(path) {
    const response = await context.request.get(path);
    assert.ok(response.ok(), path + ' HTTP ' + response.status());
    return response.json();
  }

  async function authenticate(action, data) {
    const { csrfToken, demoEnabled } = await json('/api/session');
    assert.equal(demoEnabled, true, 'Use an isolated local demonstration database');
    const response = await context.request.post('/api/auth/' + action, {
      headers: { Origin: origin, 'X-CSRF-Token': csrfToken },
      data,
    });
    assert.ok(response.ok(), action + ' HTTP ' + response.status());
  }

  async function login(account) {
    await authenticate('login', account);
    const { user, demoEnabled } = await json('/api/session');
    assert.equal(demoEnabled, true, 'The authenticated session must remain in demo mode');
    assert.equal(user?.email, account.email);
    assert.equal(user.role, 'student');
    return user;
  }

  const studentA = await login(accounts[0]);
  const first = await json('/api/bootstrap');
  await authenticate('logout', {});
  const studentB = await login(accounts[1]);
  const second = await json('/api/bootstrap');
  assert.notEqual(studentA.id, studentB.id);
  assert.ok(studentA.groupId && studentA.groupId === studentB.groupId);
  const assignment = first.assignments.find(
    (item) => item.steps.length > 0 && second.assignments.some(({ id }) => id === item.id),
  );
  const material = first.materials.find((item) =>
    second.materials.some(({ id }) => id === item.id),
  );
  assert.ok(
    assignment && material,
    'Both demo students need access to an assignment with steps and a material',
  );
  const subject = first.subjects.find(({ id }) => id === material.subjectId);
  assert.ok(subject, 'Shared material needs a subject');

  async function openAssignment(reload = false) {
    const dialog = page.getByRole('dialog', { name: assignment.title, exact: true });
    if (reload) {
      await page.reload();
      const current = new URL(page.url());
      if (
        current.pathname === '/tasks' &&
        current.searchParams.get('assignment') === assignment.id
      ) {
        // Local deep links restore the dialog; its background search is inert.
        await dialog.waitFor();
        return;
      }
    } else {
      await page.goto('/tasks');
    }
    // Main opens assignments with local state and needs this again after reload.
    await page.getByRole('searchbox', { name: 'Поиск задания' }).fill(assignment.title);
    await page.getByRole('heading', { name: assignment.title, exact: true }).click();
    await dialog.waitFor();
  }

  const download = page
    .getByRole('button', { name: material.title, exact: true })
    .or(page.getByRole('link', { name: material.title, exact: true }));
  async function openMaterials(reload = false) {
    if (reload) await page.reload();
    else await page.goto('/subjects');
    await page.getByRole('heading', { name: subject.name, exact: true }).click();
    await page.getByRole('button', { name: 'Материалы', exact: true }).click();
    await download.waitFor();
  }

  async function waitUntil(check, message) {
    const deadline = Date.now() + 10000;
    while (!(await check())) {
      assert.ok(Date.now() < deadline, message);
      await delay(50);
    }
  }

  async function waitForRestored(control, message) {
    await control.waitFor().catch(() => {
      throw new Error(message);
    });
    await waitUntil(() => control.isEnabled(), message);
    assert.equal(await control.isEnabled(), true, message);
  }

  const panel = page
    .getByRole('dialog', { name: assignment.title, exact: true })
    .locator('.task-notes-panel');
  const note = panel.locator('textarea');
  const step = panel.getByRole('checkbox').first();
  async function assertNote(text, checked) {
    await waitForRestored(
      note,
      'TaskNotesPanel is missing from AssignmentDialog or never finishes restoring',
    );
    await waitUntil(
      () => note.inputValue().then((value) => value === text),
      'Unexpected restored note',
    );
    assert.equal(await note.inputValue(), text);
    const checkboxes = panel.getByRole('checkbox');
    assert.equal(await checkboxes.count(), assignment.steps.length);
    for (let index = 0; index < assignment.steps.length; index++) {
      const checkbox = checkboxes.nth(index);
      await waitForRestored(checkbox, 'Preparation steps never finish restoring');
      assert.equal(await checkbox.isChecked(), index === 0 && checked, `Step ${index}`);
    }
  }

  // Material opening and favorite are separate actions in one material row.
  const favorite = download.locator('..').locator('.favorite-button');
  async function assertFavorite(selected) {
    await waitForRestored(
      favorite,
      'FavoriteButton is missing from the material row or never finishes restoring',
    );
    await waitUntil(
      () => favorite.getAttribute('aria-pressed').then((value) => value === String(selected)),
      'Unexpected restored favorite',
    );
    assert.equal(await favorite.getAttribute('aria-pressed'), String(selected));
  }

  async function filterFavorites() {
    const label = { name: 'Только избранное', exact: true };
    await page
      .getByRole('button', label)
      .or(page.getByRole('checkbox', label))
      .or(page.getByRole('switch', label))
      .click();
  }

  await authenticate('logout', {});
  await login(accounts[0]);
  await openAssignment();
  if (process.argv.includes('--probe')) {
    await openMaterials();
    console.log('OK: two fixture logins and shared assignment/material navigation');
  } else {
    const text = 'StudyHUB browser check ' + randomUUID();
    const otherText = 'Second student browser check ' + randomUUID();
    await assertNote('', false);
    await note.fill(text);
    await step.check();
    await openAssignment(true);
    await assertNote(text, true);

    await openMaterials();
    await assertFavorite(false);
    await favorite.click();
    await assertFavorite(true);
    await filterFavorites();
    await download.waitFor();
    await openMaterials(true);
    await assertFavorite(true);
    assert.deepEqual(downloads, [], 'Favoriting must not download the material');

    await authenticate('logout', {});
    await login(accounts[1]);
    await openAssignment();
    await assertNote('', false);
    await note.fill(otherText);
    await openAssignment(true);
    await assertNote(otherText, false);
    await openMaterials();
    await assertFavorite(false);
    await filterFavorites();
    await download.waitFor({ state: 'hidden' });

    await authenticate('logout', {});
    await login(accounts[0]);
    await openAssignment();
    await assertNote(text, true);
    await panel.getByRole('button', { name: 'Очистить мои записи', exact: true }).click();
    await openAssignment(true);
    await assertNote('', false);
    await openMaterials();
    await assertFavorite(true);
    await favorite.click();
    await openMaterials(true);
    await assertFavorite(false);

    // Clearing A must not erase B, and B's writes must not have replaced A's.
    await authenticate('logout', {});
    await login(accounts[1]);
    await openAssignment();
    await assertNote(otherText, false);
    await panel.getByRole('button', { name: 'Очистить мои записи', exact: true }).click();
    await openAssignment(true);
    await assertNote('', false);
    await authenticate('logout', {});
    await login(accounts[0]);
    await openAssignment();
    await assertNote('', false);
    assert.deepEqual(errors, []);
    console.log(
      'OK: reload, per-account isolation, clear, favorite toggle/filter and no console errors',
    );
  }
} finally {
  await browser.close();
}
