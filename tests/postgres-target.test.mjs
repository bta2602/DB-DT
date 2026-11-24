import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertDifferentPostgresTargets,
  assertMaintenanceTarget,
  postgresTarget,
} from '../scripts/postgres-target.mjs';
import { parseArchiveTarget } from '../scripts/migrate-lesson-archive.mjs';
import { parseAcademicTarget } from '../scripts/academic-database.mjs';
import { main as grading } from '../scripts/migrate-grading.mjs';
import { main as academic } from '../scripts/migrate-academic.mjs';
import { main as slots } from '../scripts/migrate-evening-slots.mjs';
import { main as archive } from '../scripts/migrate-lesson-archive.mjs';
import { main as names } from '../scripts/migrate-user-names.mjs';
import { main as marks } from '../scripts/migrate-period-marks.mjs';
import { supabaseImportUrl } from '../scripts/import-supabase.mjs';

const direct =
  'postgresql://postgres:synthetic@db.projecta.supabase.co:5432/postgres?sslmode=require';
const session =
  'postgresql://postgres.projecta:synthetic@aws-0-region.pooler.supabase.com:5432/postgres?sslmode=require';
const transaction = session.replace(':5432/', ':6543/');

test('Supabase import rejects exact password templates, including encoded brackets', () => {
  for (const connection of [direct, session]) {
    for (const password of ['PASTE_DB_PASSWORD_HERE', '[YOUR-PASSWORD]', '%5BYOUR-PASSWORD%5D']) {
      assert.throws(
        () => supabaseImportUrl(connection.replace(':synthetic@', `:${password}@`)),
        /Замените шаблон пароля в DATABASE_URL/,
      );
    }
  }
});

test('Supabase import accepts passwords that merely contain template text', () => {
  for (const password of ['prefix-PASTE_DB_PASSWORD_HERE-87', 'prefix-[YOUR-PASSWORD]-87']) {
    const connection = direct.replace(':synthetic@', `:${encodeURIComponent(password)}@`);
    assert.equal(decodeURIComponent(new URL(supabaseImportUrl(connection)).password), password);
  }
});

test('Supabase identity follows the project across direct, session and transaction endpoints', () => {
  for (const [connection, mode] of [
    [direct, 'direct'],
    [session, 'session'],
    [transaction, 'transaction'],
    [direct.replace(':5432/', ':6543/'), 'transaction'],
  ]) {
    const target = postgresTarget(connection);
    assert.equal(target.identity, 'supabase:projecta');
    assert.equal(target.verificationHost, 'db.projecta.supabase.co');
    assert.equal(target.mode, mode);
  }
  assert.equal(
    postgresTarget(session.replace('postgres.projecta', 'custom_role.projecta')).identity,
    'supabase:projecta',
  );
  assert.equal(
    postgresTarget(session.replace('postgres.projecta', 'postgres%2Eprojecta')).identity,
    'supabase:projecta',
  );
});

test('QA rejects the same Supabase project across connection modes and pooler hosts', () => {
  for (const connection of [
    direct,
    session,
    transaction,
    session.replace('aws-0-region', 'aws-1-another'),
  ])
    assert.throws(() => assertDifferentPostgresTargets(connection, direct), /must differ/);
  assert.equal(
    assertDifferentPostgresTargets(session.replaceAll('projecta', 'projectb'), direct).identity,
    'supabase:projectb',
  );
  assert.equal(
    assertDifferentPostgresTargets(direct.replaceAll('projecta', 'projectb'), session).identity,
    'supabase:projectb',
  );
  assert.throws(
    () => postgresTarget('postgresql://aws-0-region.pooler.supabase.com'),
    /project ref/,
  );
});

test('Supabase maintenance requires the matching project host and a direct or session connection', () => {
  assert.equal(assertMaintenanceTarget(direct, 'db.projecta.supabase.co').mode, 'direct');
  assert.equal(assertMaintenanceTarget(session, 'db.projecta.supabase.co').mode, 'session');
  assert.equal(assertMaintenanceTarget(session, 'DB.PROJECTA.SUPABASE.CO.').mode, 'session');
  assert.throws(
    () => assertMaintenanceTarget(session, 'aws-0-region.pooler.supabase.com'),
    /совпадающим/,
  );
  assert.throws(() => assertMaintenanceTarget(session, 'db.projectb.supabase.co'), /совпадающим/);
  assert.throws(() => assertMaintenanceTarget(transaction, 'db.projecta.supabase.co'), /5432/);
  assert.throws(
    () => assertMaintenanceTarget(direct.replace(':5432/', ':6543/'), 'db.projecta.supabase.co'),
    /5432/,
  );
  assert.throws(
    () => postgresTarget(session.replace('postgres.projecta', 'postgres')),
    /project ref/,
  );
  assert.throws(() => postgresTarget(session.replace(':5432/', ':5444/')), /стандартный/);
});

test('Neon direct and pooled endpoints keep one identity and existing host confirmation rules', () => {
  const neon = 'postgresql://test:synthetic@ep-qa.region.aws.neon.tech/neondb';
  const pooled = neon.replace('ep-qa.', 'ep-qa-pooler.');
  assert.throws(() => assertDifferentPostgresTargets(neon, pooled), /must differ/);
  assert.equal(assertMaintenanceTarget(neon, 'ep-qa.region.aws.neon.tech').mode, 'direct');
  assert.throws(
    () => assertMaintenanceTarget(pooled, 'ep-qa-pooler.region.aws.neon.tech'),
    /прямой PostgreSQL/,
  );
  assert.throws(
    () => assertMaintenanceTarget(neon, 'ep-other.region.aws.neon.tech'),
    /совпадающим/,
  );
  assert.equal(
    assertMaintenanceTarget('postgresql://test:synthetic@qa.example:5433/test', 'qa.example')
      .identity,
    'qa.example',
  );
});

test('Routing overrides and duplicate options fail without exposing credentials', () => {
  for (const query of [
    'host=other.example',
    'port=6543',
    'user=postgres.projectb',
    '%68ost=other.example',
    'user=postgres.projecta&user=postgres.projectb',
    'sslmode=require&sslmode=disable',
  ]) {
    assert.throws(
      () => postgresTarget(direct + '&' + query),
      (error) => {
        assert.doesNotMatch(error.message, /synthetic/);
        return /переопределять|повторяющиеся/.test(error.message);
      },
    );
  }
  assert.equal(postgresTarget(direct + '&sslrootcert=C%3A%2Fcerts%2Froot.crt').mode, 'direct');
  assert.throws(() => postgresTarget('https://db.projecta.supabase.co'), /PostgreSQL URL/);
});

test('Archive and academic CLI parsers authorize the Supabase project rather than the shared host', () => {
  assert.equal(
    parseArchiveTarget(['--host', 'db.projecta.supabase.co', '--apply'], {
      DIRECT_DATABASE_URL: session,
    }).connectionString,
    session,
  );
  assert.throws(
    () =>
      parseArchiveTarget(['--host', 'aws-0-region.pooler.supabase.com', '--apply'], {
        DIRECT_DATABASE_URL: session,
      }),
    /совпадающим/,
  );
  const previous = process.env.STUDYHUB_ACADEMIC_TEST_DATABASE_URL;
  process.env.STUDYHUB_ACADEMIC_TEST_DATABASE_URL = session;
  try {
    assert.equal(
      parseAcademicTarget(['--postgres', '--host', 'db.projecta.supabase.co', '--apply'])
        .connectionString,
      session,
    );
    assert.throws(
      () => parseAcademicTarget(['--postgres', '--host', 'db.projectb.supabase.co', '--apply']),
      /совпадающим/,
    );
  } finally {
    if (previous === undefined) delete process.env.STUDYHUB_ACADEMIC_TEST_DATABASE_URL;
    else process.env.STUDYHUB_ACADEMIC_TEST_DATABASE_URL = previous;
  }
});

test('Every maintenance command rejects a Supabase transaction pooler before connecting', async () => {
  const previous = process.env.DATABASE_URL_UNPOOLED;
  process.env.DATABASE_URL_UNPOOLED = transaction;
  try {
    for (const command of [grading, academic, slots, archive, names, marks])
      await assert.rejects(command(['--host', 'db.projecta.supabase.co', '--apply']), /5432/);
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL_UNPOOLED;
    else process.env.DATABASE_URL_UNPOOLED = previous;
  }
});
