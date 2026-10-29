import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { seedDemoDataset } from '../lib/studyhub/auth-store.mjs';
import { createDemoData } from '../lib/studyhub/demo-data.mjs';
import { createMoreDemoData } from '../lib/studyhub/demo-more-data.mjs';

function extensionContext(filename) {
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='school_demo_seeds'").get() ||
        !db.prepare("SELECT id FROM school_demo_seeds WHERE id='studyhub-fictional-demo-v1'").get()) {
      throw new Error('Сначала добавьте основной набор командой npm run demo:seed.');
    }
    return {
      users: db.prepare('SELECT id,name,email,role,group_id AS groupId,version FROM auth_users').all(),
      groups: db.prepare('SELECT id,name,course,curator_id AS curatorId,version FROM school_groups').all(),
      subjects: db.prepare('SELECT id,name,version FROM school_subjects').all(),
      rooms: db.prepare('SELECT id,name,capacity,version FROM school_rooms').all(),
      teachingAssignments: db.prepare('SELECT teacher_id AS teacherId,group_id AS groupId,subject_id AS subjectId FROM school_teaching_assignments').all(),
      lessons: db.prepare(`SELECT id,group_id AS groupId,subject_id AS subjectId,teacher_id AS teacherId,room_id AS roomId,
        starts_at AS startsAt,ends_at AS endsAt,status FROM school_lessons`).all(),
    };
  } finally { db.close(); }
}

try {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--more') || args.length > 1) throw new Error('Использование: npm run demo:seed [-- --more]');
  const more = args.includes('--more');
  const directory = resolve(process.env.STUDYHUB_DATA_DIR || '.studyhub');
  const publicRelative = relative(resolve('public'), directory);
  if (!(publicRelative === '..' || publicRelative.startsWith(`..${sep}`) || isAbsolute(publicRelative))) {
    throw new Error('Каталог данных должен находиться вне public.');
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const databasePath = resolve(directory, 'auth.sqlite');
  if (more) {
    try { await stat(databasePath); }
    catch (error) {
      if (error.code === 'ENOENT') throw new Error('Сначала добавьте основной набор командой npm run demo:seed.');
      throw error;
    }
  }
  const existing = more ? extensionContext(databasePath) : null;
  const snapshot = more ? createMoreDemoData(new Date(), existing) : createDemoData();
  const accounts = snapshot.data.users.filter(user => user.role !== 'admin').map(user => ({
    id: user.id, name: user.name, email: user.email, role: user.role,
    password: randomBytes(18).toString('base64url'),
  }));
  const passwords = Object.fromEntries(accounts.map(account => [account.id, account.password]));
  const credentialsPath = resolve(directory, `demo-access-${more ? 'more-' : ''}${randomUUID()}.json`);
  // Save credentials before inserting accounts so a write failure cannot lose passwords.
  await writeFile(credentialsPath, JSON.stringify({
    notice: 'Вымышленные аккаунты для показа проекта. Этот файл содержит пароли; не добавляйте его в Git.',
    url: 'http://127.0.0.1:3000/',
    createdAt: new Date().toISOString(),
    package: more ? 'Расширенные примеры; пароли прежних аккаунтов не изменены.' : 'Первый набор примеров',
    teacher: accounts.find(account => account.id === snapshot.profiles.teacherId) || accounts.find(account => account.role === 'teacher'),
    student: accounts.find(account => account.id === snapshot.profiles.studentId) || accounts.find(account => account.role === 'student'),
    accounts,
  }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });

  let exists = false;
  try { exists = (await stat(databasePath)).isFile(); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (exists) {
    const backupDirectory = resolve(directory, 'backups');
    await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
    const backupPath = resolve(backupDirectory, `before-demo-${randomUUID()}.sqlite`);
    const source = new DatabaseSync(databasePath, { readOnly: true });
    try { await backup(source, backupPath); }
    finally { source.close(); }
    await chmod(backupPath, 0o600);
    console.log(`Резервная копия базы: ${backupPath}`);
  }

  const result = await seedDemoDataset(snapshot, passwords);
  if (result.created) {
    console.log('Демонстрационные данные добавлены. Существующие записи сохранены.');
    console.log(JSON.stringify(result.counts));
    console.log(`Данные для входа преподавателя и студентов: ${credentialsPath}`);
  } else {
    await unlink(credentialsPath);
    console.log('Примеры уже загружены. Оценки, расписание и пароли оставлены без изменений.');
    for (const file of await readdir(directory)) {
      if (/^demo-access-.*\.json$/.test(file)) console.log(`Сохранённые данные для входа: ${resolve(directory, file)}`);
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Не удалось добавить демонстрационные данные.');
  process.exitCode = 1;
}
