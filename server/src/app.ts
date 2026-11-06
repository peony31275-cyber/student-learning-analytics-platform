import path from 'node:path';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env, isProduction, isTest } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import type { CredentialRateLimit } from './middleware/rate-limit.js';
import { createAuthRouter } from './routes/auth.routes.js';
import { apiRouter } from './routes/index.js';

export interface AppOptions {
  /** Rate limit for the credential endpoints; null turns it off (default in tests). */
  authRateLimit?: CredentialRateLimit | null;
}

/**
 * Builds the Express application without binding a port, so integration tests
 * (Supertest) can exercise the full middleware stack in-process.
 */
export function createApp({
  authRateLimit = isTest
    ? null
    : { limit: env.AUTH_RATE_LIMIT_MAX, windowMs: env.AUTH_RATE_LIMIT_WINDOW_MINUTES * 60_000 },
}: AppOptions = {}) {
  const app = express();

  // Behind Render/Heroku-style proxies: trust the first hop so req.ip (used by
  // the rate limiter) and secure cookies work correctly.
  if (isProduction) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGINS,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  if (!isTest)
    app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }));

  app.get('/api/health', async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ data: { status: 'ok', time: new Date().toISOString() } });
  });

  // Coarse abuse protection for the whole API (credential routes have a stricter limiter).
  app.use(
    '/api/v1',
    rateLimit({
      windowMs: 60_000,
      limit: 600,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      skip: () => isTest,
      message: { error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down' } },
    }),
  );
  app.use('/api/v1/auth', createAuthRouter(authRateLimit));
  app.use('/api/v1', apiRouter);
  app.use('/api', notFoundHandler);

  // Optional single-origin deployment: serve the built React app from Express.
  if (env.WEB_DIST_DIR) {
    const dist = path.resolve(env.WEB_DIST_DIR);
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get('/{*splat}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
