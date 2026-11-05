import { pathToFileURL } from 'node:url';
import { Client } from 'pg';
import { migratePostgresGrading } from '../database/migrations/grading-100.mjs';

export async function main(args = process.argv.slice(2)) {
  const expectedHost = args[1];
  if (args.length !== 3 || args[0] !== '--host' || args[2] !== '--apply') {
    throw new Error(
      'Команда: node --env-file=<файл QA> scripts/migrate-grading.mjs --host <проверенный хост> --apply',
    );
  }
  const connectionString =
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.DIRECT_DATABASE_URL ||
    process.env.DATABASE_URL;
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('Нужен прямой адрес PostgreSQL в DATABASE_URL_UNPOOLED.');
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.hostname !== expectedHost ||
    url.hostname.includes('-pooler.')
  ) {
    throw new Error(
      'Хост не совпадает с --host или указан pooled URL. Используйте проверенное прямое подключение.',
    );
  }
  const client = new Client({ connectionString, connectionTimeoutMillis: 15000 });
  try {
    await client.connect();
    const result = await migratePostgresGrading(client);
    console.log(
      result.migrated
        ? 'Шкала 0–100 и отметки журнала перенесены.'
        : 'Шкала 0–100 уже установлена. Записи не изменены.',
    );
    return result;
  } catch (error) {
    const message = String(error.message)
      .replaceAll(connectionString, '[database URL]')
      .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[database URL]');
    throw new Error(message);
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
