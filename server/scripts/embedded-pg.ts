import { existsSync } from 'node:fs';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

/**
 * Starts a real PostgreSQL server from npm-distributed binaries so the project
 * can be developed and tested without Docker or a system-wide install.
 * Production uses Neon; both are plain PostgreSQL, so schema and SQL are identical.
 */
export interface LocalPgOptions {
  dataDir: string;
  port: number;
  databases: string[];
  quiet?: boolean;
}

export const LOCAL_PG_USER = 'postgres';
export const LOCAL_PG_PASSWORD = 'postgres';

export async function startLocalPostgres(opts: LocalPgOptions): Promise<EmbeddedPostgres> {
  const databaseDir = path.resolve(opts.dataDir);
  const pg = new EmbeddedPostgres({
    databaseDir,
    port: opts.port,
    user: LOCAL_PG_USER,
    password: LOCAL_PG_PASSWORD,
    persistent: true,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: opts.quiet ? () => {} : (m) => process.stdout.write(`[pg] ${m}`),
    onError: (e) => console.error('[pg]', e),
  });

  // initialise() runs initdb and fails if the cluster already exists.
  if (!existsSync(path.join(databaseDir, 'PG_VERSION'))) {
    await pg.initialise();
  }
  await pg.start();

  const client = pg.getPgClient();
  await client.connect();
  try {
    for (const db of opts.databases) {
      const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [db]);
      if (!rowCount) await client.query(`CREATE DATABASE "${db}"`);
    }
  } finally {
    await client.end();
  }
  return pg;
}

export function localUrl(port: number, db: string): string {
  return `postgresql://${LOCAL_PG_USER}:${LOCAL_PG_PASSWORD}@localhost:${port}/${db}`;
}
