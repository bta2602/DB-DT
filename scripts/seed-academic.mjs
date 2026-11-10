import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { closeDatabase, getDatabase } from '../database/connection.mjs';
import { seedAcademicData } from '../database/seeds/academic-data.mjs';
import {
  parseAcademicTarget,
  prepareAcademicDatabase,
  reportAcademicError,
} from './academic-database.mjs';

let credentialsFile;
try {
  const target = parseAcademicTarget(process.argv.slice(2));
  await prepareAcademicDatabase(target);
  const directory = target.directory || resolve(homedir(), '.studyhub-academic-test-credentials');
  const result = await seedAcademicData(await getDatabase(), {
    academicYear: 2026,
    async onCredentials(accounts) {
      if (!accounts.length) return;
      await mkdir(directory, { recursive: true, mode: 0o700 });
      credentialsFile = resolve(directory, `academic-access-${randomUUID()}.json`);
      await writeFile(
        credentialsFile,
        JSON.stringify(
          {
            notice: 'Вымышленные учебные аккаунты. Приватные пароли; не добавляйте в Git.',
            accounts,
          },
          null,
          2,
        ) + '\n',
        { flag: 'wx', mode: 0o600 },
      );
    },
  });
  console.log(
    JSON.stringify({ created: result.created, counts: result.counts, warnings: result.warnings }),
  );
  if (credentialsFile) console.log(`Пароли только новых аккаунтов: ${credentialsFile}`);
} catch (error) {
  if (credentialsFile) await unlink(credentialsFile).catch(() => {});
  reportAcademicError(error);
} finally {
  await closeDatabase();
}
