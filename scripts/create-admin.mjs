import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { normalizeEmail, normalizeName, provisionAdmin } from '../lib/studyhub/auth-store.mjs';

const [email, ...nameParts] = process.argv.slice(2);
if (!email || !nameParts.length) {
  console.error('Использование: npm run admin:create -- email@example.com "Имя администратора"');
  process.exitCode = 1;
} else {
  try {
    const normalizedEmail = normalizeEmail(email);
    const name = normalizeName(nameParts.join(' '));
    const directory = resolve(process.env.STUDYHUB_DATA_DIR || '.studyhub');
    const publicRelative = relative(resolve('public'), directory);
    const outsidePublic = publicRelative === '..' || publicRelative.startsWith(`..${sep}`) || isAbsolute(publicRelative);
    if (!outsidePublic) {
      throw new Error('Каталог данных должен находиться вне public.');
    }
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const password = randomBytes(24).toString('base64url');
    const credentialsPath = resolve(directory, `admin-access-${randomUUID()}.txt`);
    // Persist the only copy of the generated password before creating the account.
    await writeFile(credentialsPath, [
      'StudyHUB — данные для входа администратора',
      '',
      `Имя: ${name}`,
      `Почта: ${normalizedEmail}`,
      `Пароль: ${password}`,
      '',
      'Локальный адрес: http://127.0.0.1:3000/',
      'Этот файл содержит пароль. Храните его у себя и не добавляйте в Git.',
      '',
    ].join('\n'), { flag: 'wx', mode: 0o600 });
    const result = await provisionAdmin({ name, email: normalizedEmail, password });
    if (result.created) {
      console.log(`Администратор создан: ${result.user.email}`);
      console.log(`Данные для входа: ${credentialsPath}`);
    } else {
      await unlink(credentialsPath);
      console.log(`Администратор уже существует: ${result.user.email}. Пароль сохранён без изменений.`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Не удалось создать администратора.');
    process.exitCode = 1;
  }
}
