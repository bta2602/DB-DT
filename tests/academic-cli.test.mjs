import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { parseAcademicTarget, prepareAcademicDatabase } from '../scripts/academic-database.mjs';

test('academic CLI never falls back to a production URL', () => {
  const previous = process.env.STUDYHUB_ACADEMIC_TEST_DATABASE_URL;
  delete process.env.STUDYHUB_ACADEMIC_TEST_DATABASE_URL;
  try {
    assert.throws(() => parseAcademicTarget([]), /--sqlite-dir/);
    assert.throws(
      () => parseAcademicTarget(['--postgres', '--host', 'localhost', '--apply']),
      /STUDYHUB_ACADEMIC_TEST_DATABASE_URL/,
    );
    process.env.STUDYHUB_ACADEMIC_TEST_DATABASE_URL = 'postgresql://test:secret@qa.example/test';
    assert.throws(
      () => parseAcademicTarget(['--postgres', '--host', 'production.example', '--apply']),
      /совпадающим/,
    );
    assert.throws(() => parseAcademicTarget(['--sqlite-dir', 'relative', '--apply']), /абсолютным/);
  } finally {
    if (previous === undefined) delete process.env.STUDYHUB_ACADEMIC_TEST_DATABASE_URL;
    else process.env.STUDYHUB_ACADEMIC_TEST_DATABASE_URL = previous;
  }
});

test('explicit SQLite migration is repeatable and backs up existing data before writing', async () => {
  await assert.rejects(
    prepareAcademicDatabase({ dialect: 'sqlite', directory: resolve('.studyhub-test') }),
    /вне репозитория/,
  );
  const directory = await mkdtemp(join(tmpdir(), 'studyhub-academic-cli-'));
  await prepareAcademicDatabase({ dialect: 'sqlite', directory });
  const db = new DatabaseSync(join(directory, 'auth.sqlite'));
  db.prepare(
    "INSERT INTO studyhub_settings(key,value) VALUES ('cli-preservation','original')",
  ).run();
  db.close();
  await prepareAcademicDatabase({ dialect: 'sqlite', directory });
  const files = await readdir(join(directory, 'backups'));
  assert.equal(files.length, 1);
  const snapshot = new DatabaseSync(join(directory, 'backups', files[0]), { readOnly: true });
  try {
    assert.equal(
      snapshot.prepare("SELECT value FROM studyhub_settings WHERE key='cli-preservation'").get()
        .value,
      'original',
    );
    assert.equal(snapshot.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  } finally {
    snapshot.close();
  }
});
