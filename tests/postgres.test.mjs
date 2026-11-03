import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { closeDatabase, getDatabase, runTransaction } from '../database/connection.mjs';
import { saveDirectory, updateOwnProfile } from '../lib/studyhub/auth-store.mjs';

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
  },
);
