import { closeDatabase } from '../database/connection.mjs';
import {
  parseAcademicTarget,
  prepareAcademicDatabase,
  reportAcademicError,
} from './academic-database.mjs';

try {
  const result = await prepareAcademicDatabase(parseAcademicTarget(process.argv.slice(2)));
  console.log(JSON.stringify(result));
} catch (error) {
  reportAcademicError(error);
} finally {
  await closeDatabase();
}
