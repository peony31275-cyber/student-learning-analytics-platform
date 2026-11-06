import type { Response } from 'express';
import type { Paginated } from './pagination.js';

/**
 * Uniform response envelope:
 *   success: { data, meta? }
 *   error:   { error: { code, message, details? } }   (see middleware/error-handler.ts)
 */
export function ok<T>(res: Response, data: T, status = 200) {
  return res.status(status).json({ data });
}

export function created<T>(res: Response, data: T) {
  return ok(res, data, 201);
}

export function paginated<T>(res: Response, page: Paginated<T>) {
  return res.status(200).json({ data: page.items, meta: page.meta });
}

export function noContent(res: Response) {
  return res.status(204).end();
}
