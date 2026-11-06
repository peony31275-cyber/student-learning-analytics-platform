import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Prisma CLI configuration (migrate, studio, seed).
 *
 * The CLI needs a *direct* (non-pooled) connection because migrations take
 * advisory locks and run DDL inside transactions, which PgBouncer in
 * transaction mode (Neon's pooled endpoint) does not support. The running
 * application uses DATABASE_URL (pooled) through the driver adapter instead.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? '',
  },
});
