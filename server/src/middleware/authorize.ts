import type { NextFunction, Request, Response } from 'express';
import type { Role } from '../generated/prisma/enums.js';
import type { AuthUser } from '../types/auth.js';
import { forbidden, unauthorized } from '../utils/errors.js';

/**
 * Coarse-grained RBAC: which roles may call a route at all.
 * Fine-grained, row-level checks (may this teacher see THIS student?) live in
 * services/access.service.ts, because they depend on data, not just on role.
 */
export const requireRole =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw unauthorized();
    if (!roles.includes(req.user.role)) throw forbidden();
    next();
  };

/** Narrowing helper for controllers that run behind `authenticate`. */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
