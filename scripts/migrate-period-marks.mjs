import { pathToFileURL } from 'node:url';
import { Client } from 'pg';
import { migratePostgresPeriodMarks } from '../database/migrations/period-marks.mjs';
import { assertMaintenanceTarget } from './postgres-target.mjs';

export async function main(args = process.argv.slice(2), env = process.env) {
  const [hostFlag, host, applyFlag] = args;
  if (args.length !== 3 || hostFlag !== '--host' || applyFlag !== '--apply')
    throw new Error(
      'Команда: node --env-file=<приватный файл> scripts/migrate-period-marks.mjs --host <прямой хост> --apply',
    );
  const connectionString = env.DATABASE_URL_UNPOOLED || env.DIRECT_DATABASE_URL;
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('Укажите DATABASE_URL_UNPOOLED или DIRECT_DATABASE_URL.');
  }
  assertMaintenanceTarget(url, host);
  const client = new Client({ connectionString, connectionTimeoutMillis: 15000 });
  try {
    await client.connect();
    const result = await migratePostgresPeriodMarks(client);
    console.log(JSON.stringify(result));
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
