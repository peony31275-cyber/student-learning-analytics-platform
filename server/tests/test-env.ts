/** Shared between vitest.config.ts (workers) and global-setup.ts (main process). */
import { isLocalDatabaseUrl } from '../scripts/db-url.js';

export const LOCAL_TEST_PG_PORT = 5434;
export const USE_EXTERNAL_DB = Boolean(process.env.TEST_DATABASE_URL);
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  `postgresql://postgres:postgres@localhost:${LOCAL_TEST_PG_PORT}/sla_test`;

// The suite truncates every table, so it must never reach a shared or cloud database.
if (!isLocalDatabaseUrl(TEST_DATABASE_URL)) {
  throw new Error(
    'TEST_DATABASE_URL must point at a local database (localhost): the tests truncate every table.',
  );
}
