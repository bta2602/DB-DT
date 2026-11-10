// Рабочая схема SQLite. CREATE IF NOT EXISTS сохраняет существующие записи.
// Пароли, сессии и учебные данные находятся в одной серверной базе.

export const authSchema = `
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS auth_users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('student','teacher','admin')),
      version INTEGER NOT NULL DEFAULT 1,
      is_demo INTEGER NOT NULL DEFAULT 0 CHECK(is_demo IN (0,1)),
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT REFERENCES auth_users(id) ON DELETE CASCADE,
      csrf_token TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS auth_sessions_expiry ON auth_sessions(expires_at);
    CREATE TABLE IF NOT EXISTS auth_limits (
      bucket TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL,
      resets_at INTEGER NOT NULL
    );
  `;

export const academicRelationsSchema = `
  CREATE TABLE IF NOT EXISTS school_teacher_subjects (
    teacher_id TEXT NOT NULL REFERENCES auth_users(id),
    subject_id TEXT NOT NULL REFERENCES school_subjects(id),
    PRIMARY KEY(teacher_id,subject_id)
  );
  CREATE TABLE IF NOT EXISTS school_teacher_languages (
    teacher_id TEXT NOT NULL REFERENCES auth_users(id),
    language TEXT NOT NULL CHECK(language IN ('kk','ru')),
    PRIMARY KEY(teacher_id,language)
  );
  CREATE TABLE IF NOT EXISTS school_group_subjects (
    group_id TEXT NOT NULL REFERENCES school_groups(id),
    subject_id TEXT NOT NULL REFERENCES school_subjects(id),
    academic_year INTEGER NOT NULL CHECK(academic_year BETWEEN 1900 AND 9999),
    semester INTEGER NOT NULL CHECK(semester IN (1,2)),
    PRIMARY KEY(group_id,subject_id,academic_year,semester)
  );
  CREATE INDEX IF NOT EXISTS school_teacher_subject_lookup ON school_teacher_subjects(subject_id,teacher_id);
  CREATE INDEX IF NOT EXISTS school_curriculum_subject ON school_group_subjects(subject_id,academic_year,semester);
`;

export const lessonsSchema = `
  CREATE TABLE IF NOT EXISTS school_lessons (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES school_groups(id),
    subject_id TEXT NOT NULL REFERENCES school_subjects(id),
    teacher_id TEXT NOT NULL REFERENCES auth_users(id),
    room_id TEXT REFERENCES school_rooms(id),
    starts_at TEXT, ends_at TEXT,
    kind TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('scheduled','cancelled')),
    note TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1,
    attendance_version INTEGER NOT NULL DEFAULT 1,
    practice_id TEXT REFERENCES school_lessons(id) ON DELETE RESTRICT,
    slot_id TEXT CHECK(slot_id IS NULL OR slot_id IN ('p1','p2','p3','p4','p5','p6','p7','p8','p9')),
    academic_year INTEGER CHECK(academic_year BETWEEN 1900 AND 9999),
    semester INTEGER CHECK(semester IN (1,2)),
    CONSTRAINT school_lessons_activity_check CHECK (
      (kind='srsp' AND practice_id IS NOT NULL AND practice_id<>id
        AND room_id IS NULL AND starts_at IS NULL AND ends_at IS NULL AND slot_id IS NULL)
      OR (kind<>'srsp' AND practice_id IS NULL AND room_id IS NOT NULL
        AND starts_at IS NOT NULL AND ends_at IS NOT NULL AND ends_at>starts_at)
    )
  );
`;

export const schoolSchema = `
      CREATE TABLE IF NOT EXISTS school_groups (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE,
        course INTEGER NOT NULL CHECK(course BETWEEN 1 AND 6),
        curator_id TEXT REFERENCES auth_users(id), version INTEGER NOT NULL DEFAULT 1,
        program TEXT CHECK(program IN ('IS','VTIPO','DS')),
        intake_year INTEGER CHECK(intake_year BETWEEN 1900 AND 9999),
        language TEXT CHECK(language IN ('kk','ru'))
      );
      CREATE TABLE IF NOT EXISTS school_subjects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE,
        version INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS school_rooms (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE,
        capacity INTEGER CHECK(capacity BETWEEN 1 AND 1000), version INTEGER NOT NULL DEFAULT 1,
        number TEXT, floor INTEGER CHECK(floor BETWEEN 1 AND 100),
        type TEXT CHECK(type IN ('computer','lecture','laboratory','ordinary'))
      );
      CREATE TABLE IF NOT EXISTS school_teaching_assignments (
        teacher_id TEXT NOT NULL REFERENCES auth_users(id),
        group_id TEXT NOT NULL REFERENCES school_groups(id),
        subject_id TEXT NOT NULL REFERENCES school_subjects(id),
        PRIMARY KEY(teacher_id, group_id, subject_id)
      );
      ${academicRelationsSchema}
      ${lessonsSchema}
      CREATE INDEX IF NOT EXISTS school_lessons_time ON school_lessons(starts_at, ends_at);
      CREATE INDEX IF NOT EXISTS school_lessons_group ON school_lessons(group_id, starts_at);
      CREATE INDEX IF NOT EXISTS school_lessons_teacher ON school_lessons(teacher_id, starts_at);
      CREATE INDEX IF NOT EXISTS school_lessons_room ON school_lessons(room_id, starts_at);
    `;

export const submissionsSchema = `
  CREATE TABLE IF NOT EXISTS school_submissions (
    id TEXT PRIMARY KEY, assignment_id TEXT NOT NULL REFERENCES school_assignments(id),
    student_id TEXT NOT NULL REFERENCES auth_users(id), file_id TEXT NOT NULL REFERENCES school_files(id),
    status TEXT NOT NULL CHECK(status IN ('submitted','reviewed','revision')),
    submitted_at TEXT NOT NULL,
    grade INTEGER CONSTRAINT school_submissions_grade_check CHECK(grade BETWEEN 0 AND 100 AND grade = CAST(grade AS INTEGER)),
    comment TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1,
    UNIQUE(assignment_id, student_id)
  );
`;

export const gradesSchema = `
  CREATE TABLE IF NOT EXISTS school_grades (
    lesson_id TEXT NOT NULL REFERENCES school_lessons(id), student_id TEXT NOT NULL REFERENCES auth_users(id),
    grade INTEGER, status TEXT NOT NULL DEFAULT 'unmarked', version INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT school_grades_status_check CHECK(status IN ('graded','not_required','absent','unmarked')),
    CONSTRAINT school_grades_grade_check CHECK(
      (status = 'graded' AND grade IS NOT NULL AND grade BETWEEN 0 AND 100 AND grade = CAST(grade AS INTEGER))
      OR (status <> 'graded' AND grade IS NULL)
    ),
    PRIMARY KEY(lesson_id, student_id)
  );
`;

export const learningSchema = `
  CREATE TABLE IF NOT EXISTS school_files (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, mime_type TEXT NOT NULL,
    contents BLOB NOT NULL, bytes INTEGER NOT NULL CHECK(bytes > 0 AND bytes <= 20971520)
  );
  CREATE TABLE IF NOT EXISTS school_assignments (
    id TEXT PRIMARY KEY, subject_id TEXT NOT NULL REFERENCES school_subjects(id),
    group_id TEXT NOT NULL REFERENCES school_groups(id), teacher_id TEXT NOT NULL REFERENCES auth_users(id),
    title TEXT NOT NULL, type TEXT NOT NULL, description TEXT NOT NULL, steps_json TEXT NOT NULL,
    due_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
    lesson_id TEXT REFERENCES school_lessons(id) ON DELETE RESTRICT
  );
  ${submissionsSchema}
  ${gradesSchema}
  CREATE TABLE IF NOT EXISTS school_attendance (
    lesson_id TEXT NOT NULL REFERENCES school_lessons(id), student_id TEXT NOT NULL REFERENCES auth_users(id),
    status TEXT NOT NULL CHECK(status IN ('present','absent','late','excused')),
    PRIMARY KEY(lesson_id, student_id)
  );
  CREATE TABLE IF NOT EXISTS school_materials (
    id TEXT PRIMARY KEY, subject_id TEXT NOT NULL REFERENCES school_subjects(id),
    title TEXT NOT NULL, file_id TEXT NOT NULL REFERENCES school_files(id)
  );
  CREATE TABLE IF NOT EXISTS school_announcements (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, published_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS school_demo_seeds (
    id TEXT PRIMARY KEY, seed_date TEXT NOT NULL, counts_json TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS school_assignments_teacher ON school_assignments(teacher_id, group_id);
  CREATE INDEX IF NOT EXISTS school_submissions_file ON school_submissions(file_id);

  CREATE TABLE IF NOT EXISTS studyhub_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS auth_users_group ON auth_users(group_id, role);
  CREATE INDEX IF NOT EXISTS auth_users_demo ON auth_users(is_demo);
  CREATE INDEX IF NOT EXISTS school_assignments_group ON school_assignments(group_id, due_at);
  CREATE INDEX IF NOT EXISTS school_submissions_student ON school_submissions(student_id, assignment_id);
  CREATE INDEX IF NOT EXISTS school_grades_student ON school_grades(student_id, lesson_id);
  CREATE INDEX IF NOT EXISTS school_attendance_student ON school_attendance(student_id, lesson_id);
  CREATE INDEX IF NOT EXISTS school_materials_subject ON school_materials(subject_id);
  CREATE INDEX IF NOT EXISTS school_materials_file ON school_materials(file_id);
  CREATE INDEX IF NOT EXISTS school_teaching_groups ON school_teaching_assignments(group_id, subject_id);
`;

// Installed by the explicit academic migration. Keeping this separate prevents
// ordinary application startup from applying new constraints to a legacy database.
export const academicSeedMapSchema = `
  CREATE TABLE IF NOT EXISTS school_academic_seed_map (
    entity TEXT NOT NULL, seed_key TEXT NOT NULL, record_id TEXT NOT NULL,
    PRIMARY KEY(entity,seed_key), UNIQUE(entity,record_id)
  );
`;

export const academicSeedSchema = `
  ${academicSeedMapSchema}
  CREATE INDEX IF NOT EXISTS school_teacher_subject_lookup ON school_teacher_subjects(subject_id,teacher_id);
  CREATE INDEX IF NOT EXISTS school_group_curriculum ON school_group_subjects(group_id,academic_year,semester);
  CREATE INDEX IF NOT EXISTS school_lessons_practice ON school_lessons(practice_id);
  CREATE INDEX IF NOT EXISTS school_assignments_lesson ON school_assignments(lesson_id);
  CREATE UNIQUE INDEX IF NOT EXISTS school_group_academic_identity ON school_groups(program,intake_year,language)
    WHERE program IS NOT NULL AND intake_year IS NOT NULL AND language IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS school_room_number ON school_rooms(number) WHERE number IS NOT NULL;
`;
