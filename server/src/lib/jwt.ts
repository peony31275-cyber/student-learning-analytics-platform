import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { Role } from '../generated/prisma/enums.js';
import type { JwtPayload } from '../types/auth.js';

const ALGORITHM = 'HS256';

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    algorithm: ALGORITHM,
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

/** Returns the payload, or null for any invalid, expired or tampered token. */
export function verifyToken(token: string): JwtPayload | null {
  try {
    // Pinning the algorithm prevents "alg: none" and algorithm-confusion attacks.
    const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: [ALGORITHM] });
    if (
      typeof decoded === 'object' &&
      typeof decoded.sub === 'string' &&
      typeof decoded.tv === 'number' &&
      (Object.values(Role) as string[]).includes(decoded.role)
    ) {
      return { sub: decoded.sub, role: decoded.role as Role, tv: decoded.tv };
    }
    return null;
  } catch {
    return null;
  }
}
