import { academicRelationsSchema, academicSeedSchema, lessonsSchema } from '../schema.mjs';

export const academicMigrationKey = 'academic_data_v1';

const columns = {
  school_groups: {
    program: "TEXT CHECK(program IN ('IS','VTIPO','DS'))",
    intake_year: 'INTEGER CHECK(intake_year BETWEEN 1900 AND 9999)',
    language: "TEXT CHECK(language IN ('kk','ru'))",
  },
  school_rooms: {
    number: 'TEXT',
    floor: 'INTEGER CHECK(floor BETWEEN 1 AND 100)',
    type: "TEXT CHECK(type IN ('computer','lecture','laboratory','ordinary'))",
  },
  school_lessons: {
    practice_id: 'TEXT REFERENCES school_lessons(id) ON DELETE RESTRICT',
    slot_id: "TEXT CHECK(slot_id IN ('p1','p2','p3','p4','p5','p6','p7','p8','p9'))",
    academic_year: 'INTEGER CHECK(academic_year BETWEEN 1900 AND 9999)',
    semester: 'INTEGER CHECK(semester IN (1,2))',
  },
  school_assignments: { lesson_id: 'TEXT REFERENCES school_lessons(id) ON DELETE RESTRICT' },
};

const slots = ['08:00', '08:55', '09:50', '10:55', '11:50', '12:45', '13:50', '14:45', '15:40'];
const slotTime = `CASE NEW.slot_id ${slots.map((time, i) => `WHEN 'p${i + 1}' THEN '${time}:00.000'`).join(' ')} END`;
const identity = ['group_id', 'subject_id', 'teacher_id'];
const scheduleFields = [
  ...identity,
  'room_id',
  'starts_at',
  'ends_at',
  'kind',
  'practice_id',
  'slot_id',
  'academic_year',
  'semester',
];
const changed = (fields) =>
  fields.map((field) => `NEW.${field} IS DISTINCT FROM OLD.${field}`).join(' OR ');
// The backend accepts these historical labels without rewriting stored lessons.
// Compare their meaning when a new SRSP or assignment explicitly links to them.
const lessonKind = (value) => `CASE trim(${value})
  WHEN 'Лекция' THEN 'lecture'
  WHEN 'Практика' THEN 'practice'
  WHEN 'Практическая работа' THEN 'practice'
  WHEN 'Лабораторная работа' THEN 'practice'
  WHEN 'СРСП' THEN 'srsp'
  ELSE trim(${value}) END`;

function dialectExpressions(dialect) {
  const postgres = dialect === 'postgres';
  const local = (value) =>
    postgres
      ? `(CAST(${value} AS timestamptz) AT TIME ZONE 'Etc/GMT-5')`
      : `datetime(${value}, '+5 hours')`;
  const date = (value) =>
    postgres ? `TO_CHAR(${local(value)}, 'YYYY-MM-DD')` : `date(${value}, '+5 hours')`;
  const year = (value) =>
    postgres
      ? `CAST(EXTRACT(YEAR FROM ${local(value)}) AS INTEGER)`
      : `CAST(strftime('%Y', ${local(value)}) AS INTEGER)`;
  const month = (value) =>
    postgres
      ? `EXTRACT(MONTH FROM ${local(value)})`
      : `CAST(strftime('%m', ${local(value)}) AS INTEGER)`;
  const academicYear = (value) =>
    `(${year(value)} - CASE WHEN ${month(value)} < 9 THEN 1 ELSE 0 END)`;
  const semester = (value) => `(CASE WHEN ${month(value)} >= 9 THEN 1 ELSE 2 END)`;
  const time = postgres
    ? `TO_CHAR(${local('NEW.starts_at')}, 'HH24:MI:SS.MS')`
    : "strftime('%H:%M:%f', NEW.starts_at, '+5 hours')";
  const duration = postgres
    ? '(EXTRACT(EPOCH FROM (CAST(NEW.ends_at AS timestamptz)-CAST(NEW.starts_at AS timestamptz))) = 3000)'
    : '(ABS((julianday(NEW.ends_at)-julianday(NEW.starts_at))*86400-3000) < 0.001)';
  const instant = (value) => (postgres ? `CAST(${value} AS timestamptz)` : `julianday(${value})`);
  return { date, academicYear, semester, time, duration, instant };
}

function triggerDefinitions(dialect) {
  const { academicYear, semester, time, duration, instant } = dialectExpressions(dialect);
  const lessonRules = [
    [
      "NEW.kind NOT IN ('lecture','practice','srsp') OR NEW.academic_year IS NULL OR NEW.semester IS NULL",
      'Academic lesson kind and term are required',
    ],
    [
      "NEW.kind <> 'srsp' AND (NEW.practice_id IS NOT NULL OR NEW.slot_id IS NULL OR NEW.room_id IS NULL OR NEW.starts_at IS NULL OR NEW.ends_at IS NULL)",
      'A scheduled lesson requires a room, times and slot',
    ],
    [
      `NEW.kind <> 'srsp' AND (${time} IS NULL OR ${time} IS DISTINCT FROM (${slotTime}) OR ${duration} IS NOT TRUE OR NEW.academic_year IS DISTINCT FROM ${academicYear('NEW.starts_at')} OR NEW.semester IS DISTINCT FROM ${semester('NEW.starts_at')})`,
      'Lesson must use the academic slot grid in UTC+5',
    ],
    [
      "NEW.kind = 'srsp' AND (NEW.practice_id IS NULL OR NEW.practice_id=NEW.id OR NEW.slot_id IS NOT NULL OR NEW.room_id IS NOT NULL OR NEW.starts_at IS NOT NULL OR NEW.ends_at IS NOT NULL)",
      'SRSP must reference a practice without booking a slot',
    ],
    [
      `NEW.kind='srsp' AND NOT EXISTS (SELECT 1 FROM school_lessons p WHERE p.id=NEW.practice_id AND (${lessonKind('p.kind')})='practice' AND p.group_id=NEW.group_id AND p.subject_id=NEW.subject_id AND p.teacher_id=NEW.teacher_id AND COALESCE(p.academic_year,${academicYear('p.starts_at')})=NEW.academic_year AND COALESCE(p.semester,${semester('p.starts_at')})=NEW.semester)`,
      'SRSP practice must have the same teacher, group, subject and term',
    ],
    [
      `NOT EXISTS (SELECT 1 FROM school_groups g JOIN school_teacher_languages tl ON tl.teacher_id=NEW.teacher_id AND tl.language=g.language WHERE g.id=NEW.group_id AND g.program IS NOT NULL AND g.intake_year IS NOT NULL)`,
      'Teacher language must match the academic group',
    ],
    [
      'NOT EXISTS (SELECT 1 FROM school_teacher_subjects ts WHERE ts.teacher_id=NEW.teacher_id AND ts.subject_id=NEW.subject_id)',
      'Teacher must be qualified for the subject',
    ],
    [
      'NOT EXISTS (SELECT 1 FROM school_group_subjects gs WHERE gs.group_id=NEW.group_id AND gs.subject_id=NEW.subject_id AND gs.academic_year=NEW.academic_year AND gs.semester=NEW.semester)',
      'Subject must belong to the group curriculum for this term',
    ],
    [
      'NOT EXISTS (SELECT 1 FROM school_teaching_assignments ta WHERE ta.teacher_id=NEW.teacher_id AND ta.group_id=NEW.group_id AND ta.subject_id=NEW.subject_id)',
      'Lesson must have a teaching assignment',
    ],
    [
      `NEW.kind<>'srsp' AND NEW.status='scheduled' AND EXISTS (SELECT 1 FROM school_lessons l WHERE l.id<>NEW.id AND l.status='scheduled' AND l.kind<>'srsp' AND ${instant('l.starts_at')} < ${instant('NEW.ends_at')} AND ${instant('l.ends_at')} > ${instant('NEW.starts_at')} AND (l.group_id=NEW.group_id OR l.teacher_id=NEW.teacher_id OR l.room_id=NEW.room_id))`,
      'Lesson overlaps a group, teacher or room booking',
    ],
  ];
  const assignmentRules = [
    ['NEW.lesson_id IS NULL', 'A new assignment must reference a lesson'],
    [
      `NOT EXISTS (SELECT 1 FROM school_lessons l WHERE l.id=NEW.lesson_id AND (${lessonKind('l.kind')})=NEW.type AND l.group_id=NEW.group_id AND l.subject_id=NEW.subject_id AND l.teacher_id=NEW.teacher_id)`,
      'Assignment type and identity must match its lesson',
    ],
  ];
  const teachingRules = [
    [
      "NOT EXISTS (SELECT 1 FROM auth_users WHERE id=NEW.teacher_id AND role='teacher')",
      'Teaching assignment requires a teacher',
    ],
    [
      'NOT EXISTS (SELECT 1 FROM school_teacher_subjects WHERE teacher_id=NEW.teacher_id AND subject_id=NEW.subject_id)',
      'Teaching assignment requires a qualified teacher',
    ],
    [
      'NOT EXISTS (SELECT 1 FROM school_group_subjects WHERE group_id=NEW.group_id AND subject_id=NEW.subject_id)',
      'Teaching assignment requires a group curriculum',
    ],
    [
      'NOT EXISTS (SELECT 1 FROM school_groups g JOIN school_teacher_languages tl ON tl.language=g.language AND tl.teacher_id=NEW.teacher_id WHERE g.id=NEW.group_id)',
      'Teaching assignment requires the group language',
    ],
  ];
  const teachers = [
    [
      "NOT EXISTS (SELECT 1 FROM auth_users WHERE id=NEW.teacher_id AND role='teacher')",
      'Teacher profile requires a teacher account',
    ],
  ];
  const rules = [];
  const add = (name, table, event, checks, when = null) =>
    rules.push({ name: `academic_${name}`, table, event, checks, when });
  add('lesson_insert', 'school_lessons', 'INSERT', lessonRules);
  add(
    'lesson_update',
    'school_lessons',
    'UPDATE',
    lessonRules,
    `(${changed(scheduleFields)}) OR (OLD.status='cancelled' AND NEW.status='scheduled')`,
  );
  add(
    'practice_update',
    'school_lessons',
    'UPDATE',
    [
      [
        `EXISTS (SELECT 1 FROM school_lessons l WHERE l.practice_id=OLD.id AND ((${lessonKind('NEW.kind')})<>'practice' OR l.group_id<>NEW.group_id OR l.subject_id<>NEW.subject_id OR l.teacher_id<>NEW.teacher_id OR COALESCE(l.academic_year,${academicYear('OLD.starts_at')}) IS DISTINCT FROM COALESCE(NEW.academic_year,${academicYear('NEW.starts_at')}) OR COALESCE(l.semester,${semester('OLD.starts_at')}) IS DISTINCT FROM COALESCE(NEW.semester,${semester('NEW.starts_at')})))`,
        'Practice update would invalidate its SRSP',
      ],
      [
        `EXISTS (SELECT 1 FROM school_assignments a WHERE a.lesson_id=OLD.id AND ((${lessonKind('a.type')})<>(${lessonKind('NEW.kind')}) OR a.group_id<>NEW.group_id OR a.subject_id<>NEW.subject_id OR a.teacher_id<>NEW.teacher_id))`,
        'Lesson update would invalidate its assignments',
      ],
    ],
    changed([...identity, 'kind', 'starts_at', 'academic_year', 'semester']),
  );
  add('assignment_insert', 'school_assignments', 'INSERT', assignmentRules);
  add(
    'assignment_update',
    'school_assignments',
    'UPDATE',
    assignmentRules,
    `(NEW.lesson_id IS NOT NULL AND (${changed([...identity, 'type'])})) OR (${changed(['lesson_id'])})`,
  );
  for (const event of ['INSERT', 'UPDATE']) {
    add(`teaching_${event.toLowerCase()}`, 'school_teaching_assignments', event, teachingRules);
    add(`language_${event.toLowerCase()}`, 'school_teacher_languages', event, teachers);
    add(`specialty_${event.toLowerCase()}`, 'school_teacher_subjects', event, [
      ...teachers,
      [
        `(SELECT count(*) FROM school_teacher_subjects WHERE teacher_id=NEW.teacher_id AND subject_id<>NEW.subject_id${event === 'UPDATE' ? ' AND NOT (teacher_id=OLD.teacher_id AND subject_id=OLD.subject_id)' : ''}) >= 3`,
        'A teacher may have at most three subjects',
      ],
    ]);
  }
  // Profiles used by a modern lesson cannot be removed underneath that lesson.
  for (const [suffix, table, condition, keys] of [
    [
      'specialty',
      'school_teacher_subjects',
      'l.teacher_id=OLD.teacher_id AND l.subject_id=OLD.subject_id',
      ['teacher_id', 'subject_id'],
    ],
    [
      'language',
      'school_teacher_languages',
      'l.teacher_id=OLD.teacher_id AND EXISTS (SELECT 1 FROM school_groups g WHERE g.id=l.group_id AND g.language=OLD.language)',
      ['teacher_id', 'language'],
    ],
    [
      'curriculum',
      'school_group_subjects',
      'l.group_id=OLD.group_id AND l.subject_id=OLD.subject_id AND l.academic_year=OLD.academic_year AND l.semester=OLD.semester',
      ['group_id', 'subject_id', 'academic_year', 'semester'],
    ],
    [
      'teaching',
      'school_teaching_assignments',
      'l.teacher_id=OLD.teacher_id AND l.group_id=OLD.group_id AND l.subject_id=OLD.subject_id',
      ['teacher_id', 'group_id', 'subject_id'],
    ],
  ]) {
    const referenced = [
      [
        `EXISTS (SELECT 1 FROM school_lessons l WHERE l.academic_year IS NOT NULL AND ${condition})`,
        'Profile is referenced by an academic lesson',
      ],
    ];
    add(`${suffix}_delete`, table, 'DELETE', referenced);
    add(`${suffix}_replace`, table, 'UPDATE', referenced, changed(keys));
  }
  add(
    'group_update',
    'school_groups',
    'UPDATE',
    [
      [
        `EXISTS (SELECT 1 FROM school_lessons l WHERE l.group_id=OLD.id AND l.academic_year IS NOT NULL AND (NEW.program IS NULL OR NEW.intake_year IS NULL OR NEW.language IS NULL OR NOT EXISTS (SELECT 1 FROM school_teacher_languages tl WHERE tl.teacher_id=l.teacher_id AND tl.language=NEW.language)))`,
        'Group update would invalidate its academic lessons',
      ],
    ],
    changed(['program', 'intake_year', 'language']),
  );
  add(
    'teacher_role',
    'auth_users',
    'UPDATE',
    [
      [
        `NEW.role<>'teacher' AND (EXISTS (SELECT 1 FROM school_teacher_subjects WHERE teacher_id=OLD.id) OR EXISTS (SELECT 1 FROM school_teacher_languages WHERE teacher_id=OLD.id))`,
        'Teacher role is required by the academic profile',
      ],
    ],
    changed(['role']),
  );
  return rules;
}

function sqliteTriggers() {
  return triggerDefinitions('sqlite')
    .map(
      ({ name, table, event, checks, when }) => `
    CREATE TRIGGER ${name} BEFORE ${event} ON ${table}${when ? ` WHEN ${when}` : ''} BEGIN
      ${checks.map(([condition, message]) => `SELECT CASE WHEN ${condition} THEN RAISE(ABORT, '${message}') END;`).join('\n')}
    END;
  `,
    )
    .join('\n');
}

function postgresTriggers() {
  return triggerDefinitions('postgres')
    .map(
      ({ name, table, event, checks, when }) => `
    CREATE OR REPLACE FUNCTION ${name}_fn() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN
      PERFORM pg_advisory_xact_lock(62846321);
      ${when ? `IF ${when} THEN` : ''}
      ${checks.map(([condition, message]) => `IF ${condition} THEN RAISE EXCEPTION '${message}' USING ERRCODE='23514'; END IF;`).join('\n')}
      ${when ? 'END IF;' : ''}
      RETURN ${event === 'DELETE' ? 'OLD' : 'NEW'};
    END;
    $body$;
    CREATE TRIGGER ${name} BEFORE ${event} ON ${table} FOR EACH ROW EXECUTE FUNCTION ${name}_fn();
  `,
    )
    .join('\n');
}

function views(dialect) {
  const { date, academicYear } = dialectExpressions(dialect);
  const now = dialect === 'postgres' ? 'CURRENT_TIMESTAMP' : "'now'";
  return `
    CREATE VIEW school_academic_lessons AS
      SELECT l.*, ${date("CASE WHEN l.kind='srsp' THEN p.starts_at ELSE l.starts_at END")} AS date
      FROM school_lessons l LEFT JOIN school_lessons p ON p.id=l.practice_id;
    CREATE VIEW school_academic_groups AS
      SELECT id,name,curator_id,version,program,intake_year,language,
        CASE WHEN intake_year IS NULL THEN course ELSE ${academicYear(now)} - intake_year + 1 END AS course
      FROM school_groups;
  `;
}

function sqliteHasMarker(db) {
  return db.prepare('SELECT 1 FROM studyhub_settings WHERE key=?').get(academicMigrationKey);
}

/** Explicit migration; callers must close other application connections first. */
export function migrateSqliteAcademic(db) {
  if (db.isTransaction) throw new Error('Academic migration needs its own transaction.');
  const foreignKeys = db.prepare('PRAGMA foreign_keys').get().foreign_keys;
  const legacyAlter = db.prepare('PRAGMA legacy_alter_table').get().legacy_alter_table;
  // Disabling FK actions is necessary for replacing the referenced lessons table.
  // All references are checked before COMMIT, and both PRAGMAs are restored.
  db.exec('PRAGMA foreign_keys=OFF; PRAGMA legacy_alter_table=ON; BEGIN IMMEDIATE;');
  try {
    if (sqliteHasMarker(db)) {
      if (db.prepare('PRAGMA foreign_key_check').all().length)
        throw new Error('Foreign key check failed.');
      db.exec('COMMIT');
      return { migrated: false };
    }
    if (db.prepare('PRAGMA foreign_key_check').all().length)
      throw new Error('Foreign key check failed before migration.');
    const lessonColumns = db.prepare('PRAGMA table_info(school_lessons)').all();
    if (
      lessonColumns.some(
        (column) => ['room_id', 'starts_at', 'ends_at'].includes(column.name) && column.notnull,
      )
    ) {
      const extras = db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE tbl_name='school_lessons' AND type IN ('index','trigger') AND sql IS NOT NULL",
        )
        .all();
      db.exec(
        lessonsSchema.replace(
          'CREATE TABLE IF NOT EXISTS school_lessons',
          'CREATE TABLE school_lessons_academic_new',
        ),
      );
      const names = lessonColumns
        .map((column) => `"${column.name.replaceAll('"', '""')}"`)
        .join(',');
      db.exec(`INSERT INTO school_lessons_academic_new(${names}) SELECT ${names} FROM school_lessons;
        DROP TABLE school_lessons;
        ALTER TABLE school_lessons_academic_new RENAME TO school_lessons;`);
      for (const item of extras) db.exec(item.sql);
    }
    for (const [table, fields] of Object.entries(columns)) {
      const present = new Set(
        db
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .map((column) => column.name),
      );
      for (const [name, definition] of Object.entries(fields)) {
        if (!present.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition};`);
      }
    }
    db.exec(academicRelationsSchema + academicSeedSchema + views('sqlite') + sqliteTriggers());
    if (db.prepare('PRAGMA foreign_key_check').all().length)
      throw new Error('Foreign key check failed after migration.');
    db.prepare('INSERT INTO studyhub_settings(key,value) VALUES (?,?)').run(
      academicMigrationKey,
      '1',
    );
    db.exec('COMMIT');
    return { migrated: true };
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* Preserve the original failure. */
    }
    throw error;
  } finally {
    db.exec(`PRAGMA legacy_alter_table=${legacyAlter}; PRAGMA foreign_keys=${foreignKeys};`);
  }
}

// The importer installs these only after copying historical rows, in its own
// transaction, so legacy records retain their original intervals and null links.
export async function installPostgresAcademicDataObjects(client) {
  await client.query(
    academicRelationsSchema + academicSeedSchema + views('postgres') + postgresTriggers(),
  );
}

/** Explicit PostgreSQL migration; never called during application startup. */
export async function migratePostgresAcademic(client) {
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(62846321)');
    const marker = await client.query('SELECT 1 FROM studyhub_settings WHERE key=$1', [
      academicMigrationKey,
    ]);
    if (marker.rows.length) {
      await client.query('COMMIT');
      return { migrated: false };
    }
    await client.query(
      'LOCK TABLE auth_users, school_groups, school_rooms, school_lessons, school_assignments, school_teaching_assignments IN ACCESS EXCLUSIVE MODE',
    );
    for (const [table, fields] of Object.entries(columns)) {
      for (const [name, definition] of Object.entries(fields)) {
        await client.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${name} ${definition};`);
      }
    }
    await client.query(
      'ALTER TABLE school_lessons ALTER COLUMN room_id DROP NOT NULL, ALTER COLUMN starts_at DROP NOT NULL, ALTER COLUMN ends_at DROP NOT NULL;',
    );
    await installPostgresAcademicDataObjects(client);
    // Previously NOT VALID foreign keys must also pass validation before the marker.
    const constraints = await client.query(
      `SELECT conrelid::regclass::text AS table_name,conname FROM pg_constraint WHERE contype='f' AND connamespace=current_schema()::regnamespace AND NOT convalidated`,
    );
    for (const constraint of constraints.rows) {
      const name = constraint.conname.replaceAll('"', '""');
      // regclass supplies a correctly quoted, schema-qualified identifier.
      await client.query(`ALTER TABLE ${constraint.table_name} VALIDATE CONSTRAINT "${name}";`);
    }
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    await client.query('INSERT INTO studyhub_settings(key,value) VALUES ($1,$2)', [
      academicMigrationKey,
      '1',
    ]);
    await client.query('COMMIT');
    return { migrated: true };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* Preserve the original failure. */
    }
    throw error;
  }
}
