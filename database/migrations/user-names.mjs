import { academicStudentName } from '../seeds/academic-data.mjs';
import { joinUserName, splitLegacyName } from '../../lib/studyhub/user-names.mjs';

const fields = ['family_name', 'given_name', 'patronymic'];
const demoMarker = 'user_names_demo_v1';

function nameKey(name) {
  return name.normalize('NFC').toLocaleLowerCase('ru');
}

function generatedStudent(row) {
  return (
    row.role === 'student' &&
    Number(row.is_demo) === 1 &&
    Number(row.version) === 1 &&
    row.id !== 'demo-student-1' &&
    (/^demo-(?:(?:campus|more)-)?student-\d+$/u.test(row.id) ||
      /^academic-student-[\w-]+-\d+$/u.test(row.id)) &&
    /@(?:[\w-]+\.)?studyhub\.example$|@example\.test$/iu.test(row.email)
  );
}

function namesForUpdate(rows, diversifyDemo) {
  const reservedNames = new Set();
  for (const row of rows) {
    if (diversifyDemo && generatedStudent(row)) continue;
    const parts = row.given_name
      ? { familyName: row.family_name, givenName: row.given_name, patronymic: row.patronymic }
      : splitLegacyName(row.name);
    reservedNames.add(nameKey(joinUserName(parts)));
  }
  const offsets = new Map();
  const updates = [];
  for (const row of rows) {
    if (diversifyDemo && generatedStudent(row)) {
      const previous = splitLegacyName(row.name);
      const language = row.language === 'kk' ? 'kk' : 'ru';
      const sex = /(?:ова|ева|ёва|ина|ская|цкая|қызы|овна|евна|ична)$/iu.test(
        previous.patronymic || previous.familyName || '',
      )
        ? 0
        : 1;
      const sequence = `${language}:${sex}`;
      let offset = offsets.get(sequence) || 0;
      let name;
      let parts;
      do {
        if (offset >= 18 * 24) throw new Error('Student name pool has been exhausted.');
        parts = splitLegacyName(academicStudentName(offset++ * 2 + sex, language));
        name = joinUserName(parts);
      } while (reservedNames.has(nameKey(name)));
      offsets.set(sequence, offset);
      reservedNames.add(nameKey(name));
      updates.push({ id: row.id, name, ...parts, renamed: true });
    } else if (!row.given_name) {
      updates.push({ id: row.id, name: row.name, ...splitLegacyName(row.name), renamed: false });
    }
  }
  return updates;
}

const selectUsers = (language) => `SELECT u.id,u.name,u.email,u.role,u.version,u.is_demo,
  u.family_name,u.given_name,u.patronymic,${language} AS language
  FROM auth_users u LEFT JOIN school_groups g ON g.id=u.group_id ORDER BY u.id`;
const updateUser = `UPDATE auth_users SET name=?,family_name=?,given_name=?,patronymic=?,
  version=version+? WHERE id=?`;
const values = (user) => [
  user.name,
  user.familyName,
  user.givenName,
  user.patronymic,
  user.renamed ? 1 : 0,
  user.id,
];

function resultFor(updates, added) {
  return {
    added,
    updated: updates.length,
    demoRenamed: updates.filter((user) => user.renamed).length,
  };
}

export function migrateSqliteUserNames(db, { diversifyDemo = false } = {}) {
  if (db.isTransaction) throw new Error('User name migration requires its own transaction.');
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = db
      .prepare('PRAGMA table_info(auth_users)')
      .all()
      .map((row) => row.name);
    const missing = fields.filter((column) => !existing.includes(column));
    for (const column of missing) db.exec(`ALTER TABLE auth_users ADD COLUMN ${column} TEXT`);
    const rename =
      diversifyDemo && !db.prepare('SELECT 1 FROM studyhub_settings WHERE key=?').get(demoMarker);
    const groupColumns = db.prepare('PRAGMA table_info(school_groups)').all();
    const language = groupColumns.some((column) => column.name === 'language')
      ? 'g.language'
      : 'NULL';
    const updates = namesForUpdate(db.prepare(selectUsers(language)).all(), rename);
    const update = db.prepare(updateUser);
    for (const user of updates) update.run(...values(user));
    if (updates.some((user) => user.renamed))
      db.prepare('INSERT INTO studyhub_settings(key,value) VALUES (?,?)').run(demoMarker, '1');
    db.exec('COMMIT');
    return resultFor(updates, missing.length);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** Explicit PostgreSQL maintenance command. The web server does not alter schema on startup. */
export async function migratePostgresUserNames(client, { diversifyDemo = false } = {}) {
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout='10s'");
    await client.query('SELECT pg_advisory_xact_lock(62846321)');
    await client.query('LOCK TABLE auth_users IN ACCESS EXCLUSIVE MODE');
    const existing = await client.query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema=current_schema() AND table_name='auth_users'`);
    const missing = fields.filter(
      (column) => !existing.rows.some((row) => row.column_name === column),
    );
    for (const column of missing)
      await client.query(`ALTER TABLE auth_users ADD COLUMN ${column} TEXT`);
    const rename =
      diversifyDemo &&
      !(await client.query('SELECT 1 FROM studyhub_settings WHERE key=$1', [demoMarker])).rows
        .length;
    const users = await client.query(selectUsers("to_jsonb(g)->>'language'"));
    const updates = namesForUpdate(users.rows, rename);
    if (updates.length) {
      await client.query(
        `UPDATE auth_users u
        SET name=entry.name, family_name=entry."familyName", given_name=entry."givenName",
            patronymic=entry.patronymic, version=u.version+CAST(entry.renamed AS INTEGER)
        FROM jsonb_to_recordset($1::jsonb) AS entry(
          id TEXT, name TEXT, "familyName" TEXT, "givenName" TEXT, patronymic TEXT, renamed BOOLEAN
        )
        WHERE u.id=entry.id`,
        [JSON.stringify(updates)],
      );
    }
    if (updates.some((user) => user.renamed))
      await client.query('INSERT INTO studyhub_settings(key,value) VALUES ($1,$2)', [
        demoMarker,
        '1',
      ]);
    await client.query('COMMIT');
    return resultFor(updates, missing.length);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}
