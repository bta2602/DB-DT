import assert from 'node:assert/strict';

// A small browser-like cookie jar for tests. Tokens never appear in test output.
export class TestClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookie = '';
    this.csrf = '';
  }

  async call(path, options = {}, expectedStatus = 200) {
    const method = options.method || 'GET';
    const multipart = options.body instanceof FormData;
    const headers = { Accept: 'application/json', Cookie: this.cookie };
    if (method !== 'GET') {
      headers.Origin = this.baseUrl;
      headers['X-CSRF-Token'] = this.csrf;
    }
    if (options.body !== undefined && !multipart) {
      headers['Content-Type'] = 'application/json';
    }
    Object.assign(headers, options.headers);
    const response = await fetch(this.baseUrl + path, {
      method,
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(60000),
      body:
        options.body === undefined
          ? undefined
          : multipart
            ? options.body
            : JSON.stringify(options.body),
    });
    for (const value of response.headers.getSetCookie()) {
      if (value.startsWith('studyhub_session=')) this.cookie = value.split(';')[0];
    }
    const isJson = response.headers.get('content-type')?.includes('application/json');
    const data = isJson ? await response.json() : await response.text();
    const statuses = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
    assert.ok(
      statuses.includes(response.status),
      `${method} ${path}: expected ${statuses.join('/')}, got ${response.status}${data?.error ? ` (${data.error.code}: ${data.error.message})` : ''}`,
    );
    if (typeof data?.csrfToken === 'string') this.csrf = data.csrfToken;
    return { response, data };
  }

  async session() {
    return (await this.call('/api/session')).data;
  }

  async bootstrap() {
    return (await this.call('/api/bootstrap')).data;
  }

  async demo(role) {
    if (!this.csrf) await this.session();
    await this.call('/api/auth/demo', { method: 'POST', body: { role } });
    return this.session();
  }

  async login(email, password) {
    await this.session();
    await this.call('/api/auth/login', { method: 'POST', body: { email, password } });
    return this.session();
  }
}

export function upload(name, contents, fields = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  form.set('file', new File([contents], name, { type: 'text/plain' }));
  return form;
}
