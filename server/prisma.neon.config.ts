import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';
import { defineConfig } from 'prisma/config';

/**
 * Prisma CLI configuration for the Neon (cloud) database, used only when asked for explicitly:
 *
 *   npm run db:neon:status -w server   # prisma migrate status --config prisma.neon.config.ts
 *   npm run db:neon:deploy -w server   # prisma migrate deploy --config prisma.neon.config.ts
 *
 * The connection string is read from server/.env.neon (git-ignored), never from server/.env
 * or the shell, so the default configuration (prisma.config.ts) stays local. It must be the
 * direct, non-pooled endpoint: migrations take advisory locks (see prisma.config.ts).
 * There is deliberately no seed command here.
 */
function neonDirectUrl(): string {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '.env.neon');
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    throw new Error(
      'server/.env.neon not found. Put the Neon connection strings there (docs/DEPLOYMENT.md).',
    );
  }
  const url = parse(text).DIRECT_URL ?? '';
  const host = URL.canParse(url) ? new URL(url).hostname : '';
  if (!host.endsWith('.neon.tech') || host.includes('-pooler')) {
    throw new Error(
      'DIRECT_URL in server/.env.neon must be the Neon direct (non-pooled) connection string.',
    );
  }
  return url;
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: neonDirectUrl() },
});
