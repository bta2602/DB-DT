import { NextRequest, NextResponse } from 'next/server';
import {
  AuthError, bootstrapFor, createGuestSession, matchesCsrf, readSession,
  registerStudent, signIn, signOut, updateOwnProfile,
} from './auth-store.mjs';

const COOKIE = 'studyhub_session';
const BODY_LIMIT = 16 * 1024;
type StoredSession = NonNullable<ReturnType<typeof readSession>>;

function expectedOrigin(request: NextRequest) {
  const configured = process.env.STUDYHUB_ORIGIN;
  const incoming = new URL(request.url);
  // NextRequest can normalize 127.0.0.1 to localhost. Preserve the browser's
  // actual authority from Host; forwarded headers are intentionally ignored.
  const host = request.headers.get('host');
  if (!configured && (!host || !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?$/i.test(host))) {
    throw new AuthError(503, 'ORIGIN_NOT_CONFIGURED', 'Для этого адреса требуется настройка HTTPS и STUDYHUB_ORIGIN на сервере.');
  }
  let origin: URL;
  try {
    origin = new URL(configured || `${incoming.protocol}//${host}`);
  } catch {
    throw new AuthError(503, 'ORIGIN_NOT_CONFIGURED', 'Некорректный адрес сервера. Проверьте STUDYHUB_ORIGIN.');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
  if ((!configured && !local) || (origin.protocol !== 'https:' && !local) || !['http:', 'https:'].includes(origin.protocol)) {
    throw new AuthError(503, 'ORIGIN_NOT_CONFIGURED', 'Для этого адреса требуется настройка HTTPS и STUDYHUB_ORIGIN на сервере.');
  }
  return origin.origin;
}

function json(value: unknown, status = 200) {
  const response = NextResponse.json(value, { status });
  response.headers.set('Cache-Control', 'no-store, max-age=0');
  response.headers.set('Vary', 'Cookie');
  return response;
}

function writeCookie(response: NextResponse, request: NextRequest, token: string, expiresAt: number) {
  response.cookies.set(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: expectedOrigin(request).startsWith('https:'),
    path: '/', expires: new Date(expiresAt),
  });
  return response;
}

async function execute(request: NextRequest, action: () => NextResponse | Promise<NextResponse>) {
  try {
    expectedOrigin(request);
    return await action();
  } catch (error) {
    if (error instanceof AuthError) {
      const response = json({ error: { code: error.code, message: error.message, fields: error.fields } }, error.status);
      if (error.retryAfter) response.headers.set('Retry-After', String(error.retryAfter));
      return response;
    }
    console.error('[StudyHUB auth] Request failed:', error instanceof Error ? error.name : 'UnknownError');
    return json({ error: { code: 'INTERNAL_ERROR', message: 'Не удалось выполнить запрос. Повторите попытку позже.' } }, 500);
  }
}

function currentSession(request: NextRequest, requireUser = false): StoredSession {
  const session = readSession(request.cookies.get(COOKIE)?.value || '');
  if (!session || (requireUser && !session.user)) throw new AuthError(401, 'UNAUTHENTICATED', 'Войдите в аккаунт, чтобы продолжить.');
  return session;
}

function mutationSession(request: NextRequest, requireUser = false) {
  if (request.headers.get('origin') !== expectedOrigin(request) || request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new AuthError(403, 'INVALID_ORIGIN', 'Запрос отклонён. Откройте StudyHUB в этом браузере и повторите действие.');
  }
  const session = currentSession(request, requireUser);
  if (!matchesCsrf(request.headers.get('x-csrf-token') || '', session.csrfToken)) {
    throw new AuthError(403, 'INVALID_CSRF', 'Сессия формы устарела. Обновите страницу и повторите действие.');
  }
  return session;
}

async function body(request: NextRequest, allowedFields: string[]): Promise<Record<string, unknown>> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new AuthError(415, 'JSON_REQUIRED', 'Ожидается запрос в формате JSON.');
  }
  if (Number(request.headers.get('content-length') || 0) > BODY_LIMIT) throw new AuthError(413, 'BODY_TOO_LARGE', 'Слишком большой запрос.');
  const reader = request.body?.getReader();
  if (!reader) throw new AuthError(422, 'INVALID_BODY', 'Заполните поля формы.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      length += result.value.byteLength;
      if (length > BODY_LIMIT) {
        await reader.cancel();
        throw new AuthError(413, 'BODY_TOO_LARGE', 'Слишком большой запрос.');
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch {
    throw new AuthError(422, 'INVALID_JSON', 'Не удалось прочитать поля формы.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowedFields.includes(key))) {
    throw new AuthError(422, 'INVALID_BODY', 'В запросе есть неподдерживаемые поля.');
  }
  return value as Record<string, unknown>;
}

export function getSession(request: NextRequest) {
  return execute(request, () => {
    const existing = readSession(request.cookies.get(COOKIE)?.value || '');
    const session = existing || createGuestSession();
    const response = json({ user: session.user, csrfToken: session.csrfToken });
    return existing ? response : writeCookie(response, request, session.token, session.expiresAt);
  });
}

export function login(request: NextRequest) {
  return execute(request, async () => {
    const previous = mutationSession(request);
    const input = await body(request, ['email', 'password']);
    const session = await signIn({ email: input.email, password: input.password }, previous.token);
    return writeCookie(json({ ok: true, csrfToken: session.csrfToken }), request, session.token, session.expiresAt);
  });
}

export function register(request: NextRequest) {
  return execute(request, async () => {
    const previous = mutationSession(request);
    if (previous.user) throw new AuthError(409, 'ALREADY_SIGNED_IN', 'Сначала выйдите из текущего аккаунта.');
    const input = await body(request, ['name', 'email', 'password', 'passwordConfirmation']);
    const session = await registerStudent({ name: input.name, email: input.email, password: input.password, passwordConfirmation: input.passwordConfirmation }, previous.token);
    return writeCookie(json({ ok: true, csrfToken: session.csrfToken }), request, session.token, session.expiresAt);
  });
}

export function logout(request: NextRequest) {
  return execute(request, async () => {
    const session = mutationSession(request);
    await body(request, []);
    signOut(session.token);
    return writeCookie(json({ ok: true }), request, '', 0);
  });
}

export function bootstrap(request: NextRequest) {
  return execute(request, () => {
    const session = currentSession(request, true);
    return json(bootstrapFor(session.user!));
  });
}

export function updateProfile(request: NextRequest) {
  return execute(request, async () => {
    const session = mutationSession(request, true);
    const input = await body(request, ['name', 'version']);
    updateOwnProfile(session.user!.id, input.name, input.version);
    return json({ ok: true });
  });
}
