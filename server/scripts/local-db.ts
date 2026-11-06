/**
 * `npm run db:local` — runs a local PostgreSQL 18 server for development.
 * Leave it running in its own terminal; Ctrl+C stops it (data is kept in .pgdata/).
 */
import { localUrl, startLocalPostgres } from './embedded-pg.js';

const PORT = Number(process.env.LOCAL_PG_PORT ?? 5433);

const pg = await startLocalPostgres({
  dataDir: '.pgdata',
  port: PORT,
  databases: ['sla_dev'],
  quiet: true,
});

console.log(`\nLocal PostgreSQL is running on port ${PORT}`);
console.log(`DATABASE_URL="${localUrl(PORT, 'sla_dev')}"`);
console.log('Press Ctrl+C to stop.\n');

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  console.log('\nStopping PostgreSQL...');
  await pg.stop();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
