import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { authSchema, schoolSchema, learningSchema } from '../database/schema.mjs';
import { postgresSchema } from '../database/connection.mjs';
import { migrateSqliteAcademic as migrateBackendAcademic } from '../database/migrations/academic-rules.mjs';
import {
  academicMigrationKey,
  migrateSqliteAcademic,
} from '../database/migrations/academic-data.mjs';
import { readSqliteSnapshot, importSqliteSnapshot } from '../scripts/import-sqlite-to-postgres.mjs';

const legacySchema = await readFile(
  new URL('./fixtures/academic-legacy.sql', import.meta.url),
  'utf8',
);

async function sourceFixture(t, academic = true) {
  const directory = await mkdtemp(join(tmpdir(), 'studyhub-academic-import-test-'));
  t.after(async () => {
    const owned = await realpath(directory);
    assert.equal(dirname(owned), await realpath(tmpdir()));
    assert.ok(basename(owned).startsWith('studyhub-academic-import-test-'));
    await rm(owned, { recursive: true, force: true });
  });
  const filename = join(directory, 'source.sqlite');
  const db = new DatabaseSync(filename);
  try {
    db.exec(legacySchema);
    db.exec(`
      INSERT INTO auth_users(id,email,name,password_hash,role,created_at) VALUES
        ('teacher','teacher@example.test','Teacher','retained-hash','teacher',1),
        ('student','student@example.test','Student','retained-hash','student',1);
      INSERT INTO school_groups(id,name,name_key,course,curator_id) VALUES ('group','Group','group',1,'teacher');
      UPDATE auth_users SET group_id='group' WHERE id='student';
      INSERT INTO school_subjects(id,name,name_key) VALUES ('subject','Python','python');
      INSERT INTO school_rooms(id,name,name_key,capacity) VALUES ('room','101','101',30);
      INSERT INTO school_lessons(id,group_id,subject_id,teacher_id,room_id,starts_at,ends_at,kind,status)
        VALUES ('historic','group','subject','teacher','room','2026-01-05T03:30:00Z','2026-01-05T04:50:00Z','Практика','scheduled');
      INSERT INTO school_assignments(id,subject_id,group_id,teacher_id,title,type,description,steps_json,due_at)
        VALUES ('old-work','subject','group','teacher','Retained work','Legacy','Text','[]','2026-01-06T00:00:00Z');
    `);
    migrateBackendAcademic(db);
    if (academic) {
      migrateSqliteAcademic(db);
      db.exec(`
        UPDATE school_groups SET program='IS',intake_year=2026,language='ru' WHERE id='group';
        INSERT INTO school_teacher_subjects VALUES ('teacher','subject');
        INSERT INTO school_teacher_languages VALUES ('teacher','ru');
        INSERT INTO school_group_subjects VALUES ('group','subject',2026,1);
        INSERT INTO school_teaching_assignments VALUES ('teacher','group','subject');
        INSERT INTO school_lessons(id,group_id,subject_id,teacher_id,room_id,starts_at,ends_at,kind,status,slot_id,academic_year,semester)
          VALUES ('practice','group','subject','teacher','room','2026-09-07T03:00:00.000Z','2026-09-07T03:50:00.000Z','practice','scheduled','p1',2026,1);
        INSERT INTO school_lessons(id,group_id,subject_id,teacher_id,kind,status,practice_id,academic_year,semester)
          VALUES ('srsp','group','subject','teacher','srsp','scheduled','practice',2026,1);
        INSERT INTO school_academic_seed_map VALUES ('subject','python','subject');
      `);
    }
  } finally {
    db.close();
  }
  return filename;
}

// A recording adapter verifies importer transaction/order behavior with real SQLite rows.
// PostgreSQL-only DDL is recorded, not executed: live PostgreSQL validation remains separate.
function recordingTarget(t, { failInstallation = false } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  const events = [];
  t.after(() => sqlite.close());
  const adapter = {
    dialect: 'postgres',
    async exec(sql) {
      if (sql === postgresSchema) {
        sqlite.exec(authSchema + schoolSchema);
        if (
          !sqlite
            .prepare('PRAGMA table_info(auth_users)')
            .all()
            .some((row) => row.name === 'group_id')
        ) {
          sqlite.exec(
            'ALTER TABLE auth_users ADD COLUMN group_id TEXT REFERENCES school_groups(id)',
          );
        }
        sqlite.exec(learningSchema);
      } else if (sql.includes('CREATE OR REPLACE FUNCTION')) {
        events.push('install');
        assert.equal(sqlite.prepare('SELECT count(*) AS count FROM school_lessons').get().count, 3);
        assert.equal(
          sqlite.prepare('SELECT count(*) AS count FROM school_academic_seed_map').get().count,
          1,
        );
        assert.ok(sql.includes('CREATE VIEW school_academic_lessons'));
        if (failInstallation) throw new Error('Installation failed');
      } else if (sql.includes('ALTER TABLE school_lessons ADD COLUMN IF NOT EXISTS')) {
        events.push('extend-empty-target');
        assert.equal(sqlite.prepare('SELECT count(*) AS count FROM auth_users').get().count, 0);
      } else {
        sqlite.exec(sql);
      }
    },
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return {
        async all(...args) {
          return statement.all(...args);
        },
        async get(...args) {
          return statement.get(...args);
        },
        async run(...args) {
          return statement.run(...args);
        },
      };
    },
    async transaction(action) {
      sqlite.exec('BEGIN');
      events.push('begin');
      try {
        const result = await action(adapter);
        sqlite.exec('COMMIT');
        events.push('commit');
        return result;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        events.push('rollback');
        throw error;
      }
    },
  };
  return { adapter, sqlite, events };
}

test('Academic snapshots retain stable key maps, periods, linked SRSP and legacy null assignment links', async (t) => {
  const filename = await sourceFixture(t);
  const before = await readFile(filename);
  const snapshot = await readSqliteSnapshot(filename);
  assert.deepEqual(
    await readFile(filename),
    before,
    'Reading a source must not modify the database',
  );
  assert.equal(snapshot.manifest.counts.school_academic_seed_map, 1);
  assert.equal(snapshot.tables.school_academic_seed_map.rows[0].record_id, 'subject');
  const practice = snapshot.tables.school_lessons.rows.find((row) => row.id === 'practice');
  assert.equal(practice.academic_year, 2026);
  assert.equal(practice.semester, 1);
  assert.equal(
    snapshot.tables.school_lessons.rows.find((row) => row.id === 'srsp').practice_id,
    'practice',
  );
  assert.equal(snapshot.tables.school_assignments.rows[0].lesson_id, null);
  assert.ok(snapshot.tables.studyhub_settings.rows.some((row) => row.key === academicMigrationKey));
});

test('Importer copies academic rows before installing their rules, and repeats without changing data', async (t) => {
  const snapshot = await readSqliteSnapshot(await sourceFixture(t));
  snapshot.tables.school_lessons.rows.reverse();
  const target = recordingTarget(t);
  const result = await importSqliteSnapshot(target.adapter, snapshot);
  assert.equal(result.imported, true);
  assert.equal(result.counts.school_academic_seed_map, 1);
  assert.deepEqual(target.events, ['begin', 'extend-empty-target', 'install', 'commit']);
  const repeated = await importSqliteSnapshot(target.adapter, snapshot);
  assert.equal(repeated.imported, false);
  assert.deepEqual(target.events, [
    'begin',
    'extend-empty-target',
    'install',
    'commit',
    'begin',
    'commit',
  ]);
  assert.equal(
    target.sqlite.prepare("SELECT kind FROM school_lessons WHERE id='historic'").get().kind,
    'Практика',
  );
});

test('Importer rolls back copied rows and markers if academic object installation fails', async (t) => {
  const snapshot = await readSqliteSnapshot(await sourceFixture(t));
  const target = recordingTarget(t, { failInstallation: true });
  await assert.rejects(importSqliteSnapshot(target.adapter, snapshot), /Installation failed/);
  assert.deepEqual(target.events, ['begin', 'extend-empty-target', 'install', 'rollback']);
  assert.equal(target.sqlite.prepare('SELECT count(*) AS count FROM auth_users').get().count, 0);
  assert.equal(
    target.sqlite.prepare('SELECT count(*) AS count FROM school_lessons').get().count,
    0,
  );
  assert.equal(
    target.sqlite.prepare('SELECT count(*) AS count FROM studyhub_settings').get().count,
    0,
  );
});

test('Backend-only snapshots remain supported without installing data-extension uniqueness or write rules', async (t) => {
  const filename = await sourceFixture(t, false);
  const source = new DatabaseSync(filename);
  source.exec(`UPDATE school_groups SET program='IS',intake_year=2026,language='ru';
    INSERT INTO school_groups(id,name,name_key,course,program,intake_year,language)
      VALUES ('second-group','Second','second',1,'IS',2026,'ru');`);
  source.close();
  const snapshot = await readSqliteSnapshot(filename);
  assert.equal(snapshot.tables.school_academic_seed_map, undefined);
  const target = recordingTarget(t);
  assert.equal((await importSqliteSnapshot(target.adapter, snapshot)).imported, true);
  assert.deepEqual(target.events, ['begin', 'extend-empty-target', 'commit']);
  assert.equal((await importSqliteSnapshot(target.adapter, snapshot)).imported, false);
  assert.equal(target.sqlite.prepare('SELECT count(*) AS count FROM school_groups').get().count, 2);
});

test('An academic marker without the corresponding map and period schema is rejected', async (t) => {
  const filename = await sourceFixture(t, false);
  const source = new DatabaseSync(filename);
  source
    .prepare('INSERT INTO studyhub_settings(key,value) VALUES (?,?)')
    .run(academicMigrationKey, '1');
  source.close();
  await assert.rejects(readSqliteSnapshot(filename), /Маркер академической миграции/);
});
