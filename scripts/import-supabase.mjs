import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { closeDatabase, getDatabase } from '../database/connection.mjs';
import {
  ImportError,
  importSqliteSnapshot,
  readSqliteSnapshot,
} from './import-sqlite-to-postgres.mjs';
import { postgresTarget } from './postgres-target.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));

export function supabaseImportUrl(value) {
  let url;
  let target;
  let password;
  try {
    url = new URL(value);
    target = postgresTarget(url);
    password = decodeURIComponent(url.password);
    if (!decodeURIComponent(url.username) || !password) throw new Error();
  } catch {
    throw new ImportError('Укажите PostgreSQL URI Supabase с пользователем и паролем базы.');
  }
  if (['PASTE_DB_PASSWORD_HERE', '[YOUR-PASSWORD]'].includes(password)) {
    throw new ImportError(
      'Замените шаблон пароля в DATABASE_URL файла .env.supabase.local на пароль базы Supabase и закодируйте специальные символы в URI.',
    );
  }
  if (
    !target.identity.startsWith('supabase:') ||
    !['direct', 'session'].includes(target.mode) ||
    url.hash ||
    !url.pathname ||
    url.pathname === '/'
  ) {
    throw new ImportError('Для импорта выберите Supabase direct или session pooler на порту 5432.');
  }
  if ([...url.searchParams.keys()].some((key) => !['sslmode', 'sslrootcert'].includes(key))) {
    throw new ImportError('URI импорта допускает только параметры sslmode и sslrootcert.');
  }
  const sslmode = url.searchParams.get('sslmode');
  if (sslmode !== null && !['require', 'verify-full'].includes(sslmode)) {
    throw new ImportError('Для импорта нужен SSL с проверкой сервера: sslmode=verify-full.');
  }
  const certificate = url.searchParams.get('sslrootcert');
  if (certificate !== null && !isAbsolute(certificate)) {
    throw new ImportError('sslrootcert должен содержать абсолютный путь к сертификату Supabase.');
  }
  // pg currently treats require as verify-full. Make that guarantee explicit for future versions.
  url.searchParams.set('sslmode', 'verify-full');
  return url.toString();
}

export async function readSupabaseImportUrl(filename = resolve(project, '.env.supabase.local')) {
  let settings;
  try {
    settings = parseEnv(await readFile(filename, 'utf8'));
  } catch {
    throw new ImportError(
      'Создайте приватный .env.supabase.local с DATABASE_URL проекта Supabase.',
    );
  }
  return supabaseImportUrl(settings.DATABASE_URL);
}

export function supabaseImportSource(args) {
  if (args.length === 0) return null;
  if (args.length === 2 && args[0] === '--source' && isAbsolute(args[1])) return resolve(args[1]);
  throw new ImportError(
    'Использование: npm run db:supabase:import [-- --source <абсолютный путь к SQLite>]',
  );
}

export async function prepareSupabaseDemoSnapshot(projectDirectory = project) {
  const parent = resolve(projectDirectory, '..', 'studyhub-data');
  const destination = join(parent, 'supabase-demo');
  const filename = join(destination, 'auth.sqlite');
  try {
    if ((await stat(filename)).isFile()) {
      await readSqliteSnapshot(filename);
      return filename;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const temporary = await mkdtemp(join(parent, '.supabase-demo-'));
  try {
    await new Promise((done, fail) => {
      const child = spawn(process.execPath, [resolve(project, 'scripts/seed-demo.mjs')], {
        cwd: project,
        env: {
          ...process.env,
          DATABASE_URL: '',
          STUDYHUB_DEMO_MODE: 'true',
          STUDYHUB_DATA_DIR: temporary,
        },
        stdio: 'ignore',
        windowsHide: true,
      });
      child.once('error', () =>
        fail(new ImportError('Не удалось запустить подготовку учебного снимка.')),
      );
      child.once('close', (code) => {
        if (code === 0) done();
        else fail(new ImportError('Не удалось подготовить отдельный учебный снимок SQLite.'));
      });
    });
    await readSqliteSnapshot(join(temporary, 'auth.sqlite'));
    try {
      await rename(temporary, destination);
    } catch (error) {
      // Another process may have published its complete snapshot while this one was seeding.
      if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(error.code)) throw error;
      if (!(await stat(filename)).isFile())
        throw new ImportError('Каталог учебного снимка не содержит готовую SQLite-базу.');
    }
    await readSqliteSnapshot(filename);
    return filename;
  } finally {
    // Only remove the fresh directory owned by this invocation, never the published snapshot.
    if (
      dirname(resolve(temporary)) !== parent ||
      !basename(temporary).startsWith('.supabase-demo-')
    ) {
      throw new ImportError('Не удалось проверить путь временного снимка.');
    }
    try {
      const owned = await realpath(temporary);
      if (owned !== resolve(await realpath(parent), basename(temporary))) {
        throw new ImportError('Временный снимок находится вне каталога данных.');
      }
      await rm(owned, { recursive: true, force: true });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

async function main() {
  const source = supabaseImportSource(process.argv.slice(2));
  const connectionString = await readSupabaseImportUrl();
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    throw new ImportError('Включите проверку TLS перед импортом базы Supabase.');
  }
  const filename = source ?? (await prepareSupabaseDemoSnapshot());
  const snapshot = await readSqliteSnapshot(filename);
  process.env.DATABASE_URL = connectionString;
  const result = await importSqliteSnapshot(await getDatabase(), snapshot, { supabase: true });
  console.log(
    result.imported
      ? 'Перенос в Supabase завершён.'
      : 'Этот снимок уже перенесён; проверка содержимого завершена.',
  );
  console.log(JSON.stringify({ ...result, snapshotHash: snapshot.manifest.snapshotHash }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    console.error(
      error instanceof ImportError
        ? error.message
        : 'Импорт Supabase не завершён. Проверьте приватные настройки подключения и доступность базы.',
    );
    process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
}
