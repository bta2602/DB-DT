import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { isDemoEnabled, seedDemoDataset } from '../lib/studyhub/auth-store.mjs';
import { createDemoData } from '../database/seeds/demo-data.mjs';
import { CAMPUS_SEED_ID, createCampusData } from '../database/seeds/campus-data.mjs';
import { prepareCampusUpgrade, readSeedContext } from '../database/upgrade-campus.mjs';

try {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--more') || args.length > 1)
    throw new Error('Использование: npm run demo:seed [-- --more]');
  const enabled = isDemoEnabled();
  const directory = resolve(process.env.STUDYHUB_DATA_DIR || '.studyhub');
  const publicRelative = relative(resolve('public'), directory);
  if (!(
    publicRelative === '..' ||
    publicRelative.startsWith(`..${sep}`) ||
    isAbsolute(publicRelative)
  ))
    throw new Error('Каталог данных должен находиться вне public.');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const filename = resolve(directory, 'auth.sqlite');
  let exists = false;
  try {
    exists = (await stat(filename)).isFile();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (exists) {
    const backupDirectory = resolve(directory, 'backups');
    await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
    const backupPath = resolve(backupDirectory, `before-campus-${randomUUID()}.sqlite`);
    const source = new DatabaseSync(filename, { readOnly: true });
    try {
      await backup(source, backupPath);
    } finally {
      source.close();
    }
    await chmod(backupPath, 0o600);
    console.log(`Резервная копия базы: ${backupPath}`);
  }

  async function seed(snapshot, label) {
    const seedId = snapshot.seedId || 'studyhub-fictional-demo-v1';
    if (exists) {
      const reader = new DatabaseSync(filename, { readOnly: true });
      try {
        if (
          reader
            .prepare(
              "SELECT name FROM sqlite_master WHERE type='table' AND name='school_demo_seeds'",
            )
            .get() &&
          reader.prepare('SELECT 1 FROM school_demo_seeds WHERE id=?').get(seedId)
        )
          return;
      } finally {
        reader.close();
      }
    }
    const accounts = snapshot.data.users
      .filter((user) => user.role !== 'admin' || enabled)
      .map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        password: randomBytes(18).toString('base64url'),
      }));
    const credentials = resolve(directory, `account-access-${randomUUID()}.json`);
    await writeFile(
      credentials,
      JSON.stringify(
        {
          notice: 'Учебные аккаунты. Пароли приватные; не добавляйте файл в Git.',
          createdAt: new Date().toISOString(),
          package: label,
          accounts,
        },
        null,
        2,
      ) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
    console.log(`Подготовка: ${label}, аккаунтов: ${accounts.length}.`);
    try {
      const result = await seedDemoDataset(
        snapshot,
        Object.fromEntries(accounts.map((account) => [account.id, account.password])),
      );
      exists = true;
      if (!result.created) await unlink(credentials);
      else console.log(`Новые записи сохранены. Данные для входа: ${credentials}`);
    } catch (error) {
      await unlink(credentials);
      throw error;
    }
  }

  await seed(createDemoData(), 'Основные учебные записи');
  const connection = new DatabaseSync(filename);
  let snapshot = null;
  try {
    connection.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    if (!connection.prepare('SELECT 1 FROM school_demo_seeds WHERE id=?').get(CAMPUS_SEED_ID)) {
      prepareCampusUpgrade(connection);
      snapshot = createCampusData(new Date(), readSeedContext(connection));
    }
  } finally {
    connection.close();
  }
  if (snapshot) await seed(snapshot, 'Учебные группы и расписание на четыре недели');

  const reader = new DatabaseSync(filename, { readOnly: true });
  const users = new Map(
    reader
      .prepare('SELECT id,name,email,role FROM auth_users')
      .all()
      .map((user) => [user.id, user]),
  );
  const counts = {
    students: reader.prepare("SELECT count(*) AS count FROM auth_users WHERE role='student'").get()
      .count,
    teachers: reader.prepare("SELECT count(*) AS count FROM auth_users WHERE role='teacher'").get()
      .count,
    groups: reader.prepare('SELECT count(*) AS count FROM school_groups').get().count,
    lessons: reader.prepare('SELECT count(*) AS count FROM school_lessons').get().count,
  };
  reader.close();
  // При очистке старых email обновляем только подписи доступа, сохраняя прежние пароли.
  for (const name of await readdir(directory)) {
    if (!/^(?:demo|account)-access-.*\.json$/.test(name)) continue;
    const path = resolve(directory, name);
    const source = await readFile(path, 'utf8');
    const value = JSON.parse(source);
    const update = (account) =>
      account && users.has(account.id) ? { ...account, ...users.get(account.id) } : account;
    value.accounts = (value.accounts || []).map(update);
    for (const key of ['admin', 'teacher', 'student'])
      if (value[key]) value[key] = update(value[key]);
    const next = JSON.stringify(value, null, 2) + '\n';
    if (next !== source) await writeFile(path, next, { mode: 0o600 });
  }
  console.log(
    snapshot
      ? 'Учебная база расширена. Пользовательские записи и пароли сохранены.'
      : 'Учебный набор уже установлен. Записи оставлены без изменений.',
  );
  console.log(JSON.stringify(counts));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Не удалось подготовить учебные данные.');
  process.exitCode = 1;
}
