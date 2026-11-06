import path from 'node:path';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env, isProduction, isTest } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { apiRouter } from './routes/index.js';

/**
 * Builds the Express application without binding a port, so integration tests
 * (Supertest) can exercise the full middleware stack in-process.
 */
export function createApp() {
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
