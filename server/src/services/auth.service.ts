import { signToken } from '../lib/jwt.js';
import { burnPasswordCheck, hashPassword, verifyPassword } from '../lib/password.js';
import { prisma } from '../lib/prisma.js';
import type { AuthUser } from '../types/auth.js';
import { AppError, badRequest, conflict, unauthorized } from '../utils/errors.js';
import type {
  ChangePasswordInput,
  LoginInput,
  RegisterInput,
} from '../validators/auth.validators.js';

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

export async function registerStudent(input: RegisterInput) {
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  if (existing) throw conflict('An account with this email already exists');

  const profile = await prisma.studentProfile.findFirst({
    where: {
      studentNumber: input.studentNumber,
      email: { equals: input.email, mode: 'insensitive' },
    },
    select: { id: true, schoolId: true, userId: true },
  });
  if (!profile) {
    throw badRequest(
      'No student record matches this student number and email. Contact your school.',
    );
  }
  if (profile.userId) throw conflict('This student record already has an account');

  const passwordHash = await hashPassword(input.password);

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email: input.email,
        passwordHash,
        role: 'STUDENT',
        firstName: input.firstName,
        lastName: input.lastName,
        schoolId: profile.schoolId,
      },
      select: { id: true },
    });
    // Conditional update: if a concurrent registration linked the profile
    // first, count is 0 and the whole transaction (incl. the user) rolls back.
    const linked = await tx.studentProfile.updateMany({
      where: { id: profile.id, userId: null },
      data: { userId: created.id },
    });
    if (linked.count !== 1) throw conflict('This student record already has an account');
    return tx.user.findUniqueOrThrow({ where: { id: created.id }, select: sessionSelect });
  });

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
  // Bumping tokenVersion revokes every other session; the caller gets a fresh token.
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(input.newPassword), tokenVersion: { increment: 1 } },
    select: sessionSelect,
  });
  return issueSession(updated);
}

/** Revokes all existing tokens for the user ("log out everywhere"). */
export async function revokeAllSessions(userId: string) {
  await prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
}
