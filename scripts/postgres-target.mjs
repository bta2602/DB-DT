/** Resolve a database project without returning credentials in diagnostics. */
export function postgresTarget(connection) {
  let url;
  try {
    url = new URL(connection);
  } catch {
    throw new Error('Укажите корректный PostgreSQL URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname)
    throw new Error('Укажите корректный PostgreSQL URL.');
  const queryKeys = [...url.searchParams.keys()];
  if (new Set(queryKeys).size !== queryKeys.length)
    throw new Error('PostgreSQL URL не должен содержать повторяющиеся параметры.');
  // node-postgres gives these query parameters priority over the URL authority.
  if (['host', 'port', 'user'].some((key) => url.searchParams.has(key)))
    throw new Error('PostgreSQL URL не должен переопределять host, port или user через параметры.');
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  const port = url.port || '5432';
  const direct = /^db\.([a-z0-9]+)\.supabase\.co$/.exec(hostname);
  const shared = /(^|\.)pooler\.supabase\.com$/.test(hostname);
  if (direct || shared) {
    let project = direct?.[1];
    if (shared) {
      let username;
      try {
        username = decodeURIComponent(url.username);
      } catch {
        throw new Error('Некорректное имя пользователя Supabase.');
      }
      project = /^.+\.([a-z0-9]+)$/.exec(username)?.[1];
      if (!project)
        throw new Error(
          'Для Supabase pooler нужен пользователь с project ref, например postgres.<project-ref>.',
        );
    }
    if (!['5432', '6543'].includes(port))
      throw new Error('Выберите стандартный direct, session или transaction URL Supabase.');
    return {
      hostname,
      identity: `supabase:${project}`,
      mode: port === '6543' ? 'transaction' : shared ? 'session' : 'direct',
      verificationHost: `db.${project}.supabase.co`,
    };
  }
  return {
    hostname,
    identity: hostname.replace('-pooler.', '.'),
    mode: hostname.includes('-pooler') ? 'pooled' : 'direct',
    verificationHost: hostname,
  };
}

export function assertMaintenanceTarget(connection, expectedHost) {
  const target = postgresTarget(connection);
  if (!['direct', 'session'].includes(target.mode))
    throw new Error('Нужен прямой PostgreSQL URL или Supabase session pooler на порту 5432.');
  if (
    typeof expectedHost !== 'string' ||
    expectedHost.toLowerCase().replace(/\.$/, '') !== target.verificationHost
  )
    throw new Error(
      'Нужен PostgreSQL URL с project-хостом, совпадающим с --host. Для Supabase укажите db.<project-ref>.supabase.co.',
    );
  return target;
}

export function assertDifferentPostgresTargets(qaConnection, productionConnection) {
  const qa = postgresTarget(qaConnection);
  const production = postgresTarget(productionConnection);
  if (qa.identity === production.identity)
    throw new Error('QA and production endpoints must differ.');
  return qa;
}
