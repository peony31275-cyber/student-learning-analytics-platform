import type { NextFunction, Request, Response } from 'express';
import { verifyToken } from '../lib/jwt.js';
import { prisma } from '../lib/prisma.js';
import { unauthorized } from '../utils/errors.js';

export const AUTH_COOKIE = 'sla_token';

function extractToken(req: Request): string | null {
  const cookieToken: unknown = req.cookies?.[AUTH_COOKIE];
  if (typeof cookieToken === 'string' && cookieToken) return cookieToken;
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return null;
}

/**
 * Verifies the JWT and re-loads the user from the database.
 *
 * The DB lookup (a primary-key read) is a deliberate trade-off against purely
 * stateless JWTs: deactivated users, role changes and revoked tokens
 * (tokenVersion bump) take effect immediately instead of when the token expires.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) throw unauthorized();

  const payload = verifyToken(token);
  if (!payload) throw unauthorized('Invalid or expired token');

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: {
      id: true,
      role: true,
      schoolId: true,
      email: true,
      firstName: true,
      lastName: true,
      isActive: true,
      tokenVersion: true,
      mustChangePassword: true,
      teacherProfile: { select: { id: true } },
      studentProfile: { select: { id: true } },
    },
  });
  if (!user || !user.isActive || user.tokenVersion !== payload.tv) {
    throw unauthorized('Session is no longer valid');
  }

  req.user = {
    id: user.id,
    role: user.role,
    schoolId: user.schoolId,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    teacherId: user.teacherProfile?.id ?? null,
    studentId: user.studentProfile?.id ?? null,
    mustChangePassword: user.mustChangePassword,
  };
  next();
}
