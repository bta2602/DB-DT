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

export const schoolSchema = `
      CREATE TABLE IF NOT EXISTS school_groups (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE,
        course INTEGER NOT NULL CHECK(course BETWEEN 1 AND 6),
        curator_id TEXT REFERENCES auth_users(id), version INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS school_subjects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE,
        version INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS school_rooms (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE,
        capacity INTEGER CHECK(capacity BETWEEN 1 AND 1000), version INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS school_teaching_assignments (
        teacher_id TEXT NOT NULL REFERENCES auth_users(id),
        group_id TEXT NOT NULL REFERENCES school_groups(id),
        subject_id TEXT NOT NULL REFERENCES school_subjects(id),
        PRIMARY KEY(teacher_id, group_id, subject_id)
      );
      CREATE TABLE IF NOT EXISTS school_lessons (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL REFERENCES school_groups(id),
        subject_id TEXT NOT NULL REFERENCES school_subjects(id),
        teacher_id TEXT NOT NULL REFERENCES auth_users(id),
        room_id TEXT NOT NULL REFERENCES school_rooms(id),
        starts_at TEXT NOT NULL, ends_at TEXT NOT NULL CHECK(ends_at > starts_at),
        kind TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('scheduled','cancelled')),
        note TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1,
        attendance_version INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS school_lessons_time ON school_lessons(starts_at, ends_at);
      CREATE INDEX IF NOT EXISTS school_lessons_group ON school_lessons(group_id, starts_at);
      CREATE INDEX IF NOT EXISTS school_lessons_teacher ON school_lessons(teacher_id, starts_at);
      CREATE INDEX IF NOT EXISTS school_lessons_room ON school_lessons(room_id, starts_at);
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
    due_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS school_submissions (
    id TEXT PRIMARY KEY, assignment_id TEXT NOT NULL REFERENCES school_assignments(id),
    student_id TEXT NOT NULL REFERENCES auth_users(id), file_id TEXT NOT NULL REFERENCES school_files(id),
    status TEXT NOT NULL CHECK(status IN ('submitted','reviewed','revision')),
    submitted_at TEXT NOT NULL, grade INTEGER CHECK(grade IN (2,3,4,5)),
    comment TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1,
    UNIQUE(assignment_id, student_id)
  );
  CREATE TABLE IF NOT EXISTS school_grades (
    lesson_id TEXT NOT NULL REFERENCES school_lessons(id), student_id TEXT NOT NULL REFERENCES auth_users(id),
    grade INTEGER CHECK(grade IN (2,3,4,5)), version INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY(lesson_id, student_id)
  );
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
