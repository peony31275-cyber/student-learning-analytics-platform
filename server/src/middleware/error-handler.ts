import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '../generated/prisma/client.js';
import { logger } from '../lib/logger.js';
import { AppError } from '../utils/errors.js';

interface ErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

function send(res: Response, status: number, error: ErrorBody) {
  res.status(status).json({ error });
}

/**
 * Central error translation. Express 5 forwards rejected promises from async
 * handlers here automatically, so controllers and services simply throw.
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return send(res, err.statusCode, {
      code: err.code,
      message: err.message,
      details: err.details,
    });
  }

  if (err instanceof ZodError) {
    return send(res, 400, {
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // Unique constraint: usually a concurrent request that slipped past a service-level check.
    if (err.code === 'P2002') {
      return send(res, 409, {
        code: 'CONFLICT',
        message: 'A record with these values already exists',
      });
    }
    if (err.code === 'P2025') {
      return send(res, 404, { code: 'NOT_FOUND', message: 'Resource not found' });
    }
    if (err.code === 'P2003') {
      return send(res, 409, {
        code: 'CONFLICT',
        message: 'Operation violates a data relationship',
      });
    }
  }

  // Malformed JSON body rejected by express.json().
  if (err instanceof SyntaxError && 'body' in err) {
    return send(res, 400, { code: 'BAD_REQUEST', message: 'Malformed JSON body' });
  }

  logger.error({ err, method: req.method, url: req.originalUrl }, 'Unhandled error');
  return send(res, 500, { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
}

export function notFoundHandler(req: Request, res: Response) {
  send(res, 404, { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` });
}
