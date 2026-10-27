-- Предлагаемая первая миграция PostgreSQL 16+.
-- Не выполнялась на сервере. Тестовые записи и аккаунты отсутствуют.
-- Выполнять только для новой БД после проверки владельцем миграций.
BEGIN;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  email text NOT NULL CHECK (char_length(email) <= 254),
  role text NOT NULL CHECK (role IN ('student', 'teacher', 'admin')),
  group_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (role = 'student' OR group_id IS NULL)
);
CREATE UNIQUE INDEX users_email_unique ON users (lower(btrim(email)));

CREATE TABLE groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  course smallint NOT NULL CHECK (course BETWEEN 1 AND 6),
  curator_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0)
);
CREATE UNIQUE INDEX groups_name_unique ON groups (lower(btrim(name)));
ALTER TABLE users ADD CONSTRAINT users_group_fk FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE RESTRICT;
CREATE INDEX users_group_idx ON users (group_id) WHERE role = 'student';

CREATE TABLE subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 160)
);
CREATE UNIQUE INDEX subjects_name_unique ON subjects (lower(btrim(name)));
CREATE TABLE rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  capacity integer CHECK (capacity > 0),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0)
);
CREATE UNIQUE INDEX rooms_name_unique ON rooms (lower(btrim(name)));

CREATE TABLE teaching_assignments (
  teacher_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  PRIMARY KEY (teacher_id, group_id, subject_id)
);
CREATE INDEX teaching_group_subject_idx ON teaching_assignments (group_id, subject_id);

CREATE TABLE lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  teacher_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  kind text NOT NULL CHECK (char_length(btrim(kind)) BETWEEN 1 AND 80),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled')),
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 2000),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  attendance_version integer NOT NULL DEFAULT 1 CHECK (attendance_version > 0),
  FOREIGN KEY (teacher_id, group_id, subject_id) REFERENCES teaching_assignments(teacher_id, group_id, subject_id),
  CHECK (ends_at > starts_at),
  EXCLUDE USING gist (group_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&) WHERE (status = 'scheduled'),
  EXCLUDE USING gist (teacher_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&) WHERE (status = 'scheduled'),
  EXCLUDE USING gist (room_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&) WHERE (status = 'scheduled')
);
CREATE INDEX lessons_start_idx ON lessons (starts_at);
CREATE INDEX lessons_teacher_start_idx ON lessons (teacher_id, starts_at);
CREATE INDEX lessons_group_start_idx ON lessons (group_id, starts_at);

CREATE TABLE assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  teacher_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 160),
  type text NOT NULL CHECK (char_length(btrim(type)) BETWEEN 1 AND 80),
  description text NOT NULL CHECK (char_length(btrim(description)) BETWEEN 1 AND 10000),
  steps text[] NOT NULL DEFAULT '{}',
  due_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (teacher_id, group_id, subject_id) REFERENCES teaching_assignments(teacher_id, group_id, subject_id)
);
CREATE INDEX assignments_group_due_idx ON assignments (group_id, due_at);
CREATE INDEX assignments_teacher_idx ON assignments (teacher_id);

CREATE TABLE files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  storage_key text NOT NULL UNIQUE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
  mime_type text NOT NULL,
  bytes bigint NOT NULL CHECK (bytes > 0 AND bytes <= 20971520),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES assignments(id) ON DELETE RESTRICT,
  student_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('submitted', 'reviewed', 'revision')),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  file_id uuid NOT NULL REFERENCES files(id) ON DELETE RESTRICT,
  grade smallint CHECK (grade BETWEEN 2 AND 5),
  comment text NOT NULL DEFAULT '' CHECK (char_length(comment) <= 2000),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (assignment_id, student_id),
  CHECK ((status = 'reviewed' AND grade IS NOT NULL) OR (status <> 'reviewed' AND grade IS NULL)),
  CHECK (status <> 'revision' OR char_length(btrim(comment)) > 0)
);
CREATE INDEX submissions_pending_idx ON submissions (assignment_id, submitted_at) WHERE status = 'submitted';
CREATE INDEX submissions_student_idx ON submissions (student_id);

-- grade = NULL означает снятую оценку. Строка сохраняет монотонную version.
-- В Bootstrap возвращаются и снятые оценки с grade=NULL и актуальной version.
CREATE TABLE grades (
  lesson_id uuid NOT NULL REFERENCES lessons(id) ON DELETE RESTRICT,
  student_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  grade smallint CHECK (grade BETWEEN 2 AND 5),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lesson_id, student_id)
);
CREATE INDEX grades_student_idx ON grades (student_id);
CREATE TABLE attendance (
  lesson_id uuid NOT NULL REFERENCES lessons(id) ON DELETE RESTRICT,
  student_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('present', 'absent', 'late', 'excused')),
  updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lesson_id, student_id)
);
CREATE INDEX attendance_student_idx ON attendance (student_id);

CREATE TABLE materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  file_id uuid NOT NULL REFERENCES files(id) ON DELETE RESTRICT
);
CREATE INDEX materials_subject_idx ON materials (subject_id);
CREATE TABLE announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 10000),
  published_at timestamptz NOT NULL DEFAULT now(),
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX announcements_published_idx ON announcements (published_at DESC);

-- История сдач и проверок заполняется сервером в той же транзакции.
CREATE TABLE submission_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES submissions(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('submitted', 'reviewed', 'revision')),
  file_id uuid REFERENCES files(id) ON DELETE RESTRICT,
  grade smallint CHECK (grade BETWEEN 2 AND 5),
  comment text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX submission_history_record_idx ON submission_history (submission_id, created_at DESC);

-- Связь по UUID сама по себе не проверяет роль пользователя.
CREATE FUNCTION check_teacher_role() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.teacher_id AND role = 'teacher') THEN
    RAISE EXCEPTION 'teacher_id must reference a teacher' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER teaching_assignment_teacher_role BEFORE INSERT OR UPDATE ON teaching_assignments
  FOR EACH ROW EXECUTE FUNCTION check_teacher_role();

CREATE FUNCTION check_lesson_student() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users u JOIN lessons l ON l.group_id = u.group_id
                 WHERE l.id = NEW.lesson_id AND u.id = NEW.student_id AND u.role = 'student') THEN
    RAISE EXCEPTION 'student must belong to the lesson group' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER grade_student_group BEFORE INSERT OR UPDATE ON grades FOR EACH ROW EXECUTE FUNCTION check_lesson_student();
CREATE TRIGGER attendance_student_group BEFORE INSERT OR UPDATE ON attendance FOR EACH ROW EXECUTE FUNCTION check_lesson_student();

CREATE FUNCTION check_submission_student() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users u JOIN assignments a ON a.group_id = u.group_id
                 WHERE a.id = NEW.assignment_id AND u.id = NEW.student_id AND u.role = 'student') THEN
    RAISE EXCEPTION 'student must belong to the assignment group' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM files f WHERE f.id = NEW.file_id AND f.owner_id = NEW.student_id) THEN
    RAISE EXCEPTION 'submission file must belong to its student' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER submission_student_group BEFORE INSERT OR UPDATE ON submissions FOR EACH ROW EXECUTE FUNCTION check_submission_student();
COMMIT;
