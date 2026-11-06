import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(`API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  logger.info(
    `Sign-in rate limit: ${env.AUTH_RATE_LIMIT_MAX} failed attempts per IP per ${env.AUTH_RATE_LIMIT_WINDOW_MINUTES} min`,
  );
  logger.info(
    env.INVITE_DELIVERY === 'dev-link'
      ? 'Activation invites: dev-link (development only: links are shown to the staff member who creates them)'
      : 'Activation invites: disabled (no secure delivery channel configured)',
  );
});

/** Graceful shutdown: stop accepting connections, finish in-flight requests, close the pool. */
function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
