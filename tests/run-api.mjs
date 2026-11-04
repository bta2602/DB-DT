import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdtemp, realpath, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { TestClient } from './http-client.mjs';

// Tests always get a new database; presentation data and .env.local are untouched.
const root = fileURLToPath(new URL('../', import.meta.url));
const nextBin = join(root, 'node_modules', 'next', 'dist', 'bin', 'next');
const directory = await mkdtemp(join(tmpdir(), 'studyhub-api-tests-'));
const socket = createServer();
socket.listen(0, '127.0.0.1');
await once(socket, 'listening');
const port = socket.address().port;
await new Promise((resolve) => socket.close(resolve));
const baseUrl = `http://127.0.0.1:${port}`;
const environment = {
  ...process.env,
  // Keep tests on their temporary SQLite database, even when .env.local configures Postgres.
  DATABASE_URL: '',
  STUDYHUB_DATA_DIR: directory,
  STUDYHUB_DEMO_MODE: 'true',
  STUDYHUB_ORIGIN: baseUrl,
  TEST_BASE_URL: baseUrl,
  NEXT_TELEMETRY_DISABLED: '1',
};
let server;
let serverOutput = '';
let passed = false;

async function run(args, extraEnvironment = {}) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: { ...environment, ...extraEnvironment },
    stdio: 'inherit',
    windowsHide: true,
  });
  const [code] = await once(child, 'exit');
  if (code !== 0) throw new Error(`Test command failed: ${args[0]} (exit ${code})`);
}

async function startServer(demoMode = 'true') {
  serverOutput = '';
  server = spawn(
    process.execPath,
    [nextBin, 'start', '--hostname', '127.0.0.1', '--port', String(port)],
    {
      cwd: root,
      env: { ...environment, STUDYHUB_DEMO_MODE: demoMode },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  for (const stream of [server.stdout, server.stderr]) {
    stream.on('data', (chunk) => {
      serverOutput = (serverOutput + chunk).slice(-12000);
    });
  }
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Test server exited: ${server.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/api/session`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return;
    } catch {
      /* The listening socket may not be ready yet. */
    }
    await delay(300);
  }
  throw new Error('Test server did not become ready within 60 seconds.');
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

try {
  await access(join(root, '.next', 'BUILD_ID')).catch(() => {
    throw new Error('Run npm run build before npm test.');
  });
  await run(
    [
      '--test',
      '--test-reporter=spec',
      'tests/deadlines.test.mjs',
      'tests/grading.test.mjs',
      'tests/i18n.test.mjs',
      'tests/storage.test.mjs',
    ],
    {
      STUDYHUB_TEST_STORAGE_DIR: join(directory, 'ordinary-database'),
    },
  );
  await run(['--test', '--test-reporter=spec', 'tests/seed-upgrade.test.mjs'], {
    STUDYHUB_TEST_SEED_DIR: directory,
  });
  await startServer();
  await run(['--test', '--test-reporter=spec', 'tests/api.test.mjs']);

  // Keep the cookie and expected records in memory, then restart the real process.
  const client = new TestClient(baseUrl);
  const session = await client.demo('admin');
  const before = await client.bootstrap();
  await stopServer();
  await run(['scripts/seed-demo.mjs']);
  await startServer();
  assert.equal((await client.session()).user.id, session.user.id);
  assert.deepEqual(await client.bootstrap(), before);
  console.log(
    'PASS: all data and the server session survive restart; repeated seed preserves changes.',
  );

  await stopServer();
  await startServer('false');
  const normal = new TestClient(baseUrl);
  assert.equal((await normal.session()).demoEnabled, false);
  await normal.call('/api/auth/demo', { method: 'POST', body: { role: 'admin' } }, [403, 404]);
  console.log('PASS: role switching is unavailable when demo mode is disabled.');
  passed = true;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  if (serverOutput) console.error(serverOutput);
  console.error(`Test database retained for diagnosis: ${directory}`);
  process.exitCode = 1;
} finally {
  await stopServer();
  if (passed) {
    const ownedDirectory = await realpath(directory);
    const temporaryRoot = await realpath(tmpdir());
    if (
      dirname(ownedDirectory) !== temporaryRoot ||
      !basename(ownedDirectory).startsWith('studyhub-api-tests-')
    ) {
      throw new Error('Unexpected temporary directory; cleanup refused.');
    }
    await rm(ownedDirectory, { recursive: true, force: true });
  }
}
