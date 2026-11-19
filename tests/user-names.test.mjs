import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { migrateSqliteUserNames } from '../database/migrations/user-names.mjs';
import { joinUserName, splitLegacyName } from '../lib/studyhub/user-names.mjs';

test('legacy names retain their parts and use surname first for display', () => {
  const name = {
    familyName: 'Кузнецова',
    givenName: 'Екатерина',
    patronymic: 'Андреевна',
  };
  assert.deepEqual(splitLegacyName(' Екатерина   Андреевна Кузнецова '), name);
  assert.deepEqual(splitLegacyName('Кузнецова Екатерина Андреевна'), name);
  assert.equal(joinUserName(name), 'Кузнецова Екатерина Андреевна');
  assert.deepEqual(splitLegacyName('Абай'), {
    familyName: null,
    givenName: 'Абай',
    patronymic: null,
  });
});

test('the name migration preserves ordinary users and references and reruns safely', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`
      CREATE TABLE school_groups (id TEXT PRIMARY KEY, language TEXT);
      CREATE TABLE studyhub_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE auth_users (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL,
        version INTEGER NOT NULL, is_demo INTEGER NOT NULL, password_hash TEXT NOT NULL,
        group_id TEXT REFERENCES school_groups(id)
      );
      CREATE TABLE auth_sessions (id TEXT PRIMARY KEY, user_id TEXT REFERENCES auth_users(id));
      CREATE TABLE school_grades (student_id TEXT REFERENCES auth_users(id), score INTEGER);
      INSERT INTO school_groups VALUES ('group', 'kk');
      INSERT INTO auth_users VALUES
        ('demo-student-2', 'Айдана Серикова', 's0002@students.studyhub.example', 'student', 1, 1, 'p2', 'group'),
        ('demo-student-3', 'Айдана Серикова', 's0003@students.studyhub.example', 'student', 1, 1, 'p3', 'group'),
        ('demo-student-4', 'Аружан Сералиева', 's0004@students.studyhub.example', 'student', 2, 1, 'p4', 'group'),
        ('ordinary', 'Екатерина Андреевна Кузнецова', 'member@example.org', 'student', 1, 0, 'p5', 'group');
      INSERT INTO auth_sessions VALUES ('session', 'demo-student-2');
      INSERT INTO school_grades VALUES ('demo-student-2', 95);
    `);
    const identities = db.prepare(
      'SELECT id,email,role,is_demo,password_hash,group_id FROM auth_users ORDER BY id',
    );
    const originals = identities.all();
    assert.deepEqual(migrateSqliteUserNames(db), { added: 3, updated: 4, demoRenamed: 0 });
    assert.deepEqual(migrateSqliteUserNames(db, { diversifyDemo: true }), {
      added: 0,
      updated: 2,
      demoRenamed: 2,
    });
    const allNames = db.prepare(
      'SELECT name,family_name,given_name,patronymic,version FROM auth_users ORDER BY id',
    );
    const [first, second, edited, ordinary] = allNames.all();
    assert.notEqual(first.name, second.name);
    assert.match(first.patronymic, /қызы$/u);
    assert.equal(first.name, `${first.family_name} ${first.given_name} ${first.patronymic}`);
    assert.equal(edited.name, 'Аружан Сералиева');
    assert.equal(edited.version, 2);
    assert.equal(ordinary.name, 'Екатерина Андреевна Кузнецова');
    assert.equal(ordinary.family_name, 'Кузнецова');
    assert.equal(ordinary.given_name, 'Екатерина');
    assert.equal(ordinary.patronymic, 'Андреевна');
    assert.deepEqual(identities.all(), originals);
    assert.equal(
      db.prepare("SELECT user_id FROM auth_sessions WHERE id='session'").get().user_id,
      'demo-student-2',
    );
    assert.equal(
      db.prepare("SELECT score FROM school_grades WHERE student_id='demo-student-2'").get().score,
      95,
    );
    const migratedNames = allNames.all();
    assert.deepEqual(migrateSqliteUserNames(db, { diversifyDemo: true }), {
      added: 0,
      updated: 0,
      demoRenamed: 0,
    });
    assert.deepEqual(allNames.all(), migratedNames);
  } finally {
    db.close();
  }
});
