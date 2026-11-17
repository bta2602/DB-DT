import { pathToFileURL } from 'node:url';
import { Client } from 'pg';
import { migratePostgresLessonArchive } from '../database/migrations/lesson-archive.mjs';

export function parseArchiveTarget(args, env = process.env) {
  if (args.length !== 3 || args[0] !== '--host' || args[2] !== '--apply') {
    throw new Error(
      'Команда: node --env-file=<приватный файл> scripts/migrate-lesson-archive.mjs --host <прямой хост базы> --apply',
    );
  }
  const connectionString = env.DATABASE_URL_UNPOOLED || env.DIRECT_DATABASE_URL;
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('Укажите прямое подключение в DATABASE_URL_UNPOOLED или DIRECT_DATABASE_URL.');
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.hostname !== args[1] ||
    url.hostname.includes('-pooler')
  ) {
    throw new Error('Нужен прямой PostgreSQL URL с хостом, совпадающим с --host.');
  }
  return { connectionString };
}

export async function main(args = process.argv.slice(2)) {
  const { connectionString } = parseArchiveTarget(args);
  const client = new Client({ connectionString, connectionTimeoutMillis: 15000 });
  try {
    await client.connect();
    const result = await migratePostgresLessonArchive(client);
    console.log(
      result.migrated
        ? 'Архив занятий подготовлен. Занятия, оценки, задания, работы и файлы сохранены.'
        : 'Миграция архива уже применена. Учебные данные не изменены.',
    );
    return result;
  } catch (error) {
    throw new Error(
      String(error.message)
        .replaceAll(connectionString, '[database URL]')
        .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[database URL]'),
    );
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
