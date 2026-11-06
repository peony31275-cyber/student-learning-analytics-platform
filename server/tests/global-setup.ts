import { execSync } from 'node:child_process';
import type EmbeddedPostgres from 'embedded-postgres';
import { startLocalPostgres } from '../scripts/embedded-pg.js';
import { LOCAL_TEST_PG_PORT, TEST_DATABASE_URL, USE_EXTERNAL_DB } from './test-env.js';

let pg: EmbeddedPostgres | undefined;

/**
 * Runs once in the main process before all test files:
 *  1. starts a throwaway PostgreSQL (unless TEST_DATABASE_URL points at one, e.g. in CI)
 *  2. applies all Prisma migrations, the same migrations production runs.
 *
 * Note: vitest's `test.env` only reaches the workers, so the URL is passed explicitly here.
 */
export async function setup() {
  if (!USE_EXTERNAL_DB) {
    pg = await startLocalPostgres({
      dataDir: '.pgdata-test',
      port: LOCAL_TEST_PG_PORT,
      databases: ['sla_test'],
      quiet: true,
    });
  }
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL, DIRECT_URL: TEST_DATABASE_URL },
    stdio: 'pipe',
  });
}

export async function teardown() {
  await pg?.stop();
}
