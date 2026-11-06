/** Shared between vitest.config.ts (workers) and global-setup.ts (main process). */
export const LOCAL_TEST_PG_PORT = 5434;
export const USE_EXTERNAL_DB = Boolean(process.env.TEST_DATABASE_URL);
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  `postgresql://postgres:postgres@localhost:${LOCAL_TEST_PG_PORT}/sla_test`;
