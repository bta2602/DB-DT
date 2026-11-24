import { pathToFileURL } from 'node:url';
import { Client } from 'pg';
import { migratePostgresEveningSlots } from '../database/migrations/evening-slots.mjs';
import { assertMaintenanceTarget } from './postgres-target.mjs';

export async function main(args = process.argv.slice(2)) {
  if (args.length !== 3 || args[0] !== '--host' || args[2] !== '--apply')
    throw new Error(
      'Use --host <verified direct PostgreSQL hostname> --apply. Test on a separate branch first.',
    );
  const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DIRECT_DATABASE_URL;
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('Set DATABASE_URL_UNPOOLED to a direct PostgreSQL connection.');
  }
  assertMaintenanceTarget(url, args[1]);
  const client = new Client({ connectionString, connectionTimeoutMillis: 15000 });
  try {
    await client.connect();
    const result = await migratePostgresEveningSlots(client);
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
