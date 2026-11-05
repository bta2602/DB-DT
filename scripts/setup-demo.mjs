import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = resolve(project, '.env.local');
const dataDirectory = resolve(project, '..', 'studyhub-data', 'demo');

// Настройки и сама база находятся отдельно от исходников в Git.
if (existsSync(envFile)) {
  const settings = readFileSync(envFile, 'utf8');
  if (!/^STUDYHUB_DEMO_MODE\s*=\s*["']?true["']?\s*$/m.test(settings)) {
    console.error('В .env.local уже настроен другой режим. Файл оставлен без изменений.');
    console.error(
      'Для учебного доступа укажите отдельный STUDYHUB_DATA_DIR и STUDYHUB_DEMO_MODE=true.',
    );
    process.exit(1);
  }
} else {
  mkdirSync(dataDirectory, { recursive: true });
  writeFileSync(
    envFile,
    `# Локальные настройки учебной базы. Не добавляйте этот файл в Git.\nSTUDYHUB_DATA_DIR="${dataDirectory.replaceAll('\\', '/')}"\nSTUDYHUB_DEMO_MODE=true\n`,
    { flag: 'wx' },
  );
}

const seed = spawnSync(process.execPath, ['--env-file=.env.local', 'scripts/seed-demo.mjs'], {
  cwd: project,
  stdio: 'inherit',
});
if (seed.error || seed.status !== 0) {
  console.error(seed.error?.message || 'Не удалось подготовить учебную базу.');
  process.exit(seed.status || 1);
}
console.log('\nУчебная база готова. Запустите npm run dev и откройте http://localhost:3000.');
console.log('На странице входа можно выбрать студента, преподавателя или администратора.');
