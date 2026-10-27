export class ApiError extends Error {
  constructor(message, status = 0, fields = {}) { super(message); this.status = status; this.fields = fields; }
}

/** Same-origin API; server owns authentication, permissions and persistent data. */
export function createApi(fetcher = (...args) => fetch(...args)) {
  let csrfToken = '';
  async function request(path, { method = 'GET', body, signal } = {}) {
    if (!path.startsWith('/api/')) throw new ApiError('Некорректный адрес запроса.');
    const headers = { Accept: 'application/json' };
    const multipart = typeof FormData !== 'undefined' && body instanceof FormData;
    if (body !== undefined && !multipart) headers['Content-Type'] = 'application/json';
    if (method !== 'GET') headers['X-CSRF-Token'] = csrfToken;
    let response;
    try {
      response = await fetcher(path, { method, headers, credentials: 'same-origin', cache: 'no-store',
        body: body === undefined ? undefined : multipart ? body : JSON.stringify(body),
        signal: signal || AbortSignal.timeout(20000) });
    } catch (error) {
      throw new ApiError(error.name === 'TimeoutError' ? 'Сервер не ответил вовремя. Повторите попытку.' : 'Не удалось связаться с сервером. Проверьте соединение.');
    }
    const json = response.headers.get('content-type')?.includes('application/json');
    let data = {};
    if (response.status !== 204 && json) {
      try { data = await response.json(); } catch { throw new ApiError('Сервис вернул некорректный ответ. Попробуйте позже.', response.status); }
    }
    if (!response.ok) {
      const fallback = response.status === 401 ? 'Войдите в аккаунт, чтобы продолжить.' : response.status === 403 ? 'У вас нет доступа к этому действию.' : response.status === 409 ? 'Данные уже изменились. Обновите страницу и повторите действие.' : response.status === 404 ? 'Сервис пока недоступен. Попробуйте позже.' : 'Не удалось сохранить изменения. Повторите попытку.';
      throw new ApiError(data.error?.message || fallback, response.status, data.error?.fields);
    }
    if (response.status !== 204 && !json) throw new ApiError('Сервис вернул некорректный ответ. Попробуйте позже.');
    if (typeof data.csrfToken === 'string') csrfToken = data.csrfToken;
    return data;
  }
  async function file(id) {
    let response;
    try { response = await fetcher(`/api/files/${encodeURIComponent(id)}`, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(30000) }); }
    catch { throw new ApiError('Не удалось загрузить файл.'); }
    if (!response.ok) throw new ApiError('Файл недоступен или у вас нет доступа.', response.status);
    return response.blob();
  }
  return { request, file, clear: () => { csrfToken = ''; } };
}
