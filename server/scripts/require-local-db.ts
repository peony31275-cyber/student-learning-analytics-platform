/**
 * Guard in front of the destructive database scripts (db:migrate, db:seed, db:reset).
 * They reset or wipe data, so they only run against a database on this machine: a cloud
 * connection string in the environment (for example Neon pasted into server/.env) stops
 * them before anything happens. Neon has its own explicit scripts: db:neon:status and
 * db:neon:deploy (see docs/DEPLOYMENT.md).
 */
import { isLocalDatabaseUrl } from './db-url.js';

const remote = (['DATABASE_URL', 'DIRECT_URL'] as const).filter((key) => {
  const value = process.env[key];
  return Boolean(value) && !isLocalDatabaseUrl(value!);
});

if (remote.length > 0) {
  console.error(
    `Refusing to run: ${remote.join(' and ')} ${remote.length > 1 ? 'point' : 'points'} at a non-local database.\n` +
      'This script resets or wipes data, so it only runs against localhost.\n' +
      'For Neon use npm run db:neon:status / db:neon:deploy (docs/DEPLOYMENT.md).',
  );
  process.exit(1);
}
