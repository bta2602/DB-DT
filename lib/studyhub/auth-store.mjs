import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { scopeBootstrap } from './policy.mjs';

const SCRYPT = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const AUTH_LIFETIME = 30 * 24 * 60 * 60 * 1000;
const GUEST_LIFETIME = 60 * 60 * 1000;
const databaseKey = Symbol.for('studyhub.auth.databases');
const workKey = Symbol.for('studyhub.auth.passwordWork');
const schoolConnections = new WeakSet();

export class AuthError extends Error {
  /** @param {number} status @param {string} code @param {string} message @param {Record<string,string>} fields @param {number} retryAfter */
  constructor(status, code, message, fields = {}, retryAfter = 0) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.retryAfter = retryAfter;
  }
}

function database() {
  const directory = resolve(process.env.STUDYHUB_DATA_DIR || resolve(process.cwd(), '.studyhub'));
  const publicRelative = relative(resolve(process.cwd(), 'public'), directory);
  if (!publicRelative || (publicRelative !== '..' && !publicRelative.startsWith('..' + sep) && !isAbsolute(publicRelative))) {
    throw new Error('Authentication storage must be outside public');
  }
  const filename = resolve(directory, 'auth.sqlite');
  const databases = globalThis[databaseKey] ||= new Map();
  if (databases.has(filename)) {
    const cached = databases.get(filename);
    ensureSchoolSchema(cached);
    return cached;
  }

  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  db.exec(`
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
  `);
  chmodSync(filename, 0o600);
  ensureSchoolSchema(db);
  databases.set(filename, db);
  return db;
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

// The module-local set deliberately rechecks connections retained across Next.js
// hot reloads. Existing auth databases are migrated without replacing accounts.
function ensureSchoolSchema(db) {
  if (schoolConnections.has(db)) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
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
    `);
    if (!db.prepare('PRAGMA table_info(auth_users)').all().some(column => column.name === 'group_id')) {
      db.exec('ALTER TABLE auth_users ADD COLUMN group_id TEXT REFERENCES school_groups(id)');
    }
    db.exec('COMMIT');
    schoolConnections.add(db);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function publicLesson(row) {
  return {
    id: row.id, groupId: row.group_id, subjectId: row.subject_id,
    teacherId: row.teacher_id, roomId: row.room_id, startsAt: row.starts_at,
    endsAt: row.ends_at, kind: row.kind, status: row.status, note: row.note,
    version: Number(row.version), attendanceVersion: Number(row.attendance_version),
  };
}

function requireAdmin(db, actor) {
  const current = actor?.id && db.prepare('SELECT role FROM auth_users WHERE id = ?').get(actor.id);
  if (!current || current.role !== 'admin') {
    throw new AuthError(403, 'FORBIDDEN', 'Только администратор может изменять справочники и расписание.');
  }
}

function checkFields(input, allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))) {
    throw new AuthError(422, 'INVALID_BODY', 'В запросе есть неподдерживаемые поля.');
  }
}

function checkVersion(row, value) {
  if (!row) throw new AuthError(404, 'NOT_FOUND', 'Запись не найдена. Обновите страницу.');
  if (!Number.isSafeInteger(value) || value < 1) throw new AuthError(422, 'INVALID_VERSION', 'Обновите страницу и повторите сохранение.');
  if (Number(row.version) !== value) throw new AuthError(409, 'VERSION_CONFLICT', 'Запись уже изменена. Обновите страницу и повторите действие.');
}

function reference(db, table, id, field, label, role = '') {
  if (typeof id !== 'string' || !id || id.length > 100) {
    throw new AuthError(422, 'INVALID_REFERENCE', `Выберите ${label}.`, { [field]: `Выберите ${label}.` });
  }
  // table is supplied only by the server's fixed calls, never by request input.
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  if (!row || (role && row.role !== role)) {
    throw new AuthError(422, 'INVALID_REFERENCE', `Не найдено: ${label}. Обновите справочники.`, { [field]: 'Запись больше недоступна.' });
  }
  return id;
}

function optionalReference(db, table, id, field, label, role = '') {
  return id === null || id === undefined || id === '' ? null : reference(db, table, id, field, label, role);
}

function boundedInteger(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new AuthError(422, 'INVALID_NUMBER', `${label}: укажите целое число от ${minimum} до ${maximum}.`);
  }
  return value;
}

function uniqueName(db, table, input, id) {
  const name = normalizeName(input).normalize('NFC');
  const key = name.toLocaleLowerCase('ru');
  if (db.prepare(`SELECT id FROM ${table} WHERE name_key = ? AND id <> ?`).get(key, id)) {
    throw new AuthError(409, 'NAME_TAKEN', 'Запись с таким названием уже существует.', { name: 'Используйте другое название.' });
  }
  return { name, key };
}

/** @returns {import('./api-contract').User|null} */
function publicUser(row) {
  if (!row) return null;
  return {
    id: String(row.id), name: String(row.name), email: String(row.email),
    role: row.role, groupId: row.group_id ? String(row.group_id) : null, version: Number(row.version),
  };
}

/** @param {unknown} value */
export function normalizeEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw new AuthError(422, 'INVALID_EMAIL', 'Укажите корректную электронную почту.', { email: 'Проверьте адрес электронной почты.' });
  }
  return email;
}

/** @param {unknown} value */
export function normalizeName(value) {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ') : '';
  if (!name || name.length > 120) {
    throw new AuthError(422, 'INVALID_NAME', 'Укажите имя длиной от 1 до 120 символов.', { name: 'Укажите имя длиной от 1 до 120 символов.' });
  }
  return name;
}

/** @param {unknown} value */
export function validatePassword(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) {
    throw new AuthError(422, 'INVALID_PASSWORD', 'Пароль должен содержать от 12 до 128 символов.', { password: 'Используйте от 12 до 128 символов.' });
  }
  return value;
}

/** @param {string} password @param {Buffer} salt @returns {Promise<Buffer>} */
async function deriveKey(password, salt) {
  const work = globalThis[workKey] ||= { active: 0 };
  if (work.active >= 2) throw new AuthError(429, 'AUTH_BUSY', 'Сервис входа занят. Повторите попытку через несколько секунд.', {}, 3);
  work.active++;
  try {
    return await new Promise((accept, reject) => {
      scrypt(password, salt, 64, SCRYPT, (error, key) => error ? reject(error) : accept(key));
    });
  } finally {
    work.active--;
  }
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

async function verifyPassword(password, stored) {
  const parts = typeof stored === 'string' ? stored.split('$') : [];
  const validFormat = parts.length === 6 && parts[0] === 'scrypt' &&
    parts[1] === String(SCRYPT.N) && parts[2] === String(SCRYPT.r) && parts[3] === String(SCRYPT.p) &&
    /^[A-Za-z0-9_-]{22}$/.test(parts[4]) && /^[A-Za-z0-9_-]{86}$/.test(parts[5]);
  const salt = validFormat ? Buffer.from(parts[4], 'base64url') : Buffer.alloc(16);
  const expected = validFormat ? Buffer.from(parts[5], 'base64url') : Buffer.alloc(64);
  const actual = await deriveKey(password, salt);
  const matches = timingSafeEqual(expected, actual);
  return validFormat && matches;
}

function transaction(action) {
  const db = database();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = action(db);
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** @param {string} bucket @param {number} maximum @param {number} windowMs */
export function consumeRateLimit(bucket, maximum, windowMs) {
  const now = Date.now();
  const db = database();
  db.prepare('DELETE FROM auth_limits WHERE resets_at <= ?').run(now);
  const entry = db.prepare(`
    INSERT INTO auth_limits(bucket, attempts, resets_at) VALUES (?, 1, ?)
    ON CONFLICT(bucket) DO UPDATE SET attempts = auth_limits.attempts + 1
    RETURNING attempts, resets_at
  `).get(bucket, now + windowMs);
  if (Number(entry.attempts) > maximum) {
    throw new AuthError(429, 'RATE_LIMITED', 'Слишком много попыток. Попробуйте позже.', {}, Math.max(1, Math.ceil((Number(entry.resets_at) - now) / 1000)));
  }
}

function insertSession(db, userId, oldToken = '') {
  const token = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + (userId ? AUTH_LIFETIME : GUEST_LIFETIME);
  if (oldToken) db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(digest(oldToken));
  db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(Date.now());
  db.prepare('INSERT INTO auth_sessions(token_hash, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)')
    .run(digest(token), userId, csrfToken, expiresAt);
  const user = userId ? publicUser(db.prepare('SELECT id, name, email, role, group_id, version FROM auth_users WHERE id = ?').get(userId)) : null;
  return { token, csrfToken, expiresAt, user };
}

/** @param {string} token */
export function readSession(token) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const db = database();
  const row = db.prepare('SELECT user_id, csrf_token, expires_at FROM auth_sessions WHERE token_hash = ? AND expires_at > ?')
    .get(digest(token), Date.now());
  if (!row) return null;
  const user = row.user_id ? publicUser(db.prepare('SELECT id, name, email, role, group_id, version FROM auth_users WHERE id = ?').get(row.user_id)) : null;
  if (row.user_id && !user) return null;
  return { token, csrfToken: String(row.csrf_token), expiresAt: Number(row.expires_at), user };
}

export function createGuestSession() {
  consumeRateLimit('guest-session:total', 600, 15 * 60 * 1000);
  return transaction(db => insertSession(db, null));
}

/** @param {string} actual @param {string} expected */
export function matchesCsrf(actual, expected) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(actual) || !/^[A-Za-z0-9_-]{43}$/.test(expected)) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

/** @param {{email:unknown,password:unknown}} input @param {string} oldToken */
export async function signIn(input, oldToken) {
  const email = normalizeEmail(input.email);
  if (typeof input.password !== 'string' || !input.password.length || input.password.length > 128) {
    throw new AuthError(422, 'INVALID_PASSWORD', 'Укажите пароль длиной до 128 символов.', { password: 'Введите пароль.' });
  }
  const bucket = 'login:email:' + digest(email);
  consumeRateLimit('login:total', 120, 15 * 60 * 1000);
  consumeRateLimit(bucket, 8, 15 * 60 * 1000);
  const db = database();
  const row = db.prepare('SELECT id, password_hash FROM auth_users WHERE email = ?').get(email);
  const valid = await verifyPassword(input.password, row?.password_hash);
  if (!row || !valid) throw new AuthError(401, 'INVALID_CREDENTIALS', 'Неверная почта или пароль.');
  return transaction(connection => {
    connection.prepare('DELETE FROM auth_limits WHERE bucket = ?').run(bucket);
    return insertSession(connection, row.id, oldToken);
  });
}

/** @param {{name:unknown,email:unknown,password:unknown,passwordConfirmation:unknown}} input @param {string} oldToken */
export async function registerStudent(input, oldToken) {
  const email = normalizeEmail(input.email);
  const name = normalizeName(input.name);
  const password = validatePassword(input.password);
  if (password !== input.passwordConfirmation) {
    throw new AuthError(422, 'PASSWORD_MISMATCH', 'Пароли не совпадают.', { passwordConfirmation: 'Повторите тот же пароль.' });
  }
  consumeRateLimit('register:total', 30, 60 * 60 * 1000);
  consumeRateLimit('register:email:' + digest(email), 5, 60 * 60 * 1000);
  const passwordHash = await hashPassword(password);
  return transaction(db => {
    if (db.prepare('SELECT id FROM auth_users WHERE email = ?').get(email)) {
      throw new AuthError(409, 'EMAIL_TAKEN', 'Аккаунт с этой почтой уже существует. Войдите в него.', { email: 'Эта почта уже зарегистрирована.' });
    }
    const id = randomUUID();
    db.prepare('INSERT INTO auth_users(id,email,name,password_hash,role,created_at) VALUES (?,?,?,?,?,?)')
      .run(id, email, name, passwordHash, 'student', Date.now());
    return insertSession(db, id, oldToken);
  });
}

/**
 * Administrative provisioning is available only to a local CLI, never through a public route.
 * Existing passwords and roles are preserved.
 * @param {{name:string,email:string,password:string}} input
 */
export async function provisionAdmin(input) {
  const email = normalizeEmail(input.email);
  const name = normalizeName(input.name);
  const password = validatePassword(input.password);
  const passwordHash = await hashPassword(password);
  return transaction(db => {
    const existing = db.prepare('SELECT id,name,email,role,group_id,version FROM auth_users WHERE email = ?').get(email);
    if (existing) {
      if (existing.role !== 'admin') throw new AuthError(409, 'ACCOUNT_EXISTS', 'Эта почта уже принадлежит обычному аккаунту. Роль и пароль не изменены.');
      return { created: false, user: publicUser(existing) };
    }
    const id = randomUUID();
    db.prepare('INSERT INTO auth_users(id,email,name,password_hash,role,created_at) VALUES (?,?,?,?,?,?)')
      .run(id, email, name, passwordHash, 'admin', Date.now());
    return { created: true, user: publicUser(db.prepare('SELECT id,name,email,role,group_id,version FROM auth_users WHERE id = ?').get(id)) };
  });
}

/** @param {string} token */
export function signOut(token) {
  if (token) database().prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(digest(token));
}

/** @param {import('./api-contract').User} user */
export function bootstrapFor(user) {
  const db = database();
  const current = publicUser(db.prepare('SELECT id,name,email,role,group_id,version FROM auth_users WHERE id = ?').get(user.id));
  if (!current) throw new AuthError(401, 'UNAUTHENTICATED', 'Войдите в аккаунт, чтобы продолжить.');
  const data = {
    users: db.prepare('SELECT id,name,email,role,group_id,version FROM auth_users ORDER BY created_at,id').all().map(publicUser),
    groups: db.prepare('SELECT * FROM school_groups ORDER BY name_key,id').all().map(row => ({
      id: row.id, name: row.name, course: Number(row.course), curatorId: row.curator_id, version: Number(row.version),
    })),
    subjects: db.prepare('SELECT id,name,version FROM school_subjects ORDER BY name_key,id').all(),
    rooms: db.prepare('SELECT id,name,capacity,version FROM school_rooms ORDER BY name_key,id').all(),
    teachingAssignments: db.prepare('SELECT teacher_id AS teacherId,group_id AS groupId,subject_id AS subjectId FROM school_teaching_assignments ORDER BY teacher_id,group_id,subject_id').all(),
    lessons: db.prepare('SELECT * FROM school_lessons ORDER BY starts_at,id').all().map(publicLesson),
    assignments: [], submissions: [], grades: [], attendance: [], materials: [], announcements: [],
  };
  const result = scopeBootstrap(current, data);
  if (current.role !== 'admin') {
    result.users = result.users.map(other => other.id === current.id ? other : { ...other, email: '' });
  }
  return result;
}

/** @param {string} id @param {unknown} nameInput @param {unknown} versionInput */
export function updateOwnProfile(id, nameInput, versionInput) {
  const name = normalizeName(nameInput);
  if (typeof versionInput !== 'number' || !Number.isSafeInteger(versionInput) || versionInput < 1) {
    throw new AuthError(422, 'INVALID_VERSION', 'Обновите страницу и повторите сохранение.');
  }
  const result = database().prepare('UPDATE auth_users SET name = ?, version = version + 1 WHERE id = ? AND version = ?').run(name, id, versionInput);
  if (result.changes !== 1) throw new AuthError(409, 'VERSION_CONFLICT', 'Профиль уже изменился. Обновите страницу и повторите действие.');
}

/**
 * @param {import('./api-contract').User} actor
 * @param {string} kind
 * @param {Record<string,unknown>} input
 * @param {string} id
 */
export async function saveDirectory(actor, kind, input, id = '') {
  const allowed = {
    users: ['name', 'email', 'role', 'groupId', ...(id ? ['version'] : ['password'])],
    groups: ['name', 'course', 'curatorId', ...(id ? ['version'] : [])],
    subjects: ['name', ...(id ? ['version'] : [])],
    rooms: ['name', 'capacity', ...(id ? ['version'] : [])],
    'teaching-assignments': ['teacherId', 'groupId', 'subjectId'],
  };
  if (!Object.hasOwn(allowed, kind) || (kind === 'teaching-assignments' && id)) {
    throw new AuthError(404, 'NOT_FOUND', 'Справочник не найден.');
  }
  requireAdmin(database(), actor);
  checkFields(input, allowed[kind]);
  const passwordHash = kind === 'users' && !id ? await hashPassword(validatePassword(input.password)) : null;
  return transaction(db => {
    requireAdmin(db, actor);
    if (kind === 'teaching-assignments') {
      const teacherId = reference(db, 'auth_users', input.teacherId, 'teacherId', 'преподавателя', 'teacher');
      const groupId = reference(db, 'school_groups', input.groupId, 'groupId', 'группу');
      const subjectId = reference(db, 'school_subjects', input.subjectId, 'subjectId', 'предмет');
      db.prepare('INSERT OR IGNORE INTO school_teaching_assignments(teacher_id,group_id,subject_id) VALUES (?,?,?)')
        .run(teacherId, groupId, subjectId);
      return { ok: true };
    }
    const table = { users: 'auth_users', groups: 'school_groups', subjects: 'school_subjects', rooms: 'school_rooms' }[kind];
    const old = id ? db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) : null;
    if (id) checkVersion(old, input.version);
    const recordId = id || randomUUID();
    if (kind === 'users') {
      const name = normalizeName(input.name);
      const email = normalizeEmail(input.email);
      const role = input.role;
      if (!['student', 'teacher', 'admin'].includes(role)) throw new AuthError(422, 'INVALID_ROLE', 'Выберите роль пользователя.');
      const groupId = optionalReference(db, 'school_groups', input.groupId, 'groupId', 'группу');
      if (role !== 'student' && groupId) throw new AuthError(422, 'INVALID_GROUP', 'Группу можно назначить только студенту.');
      if (db.prepare('SELECT id FROM auth_users WHERE email = ? AND id <> ?').get(email, recordId)) {
        throw new AuthError(409, 'EMAIL_TAKEN', 'Аккаунт с этой почтой уже существует.', { email: 'Эта почта уже зарегистрирована.' });
      }
      if (old?.role === 'admin' && role !== 'admin') {
        if (actor.id === id || Number(db.prepare("SELECT count(*) AS total FROM auth_users WHERE role = 'admin'").get().total) <= 1) {
          throw new AuthError(409, 'ADMIN_REQUIRED', 'Нельзя снять права у своего аккаунта или последнего администратора.');
        }
      }
      if (old?.role === 'teacher' && role !== 'teacher' && (
        db.prepare('SELECT 1 FROM school_groups WHERE curator_id = ? LIMIT 1').get(id) ||
        db.prepare('SELECT 1 FROM school_lessons WHERE teacher_id = ? LIMIT 1').get(id) ||
        db.prepare('SELECT 1 FROM school_teaching_assignments WHERE teacher_id = ? LIMIT 1').get(id)
      )) throw new AuthError(409, 'TEACHER_IN_USE', 'Преподаватель назначен на занятия, предметы или кураторство. Его роль пока нельзя изменить.');
      if (id) {
        db.prepare('UPDATE auth_users SET name=?,email=?,role=?,group_id=?,version=version+1 WHERE id=?')
          .run(name, email, role, groupId, id);
      } else {
        db.prepare('INSERT INTO auth_users(id,name,email,role,group_id,password_hash,created_at) VALUES (?,?,?,?,?,?,?)')
          .run(recordId, name, email, role, groupId, passwordHash, Date.now());
      }
    } else {
      const { name, key } = uniqueName(db, table, input.name, recordId);
      if (kind === 'groups') {
        const course = boundedInteger(input.course, 1, 6, 'Курс');
        const curatorId = optionalReference(db, 'auth_users', input.curatorId, 'curatorId', 'куратора', 'teacher');
        if (id) db.prepare('UPDATE school_groups SET name=?,name_key=?,course=?,curator_id=?,version=version+1 WHERE id=?').run(name, key, course, curatorId, id);
        else db.prepare('INSERT INTO school_groups(id,name,name_key,course,curator_id) VALUES (?,?,?,?,?)').run(recordId, name, key, course, curatorId);
      } else if (kind === 'rooms') {
        const capacity = input.capacity === null || input.capacity === undefined ? null : boundedInteger(input.capacity, 1, 1000, 'Вместимость');
        if (id) db.prepare('UPDATE school_rooms SET name=?,name_key=?,capacity=?,version=version+1 WHERE id=?').run(name, key, capacity, id);
        else db.prepare('INSERT INTO school_rooms(id,name,name_key,capacity) VALUES (?,?,?,?)').run(recordId, name, key, capacity);
      } else {
        if (id) db.prepare('UPDATE school_subjects SET name=?,name_key=?,version=version+1 WHERE id=?').run(name, key, id);
        else db.prepare('INSERT INTO school_subjects(id,name,name_key) VALUES (?,?,?)').run(recordId, name, key);
      }
    }
    return { ok: true };
  });
}

function lessonDate(value, field) {
  const match = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  const invalid = () => { throw new AuthError(422, 'INVALID_DATE', 'Укажите корректные дату и время занятия с часовым поясом.', { [field]: 'Проверьте дату и время.' }); };
  if (!match) return invalid();
  const [, y, m, d, h, minutes, seconds = '0', , zone] = match;
  const year = Number(y), month = Number(m), day = Number(d);
  const days = [31, (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > days[month - 1] || Number(h) > 23 || Number(minutes) > 59 || Number(seconds) > 59) return invalid();
  if (zone !== 'Z' && (Number(zone.slice(1, 3)) > 14 || Number(zone.slice(4)) > 59 || (Number(zone.slice(1, 3)) === 14 && Number(zone.slice(4)) !== 0))) return invalid();
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1000 || date.getUTCFullYear() > 9999) return invalid();
  return date.toISOString();
}

/** @param {import('./api-contract').User} actor @param {Record<string,unknown>} input @param {string} id */
export function saveLesson(actor, input, id = '') {
  checkFields(input, ['subjectId', 'groupId', 'teacherId', 'roomId', 'startsAt', 'endsAt', 'kind', 'note', 'status', ...(id ? ['version'] : [])]);
  return transaction(db => {
    requireAdmin(db, actor);
    const old = id ? db.prepare('SELECT * FROM school_lessons WHERE id = ?').get(id) : null;
    if (id) checkVersion(old, input.version);
    const candidate = old ? { ...publicLesson(old), ...input } : input;
    const subjectId = reference(db, 'school_subjects', candidate.subjectId, 'subjectId', 'предмет');
    const groupId = reference(db, 'school_groups', candidate.groupId, 'groupId', 'группу');
    const teacherId = reference(db, 'auth_users', candidate.teacherId, 'teacherId', 'преподавателя', 'teacher');
    const roomId = reference(db, 'school_rooms', candidate.roomId, 'roomId', 'аудиторию');
    const startsAt = lessonDate(candidate.startsAt, 'startsAt');
    const endsAt = lessonDate(candidate.endsAt, 'endsAt');
    if (endsAt <= startsAt) throw new AuthError(422, 'INVALID_INTERVAL', 'Время окончания должно быть позже начала.');
    const kind = typeof candidate.kind === 'string' ? candidate.kind.trim() : '';
    if (!kind || kind.length > 60) throw new AuthError(422, 'INVALID_KIND', 'Укажите тип занятия длиной от 1 до 60 символов.');
    const note = candidate.note === undefined ? '' : candidate.note;
    if (typeof note !== 'string' || note.length > 1000) throw new AuthError(422, 'INVALID_NOTE', 'Примечание должно содержать не более 1000 символов.');
    const status = candidate.status === undefined ? 'scheduled' : candidate.status;
    if (!['scheduled', 'cancelled'].includes(status)) throw new AuthError(422, 'INVALID_STATUS', 'Некорректный статус занятия.');
    if (status === 'scheduled' && db.prepare(`
      SELECT id FROM school_lessons WHERE id <> ? AND status = 'scheduled'
      AND starts_at < ? AND ends_at > ? AND (group_id = ? OR teacher_id = ? OR room_id = ?) LIMIT 1
    `).get(id, endsAt, startsAt, groupId, teacherId, roomId)) {
      throw new AuthError(409, 'SCHEDULE_CONFLICT', 'Группа, преподаватель или аудитория уже заняты в это время.');
    }
    if (id) {
      db.prepare(`UPDATE school_lessons SET subject_id=?,group_id=?,teacher_id=?,room_id=?,starts_at=?,ends_at=?,kind=?,note=?,status=?,version=version+1 WHERE id=?`)
        .run(subjectId, groupId, teacherId, roomId, startsAt, endsAt, kind, note.trim(), status, id);
    } else {
      db.prepare(`INSERT INTO school_lessons(id,subject_id,group_id,teacher_id,room_id,starts_at,ends_at,kind,note,status) VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(randomUUID(), subjectId, groupId, teacherId, roomId, startsAt, endsAt, kind, note.trim(), status);
    }
    // Saving a lesson also gives the teacher/group its subject assignment.
    db.prepare('INSERT OR IGNORE INTO school_teaching_assignments(teacher_id,group_id,subject_id) VALUES (?,?,?)').run(teacherId, groupId, subjectId);
    return { ok: true };
  });
}
