import { refreshPostgresLessonTriggers, refreshSqliteLessonTriggers } from './academic-data.mjs';

export const eveningSlotsMigrationKey = 'evening_slots_v1';
const originalSlots = Array.from({ length: 9 }, (_, index) => `p${index + 1}`);
const eveningSlots = [...originalSlots, 'p10', 'p11', 'p12'];
const allowedSql = eveningSlots.map((slot) => `'${slot}'`).join(',');
const quote = (name) => `"${name.replaceAll('"', '""')}"`;

function expectedSlots(definition) {
  const slots = [...definition.matchAll(/'(p\d+)'/g)].map((match) => match[1]);
  return [originalSlots, eveningSlots].some(
    (expected) =>
      slots.length === expected.length && expected.every((slot, index) => slot === slots[index]),
  );
}

/** Widen only the known slot check; preserve every original column and dependent row. */
export function migrateSqliteEveningSlots(db) {
  if (db.isTransaction) throw new Error('Evening-slot migration requires its own transaction.');
  if (db.prepare('SELECT 1 FROM studyhub_settings WHERE key=?').get(eveningSlotsMigrationKey))
    return { migrated: false };
  const foreignKeys = db.prepare('PRAGMA foreign_keys').get().foreign_keys;
  const legacyAlter = db.prepare('PRAGMA legacy_alter_table').get().legacy_alter_table;
  db.exec('PRAGMA foreign_keys=OFF; PRAGMA legacy_alter_table=ON; BEGIN IMMEDIATE;');
  try {
    if (db.prepare('SELECT 1 FROM studyhub_settings WHERE key=?').get(eveningSlotsMigrationKey)) {
      db.exec('COMMIT');
      return { migrated: false };
    }
    if (db.prepare('PRAGMA foreign_key_check').all().length)
      throw new Error('Foreign key check failed before evening-slot migration.');
    const original = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='school_lessons'")
      .get()?.sql;
    if (!original) throw new Error('Run the academic rules migration first.');
    let found = false;
    const widened = original.replace(/\bslot_id\s+IN\s*\(([^)]*)\)/gi, (match) => {
      if (!expectedSlots(match))
        throw new Error('Unknown slot constraint; manual review required.');
      found = true;
      return `slot_id IN (${allowedSql})`;
    });
    if (!found)
      throw new Error('Known slot constraint not found; run the academic rules migration first.');
    if (widened !== original) {
      const replacement = widened.replace(
        /^CREATE TABLE(?: IF NOT EXISTS)?\s+"?school_lessons"?/i,
        'CREATE TABLE school_lessons_evening_new',
      );
      if (replacement === widened) throw new Error('Unexpected lesson table definition.');
      const objects = db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE tbl_name='school_lessons' AND type IN ('index','trigger') AND sql IS NOT NULL",
        )
        .all();
      const names = db
        .prepare('PRAGMA table_info(school_lessons)')
        .all()
        .map((row) => quote(row.name))
        .join(',');
      db.exec(replacement);
      db.exec(`INSERT INTO school_lessons_evening_new(${names}) SELECT ${names} FROM school_lessons;
        DROP TABLE school_lessons;
        ALTER TABLE school_lessons_evening_new RENAME TO school_lessons;`);
      for (const object of objects) db.exec(object.sql);
    }
    if (db.prepare("SELECT 1 FROM studyhub_settings WHERE key='academic_data_v1'").get())
      refreshSqliteLessonTriggers(db);
    if (db.prepare('PRAGMA foreign_key_check').all().length)
      throw new Error('Foreign key check failed after evening-slot migration.');
    db.prepare('INSERT INTO studyhub_settings(key,value) VALUES (?,?)').run(
      eveningSlotsMigrationKey,
      '1',
    );
    db.exec('COMMIT');
    return { migrated: true };
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* Preserve the original error. */
    }
    throw error;
  } finally {
    db.exec(`PRAGMA legacy_alter_table=${legacyAlter}; PRAGMA foreign_keys=${foreignKeys};`);
  }
}

/** Additive production migration: direct client, tested on a branch before application. */
export async function migratePostgresEveningSlots(client) {
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(62846321)');
    const marker = await client.query('SELECT 1 FROM studyhub_settings WHERE key=$1', [
      eveningSlotsMigrationKey,
    ]);
    if (marker.rows.length) {
      await client.query('COMMIT');
      return { migrated: false };
    }
    await client.query('LOCK TABLE school_lessons IN ACCESS EXCLUSIVE MODE');
    const checks = await client.query(`SELECT conname,pg_get_constraintdef(oid) AS definition
      FROM pg_constraint WHERE conrelid='school_lessons'::regclass AND contype='c'
      AND conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='school_lessons'::regclass AND attname='slot_id')]`);
    for (const check of checks.rows) {
      if (
        check.conname !== 'school_lessons_slot_id_check' ||
        !expectedSlots(check.definition) ||
        /\bNOT\b/i.test(check.definition)
      )
        throw new Error('Unknown slot constraint; manual review required.');
      await client.query(`ALTER TABLE school_lessons DROP CONSTRAINT ${quote(check.conname)}`);
    }
    await client.query(`ALTER TABLE school_lessons ADD CONSTRAINT school_lessons_slot_id_check
      CHECK(slot_id IS NULL OR slot_id IN (${allowedSql}))`);
    const academic = await client.query(
      "SELECT 1 FROM studyhub_settings WHERE key='academic_data_v1'",
    );
    if (academic.rows.length) await refreshPostgresLessonTriggers(client);
    await client.query('INSERT INTO studyhub_settings(key,value) VALUES ($1,$2)', [
      eveningSlotsMigrationKey,
      '1',
    ]);
    await client.query('COMMIT');
    return { migrated: true };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* Preserve the original error. */
    }
    throw error;
  }
}
