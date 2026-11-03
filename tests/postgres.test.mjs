import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { closeDatabase, getDatabase, runTransaction } from '../database/connection.mjs';
import { saveDirectory, updateOwnProfile, saveGrade } from '../lib/studyhub/auth-store.mjs';

test(
  'PostgreSQL adapter and concurrent changes on the isolated QA branch',
  { skip: process.env.STUDYHUB_TEST_POSTGRES !== 'true' },
  async (t) => {
    assert.equal(new URL(process.env.DATABASE_URL).hostname, process.env.STUDYHUB_TEST_PG_HOST);
    const db = await getDatabase();
    assert.equal(db.dialect, 'postgres');
    t.after(closeDatabase);

    await t.test('Parameters preserve quoted question marks and camelCase aliases', async () => {
      const value = "Question ? and quote ' remain data";
      const row = await db
        .prepare(
          'SELECT ?::text AS literalValue, \'?\' AS "questionMark", ?::integer AS countValue',
        )
        .get(value, 42);
      assert.deepEqual(row, { literalValue: value, questionMark: '?', countValue: 42 });
    });

    await t.test('Transaction failure rolls back all writes', async () => {
      const key = `qa-rollback-${randomUUID()}`;
      await assert.rejects(
        () =>
          runTransaction(async (tx) => {
            await tx
              .prepare('INSERT INTO studyhub_settings(key,value) VALUES (?,?)')
              .run(key, 'test');
            assert.equal((await getDatabase()).key, tx.key);
            throw new Error('Expected rollback');
          }),
        /Expected rollback/,
      );
      assert.equal(
        await db.prepare('SELECT value FROM studyhub_settings WHERE key=?').get(key),
        undefined,
      );
    });

    await t.test('Unique constraint errors are normalized and leave no partial rows', async () => {
      const key = `qa-constraint-${randomUUID()}`;
      await assert.rejects(
        () =>
          runTransaction(async (tx) => {
            await tx
              .prepare('INSERT INTO studyhub_settings(key,value) VALUES (?,?)')
              .run(key, 'first');
            await tx
              .prepare('INSERT INTO studyhub_settings(key,value) VALUES (?,?)')
              .run(key, 'second');
          }),
        (error) => error.postgresCode === '23505' && error.code === 'SQLITE_CONSTRAINT_UNIQUE',
      );
      assert.equal(
        await db.prepare('SELECT value FROM studyhub_settings WHERE key=?').get(key),
        undefined,
      );
    });

    await t.test('Admin and profile edits with the same version have only one winner', async () => {
      const email = `concurrency-${randomUUID()}@example.test`;
      await saveDirectory({ id: 'demo-admin' }, 'users', {
        name: 'Concurrent test teacher',
        email,
        role: 'teacher',
        groupId: null,
        password: `${randomUUID()}A9!`,
      });
      const user = await db.prepare('SELECT id,version FROM auth_users WHERE email=?').get(email);
      assert.ok(user);
      try {
        const results = await Promise.allSettled([
          saveDirectory(
            { id: 'demo-admin' },
            'users',
            {
              name: 'Changed by admin',
              email,
              role: 'teacher',
              groupId: null,
              version: user.version,
            },
            user.id,
          ),
          updateOwnProfile(user.id, 'Changed in profile', user.version),
        ]);
        assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
        const failure = results.find((result) => result.status === 'rejected');
        assert.equal(failure?.reason.code, 'VERSION_CONFLICT');
        assert.equal(
          Number(
            (await db.prepare('SELECT version FROM auth_users WHERE id=?').get(user.id)).version,
          ),
          Number(user.version) + 1,
        );
      } finally {
        await runTransaction((tx) => tx.prepare('DELETE FROM auth_users WHERE id=?').run(user.id));
      }
    });

    await t.test(
      'Journal 0/100 updates have one winner and PostgreSQL enforces the range',
      async () => {
        const old = await db
          .prepare(
            `SELECT g.*,l.teacher_id FROM school_grades g
        JOIN school_lessons l ON l.id=g.lesson_id
        JOIN school_teaching_assignments a ON a.teacher_id=l.teacher_id AND a.group_id=l.group_id AND a.subject_id=l.subject_id
        WHERE l.status='scheduled' AND l.ends_at < ? LIMIT 1`,
          )
          .get(new Date().toISOString());
        assert.ok(old);
        const actor = { id: old.teacher_id };
        const current = () =>
          db
            .prepare('SELECT * FROM school_grades WHERE lesson_id=? AND student_id=?')
            .get(old.lesson_id, old.student_id);
        try {
          const results = await Promise.allSettled(
            [0, 100].map((grade) =>
              saveGrade(actor, old.lesson_id, old.student_id, {
                grade,
                status: 'graded',
                version: old.version,
              }),
            ),
          );
          assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
          assert.equal(
            results.find((result) => result.status === 'rejected').reason.code,
            'VERSION_CONFLICT',
          );
          let row = await current();
          assert.ok([0, 100].includes(row.grade));
          assert.equal(row.status, 'graded');
          assert.equal(row.version, old.version + 1);
          await assert.rejects(
            () =>
              runTransaction((tx) =>
                tx
                  .prepare('UPDATE school_grades SET grade=101 WHERE lesson_id=? AND student_id=?')
                  .run(old.lesson_id, old.student_id),
              ),
            (error) => error.code === 'SQLITE_CONSTRAINT_CHECK',
          );
          for (const status of ['not_required', 'absent', 'unmarked']) {
            await saveGrade(actor, old.lesson_id, old.student_id, {
              grade: null,
              status,
              version: row.version,
            });
            row = await current();
            assert.equal(row.grade, null);
            assert.equal(row.status, status);
          }
        } finally {
          const row = await current();
          await saveGrade(actor, old.lesson_id, old.student_id, {
            grade: old.grade,
            status: old.status,
            version: row.version,
          });
        }
      },
    );
  },
);
