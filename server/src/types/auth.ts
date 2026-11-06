import type { Role } from '../generated/prisma/enums.js';

/** The authenticated principal attached to every protected request. */
export interface AuthUser {
  id: string;
  role: Role;
  schoolId: string;
  email: string;
  firstName: string;
  lastName: string;
  /** Present when role === TEACHER. */
  teacherId: string | null;
  /** Present when role === STUDENT and the account is linked to a profile. */
  studentId: string | null;
}

export interface JwtPayload {
  sub: string;
  role: Role;
  /** Must match User.tokenVersion, otherwise the token was revoked. */
  tv: number;
}
