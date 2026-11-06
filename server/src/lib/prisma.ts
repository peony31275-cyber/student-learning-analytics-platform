import { PrismaPg } from '@prisma/adapter-pg';
import { env, isProduction } from '../config/env.js';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * Single PrismaClient per process. Each client owns a connection pool, so
 * creating one per request would exhaust database connections.
 */
function createClient() {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
  return new PrismaClient({
    adapter,
    log: isProduction ? ['error'] : ['warn', 'error'],
  });
}

type Client = ReturnType<typeof createClient>;
const globalForPrisma = globalThis as unknown as { prisma?: Client };

// Reuse across hot reloads in development (tsx watch re-evaluates modules).
export const prisma: Client = globalForPrisma.prisma ?? createClient();
if (!isProduction) globalForPrisma.prisma = prisma;

/** Client or interactive-transaction client — lets services compose inside transactions. */
export type Db = Omit<Client, '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'>;
