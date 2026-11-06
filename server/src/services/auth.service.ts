import { signToken } from '../lib/jwt.js';
import { burnPasswordCheck, hashPassword, verifyPassword } from '../lib/password.js';
import { prisma } from '../lib/prisma.js';
import type { AuthUser } from '../types/auth.js';
import { AppError, unauthorized } from '../utils/errors.js';
import type { ChangePasswordInput, LoginInput } from '../validators/auth.validators.js';

const INVALID_CREDENTIALS = 'Invalid email or password';

/** Public shape of the logged-in user (never includes passwordHash). */
export function toSessionUser(u: AuthUser) {
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    firstName: u.firstName,
    lastName: u.lastName,
    schoolId: u.schoolId,
    teacherId: u.teacherId,
    studentId: u.studentId,
    mustChangePassword: u.mustChangePassword,
  };
}
export type SessionUser = ReturnType<typeof toSessionUser>;

const sessionSelect = {
  id: true,
  email: true,
  role: true,
  firstName: true,
  lastName: true,
  schoolId: true,
  tokenVersion: true,
  mustChangePassword: true,
  teacherProfile: { select: { id: true } },
  studentProfile: { select: { id: true } },
} as const;

type SessionRow = {
  id: string;
  email: string;
  role: AuthUser['role'];
  firstName: string;
  lastName: string;
  schoolId: string;
  tokenVersion: number;
  mustChangePassword: boolean;
  teacherProfile: { id: string } | null;
  studentProfile: { id: string } | null;
};

function issueSession(u: SessionRow) {
  const user = toSessionUser({
    ...u,
    teacherId: u.teacherProfile?.id ?? null,
    studentId: u.studentProfile?.id ?? null,
  });
  const token = signToken({ sub: u.id, role: u.role, tv: u.tokenVersion });
  return { user, token };
}

export async function login({ email, password }: LoginInput) {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { ...sessionSelect, passwordHash: true, isActive: true },
  });

  if (!user) {
    await burnPasswordCheck(password);
    throw unauthorized(INVALID_CREDENTIALS);
  }
  const valid = await verifyPassword(password, user.passwordHash);
  // Same message for wrong password and disabled account: no account-state oracle.
  if (!valid || !user.isActive) throw unauthorized(INVALID_CREDENTIALS);

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return issueSession(user);
}

export async function changePassword(userId: string, input: ChangePasswordInput) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { passwordHash: true },
  });
  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw new AppError(400, 'INVALID_PASSWORD', 'Current password is incorrect');
  }
  // Bumping tokenVersion ends every session, this one included: the user signs
  // in again with the new password. This also completes a forced first-login
  // change (mustChangePassword).
  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash: await hashPassword(input.newPassword),
      mustChangePassword: false,
      tokenVersion: { increment: 1 },
    },
  });
}

/** Revokes all existing tokens for the user ("log out everywhere"). */
export async function revokeAllSessions(userId: string) {
  await prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
}
