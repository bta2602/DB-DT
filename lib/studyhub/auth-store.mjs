import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCRYPT = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const AUTH_LIFETIME = 30 * 24 * 60 * 60 * 1000;
const GUEST_LIFETIME = 60 * 60 * 1000;
const databaseKey = Symbol.for('studyhub.auth.databases');
const workKey = Symbol.for('studyhub.auth.passwordWork');

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
  if (databases.has(filename)) return databases.get(filename);

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
  databases.set(filename, db);
  return db;
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

/** @returns {import('./api-contract').User|null} */
function publicUser(row) {
  if (!row) return null;
  return {
    id: String(row.id), name: String(row.name), email: String(row.email),
    role: row.role, groupId: null, version: Number(row.version),
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
  const user = userId ? publicUser(db.prepare('SELECT id, name, email, role, version FROM auth_users WHERE id = ?').get(userId)) : null;
  return { token, csrfToken, expiresAt, user };
}

/** @param {string} token */
export function readSession(token) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const db = database();
  const row = db.prepare('SELECT user_id, csrf_token, expires_at FROM auth_sessions WHERE token_hash = ? AND expires_at > ?')
    .get(digest(token), Date.now());
  if (!row) return null;
  const user = row.user_id ? publicUser(db.prepare('SELECT id, name, email, role, version FROM auth_users WHERE id = ?').get(row.user_id)) : null;
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
    const existing = db.prepare('SELECT id,name,email,role,version FROM auth_users WHERE email = ?').get(email);
    if (existing) {
      if (existing.role !== 'admin') throw new AuthError(409, 'ACCOUNT_EXISTS', 'Эта почта уже принадлежит обычному аккаунту. Роль и пароль не изменены.');
      return { created: false, user: publicUser(existing) };
    }
    const id = randomUUID();
    db.prepare('INSERT INTO auth_users(id,email,name,password_hash,role,created_at) VALUES (?,?,?,?,?,?)')
      .run(id, email, name, passwordHash, 'admin', Date.now());
    return { created: true, user: publicUser(db.prepare('SELECT id,name,email,role,version FROM auth_users WHERE id = ?').get(id)) };
  });
}

/** @param {string} token */
export function signOut(token) {
  if (token) database().prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(digest(token));
}

/** @param {import('./api-contract').User} user */
export function bootstrapFor(user) {
  const users = user.role === 'admin'
    ? database().prepare('SELECT id,name,email,role,version FROM auth_users ORDER BY created_at,id').all().map(publicUser)
    : [user];
  return {
    users, groups: [], subjects: [], rooms: [], teachingAssignments: [], lessons: [],
    assignments: [], submissions: [], grades: [], attendance: [], materials: [], announcements: [],
  };
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
