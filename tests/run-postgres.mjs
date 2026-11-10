import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { TestClient } from './http-client.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const nextBin = join(root, 'node_modules', 'next', 'dist', 'bin', 'next');
const markerKey = 'qa_api_suite_started';
let server;
let serverOutput = '';
let credentials = '';
let closeDatabase;

function safeMessage(value) {
  return String(value)
    .replaceAll(credentials || '\0', '[database URL]')
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[database URL]');
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  const stopped = once(server, 'exit');
  server.kill();
  const finished = await Promise.race([stopped.then(() => true), delay(5000).then(() => false)]);
  if (!finished) {
    server.kill('SIGKILL');
    await stopped;
  }
  server = null;
}

async function main() {
  const args = process.argv.slice(2);
  const envFile = args.length === 1 ? '.env.qa' : args[2];
  if (
    args[0] !== '--qa' ||
    ![1, 3].includes(args.length) ||
    (args.length === 3 && args[1] !== '--env') ||
    !/^\.env(?:\.[\w-]+)*$/.test(envFile)
  ) {
    throw new Error(
      'Opt-in only: node tests/run-postgres.mjs --qa [--env .env.journal-qa] (requires an isolated database).',
    );
  }
  const qa = parseEnv(await readFile(join(root, envFile), 'utf8'));
  const production = parseEnv(
    await readFile(join(root, '.env.local'), 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return '';
      throw error;
    }),
  );
  const qaUrl = new URL(qa.DATABASE_URL);
  const productionHost = production.DATABASE_URL
    ? new URL(production.DATABASE_URL).hostname
    : qa.PRODUCTION_DATABASE_HOST;
  assert.ok(productionHost, 'Provide .env.local or PRODUCTION_DATABASE_HOST in the QA env file.');
  const productionUrl = new URL(`postgresql://${productionHost}`);
  const endpoint = (url) => url.hostname.replace('-pooler.', '.').toLowerCase();
  assert.ok(['postgres:', 'postgresql:'].includes(qaUrl.protocol), 'QA requires PostgreSQL.');
  assert.notEqual(
    endpoint(qaUrl),
    endpoint(productionUrl),
    'QA and production endpoints must differ.',
  );
  credentials = qa.DATABASE_URL;
  const origin = new URL(qa.TEST_BASE_URL || 'http://127.0.0.1:3101');
  assert.equal(origin.protocol, 'http:');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname));
  assert.equal(origin.pathname, '/');
  assert.equal(origin.search, '');
  assert.equal(origin.hash, '');
  const baseUrl = origin.origin;
  const hostname = origin.hostname.replace(/^\[|\]$/g, '');
  const port = Number(origin.port);
  assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535);
  await access(join(root, '.next', 'BUILD_ID')).catch(() => {
    throw new Error('Run npm run build before the PostgreSQL test suite.');
  });
  const socket = createServer();
  await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.listen(port, hostname, resolve);
  });
  await new Promise((resolve) => socket.close(resolve));

  const environment = {
    ...process.env,
    DATABASE_URL: qa.DATABASE_URL,
    STUDYHUB_DATA_DIR: '',
    STUDYHUB_DEMO_MODE: 'true',
    STUDYHUB_ORIGIN: baseUrl,
    TEST_BASE_URL: baseUrl,
    STUDYHUB_TEST_POSTGRES: 'true',
    STUDYHUB_TEST_PG_HOST: qaUrl.hostname,
    NEXT_TELEMETRY_DISABLED: '1',
  };
  process.env.DATABASE_URL = environment.DATABASE_URL;
  process.env.STUDYHUB_DEMO_MODE = 'true';
  const connection = await import('../database/connection.mjs');
  closeDatabase = connection.closeDatabase;
  const db = await connection.getDatabase();
  assert.equal(db.dialect, 'postgres');
  await connection.runTransaction(async (tx) => {
    assert.equal(
      await tx.prepare('SELECT value FROM studyhub_settings WHERE key=?').get(markerKey),
      undefined,
      'This QA branch was already tested. Reset/recreate it from the original before another run.',
    );
    assert.ok(
      await tx.prepare("SELECT id FROM auth_users WHERE id='demo-admin' AND role='admin'").get(),
      'QA branch must contain the imported StudyHUB dataset.',
    );
    await tx
      .prepare('INSERT INTO studyhub_settings(key,value) VALUES (?,?)')
      .run(markerKey, new Date().toISOString());
  });

  async function runTests(filename) {
    const child = spawn(process.execPath, ['--test', '--test-reporter=spec', filename], {
      cwd: root,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', (chunk) => process.stdout.write(safeMessage(chunk)));
    }
    const [code] = await once(child, 'exit');
    if (code !== 0) throw new Error(`PostgreSQL test failed: ${filename} (exit ${code}).`);
  }

  async function startServer(demoMode = 'true') {
    serverOutput = '';
    server = spawn(
      process.execPath,
      [nextBin, 'start', '--hostname', hostname, '--port', String(port)],
      {
        cwd: root,
        env: { ...environment, STUDYHUB_DEMO_MODE: demoMode },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    for (const stream of [server.stdout, server.stderr]) {
      stream.on('data', (chunk) => {
        serverOutput = (serverOutput + safeMessage(chunk)).slice(-16000);
      });
    }
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      if (server.exitCode !== null) throw new Error(`QA server exited: ${server.exitCode}.`);
      try {
        const response = await fetch(`${baseUrl}/api/session`, {
          signal: AbortSignal.timeout(5000),
        });
        if (response.ok) return;
      } catch {
        /* Wait for the local listener or the Neon compute to wake up. */
      }
      await delay(300);
    }
    throw new Error('QA server did not become ready within 90 seconds.');
  }

  await runTests('tests/postgres.test.mjs');
  await startServer();
  await runTests('tests/api.test.mjs');
  await runTests('tests/academic-api.test.mjs');
  const client = new TestClient(baseUrl);
  const session = await client.demo('admin');
  const before = await client.bootstrap();
  await stopServer();
  await startServer();
  assert.equal((await client.session()).user.id, session.user.id);
  assert.deepEqual(await client.bootstrap(), before);
  console.log('PASS: PostgreSQL records and the session survive a server restart.');
  await stopServer();
  await startServer('false');
  const guest = new TestClient(baseUrl);
  assert.equal((await guest.session()).demoEnabled, false);
  await guest.call('/api/auth/demo', { method: 'POST', body: { role: 'admin' } }, [403, 404]);
  console.log('PASS: role switching is unavailable when disabled.');
  console.log('QA branch retained with test data. Reset/recreate it before another run.');
}

try {
  await main();
} catch (error) {
  console.error(safeMessage(error instanceof Error ? error.message : error));
  if (serverOutput) console.error(serverOutput);
  console.error('QA data retained for diagnosis; production configuration was not changed.');
  process.exitCode = 1;
} finally {
  await stopServer();
  if (closeDatabase) await closeDatabase();
}
