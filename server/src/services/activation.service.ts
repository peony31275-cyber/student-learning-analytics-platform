/**
 * Student account activation through one-time invites.
 *
 * Staff create an invite for a student profile that has no login yet. The
 * invite is a random 256-bit token; only its SHA-256 hash is stored, it expires
 * after 24 hours, it can be used once, and creating a new invite revokes the
 * earlier ones. The student opens the link, picks a password, and the account
 * is created and linked to the profile in a single transaction.
 */
import { env } from '../config/env.js';
import { hashPassword } from '../lib/password.js';
import { type Db, prisma } from '../lib/prisma.js';
import { TOKEN_PATTERN, generateToken, hashToken } from '../lib/tokens.js';
import type { AuthUser } from '../types/auth.js';
import { AppError } from '../utils/errors.js';
import type { ActivateInput } from '../validators/auth.validators.js';
import { assertStudentAccess } from './access.service.js';

export const ACTIVATION_TTL_HOURS = 24;

const tokenError = {
  invalid: () =>
    new AppError(400, 'ACTIVATION_TOKEN_INVALID', 'This activation link is not valid.'),
  expired: () => new AppError(410, 'ACTIVATION_TOKEN_EXPIRED', 'This activation link has expired.'),
  used: () =>
    new AppError(410, 'ACTIVATION_TOKEN_USED', 'This activation link has already been used.'),
  revoked: () =>
    new AppError(
      410,
      'ACTIVATION_TOKEN_REVOKED',
      'This activation link was replaced by a newer one.',
    ),
};

const studentSelect = {
  id: true,
  schoolId: true,
  firstName: true,
  lastName: true,
  email: true,
  status: true,
  userId: true,
  user: { select: { isActive: true } },
} as const;

type ActivationStudent = {
  status: string;
  userId: string | null;
  email: string | null;
  user: { isActive: boolean } | null;
};

/** Rules shared by issuing an invite and using it. */
function assertCanActivate(s: ActivationStudent) {
  if (s.userId) {
    // Activation never re-enables a disabled account; only an admin can.
    throw new AppError(
      409,
      'ACCOUNT_EXISTS',
      s.user?.isActive === false
        ? 'This student’s account is disabled. Activation cannot re-enable it; contact an administrator.'
        : 'This student already has an account.',
    );
  }
  if (s.status !== 'ACTIVE') {
    throw new AppError(409, 'STUDENT_INACTIVE', 'This student record is not active.');
  }
  if (!s.email) {
    throw new AppError(400, 'EMAIL_REQUIRED', 'Add a school email to this student first.');
  }
}

type TokenState = { usedAt: Date | null; revokedAt: Date | null; expiresAt: Date } | null;

function assertTokenUsable(t: TokenState, now = new Date()) {
  if (!t) throw tokenError.invalid();
  if (t.usedAt) throw tokenError.used();
  if (t.revokedAt) throw tokenError.revoked();
  if (t.expiresAt <= now) throw tokenError.expired();
}

/**
 * Locks the student's profile row for the rest of the transaction. Everything
 * that changes a student's login or invites takes this lock first, then touches
 * activation_tokens, so concurrent requests for one student queue up instead of
 * deadlocking (the same lock order everywhere).
 */
async function lockStudent(tx: Db, studentId: string) {
  await tx.$queryRaw`SELECT id FROM student_profiles WHERE id = ${studentId}::uuid FOR UPDATE`;
  return tx.studentProfile.findUniqueOrThrow({ where: { id: studentId }, select: studentSelect });
}

function findToken(token: string) {
  if (!TOKEN_PATTERN.test(token)) throw tokenError.invalid();
  return prisma.activationToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      usedAt: true,
      revokedAt: true,
      expiresAt: true,
      student: { select: { ...studentSelect, school: { select: { name: true } } } },
    },
  });
}

/**
 * Issues a new invite (ADMIN, or a TEACHER for a student in one of their
 * courses) and revokes any earlier invite that could still be used.
 */
export async function createInvite(user: AuthUser, studentId: string) {
  await assertStudentAccess(prisma, user, studentId); // 404 outside the caller's scope
  const student = await prisma.studentProfile.findUniqueOrThrow({
    where: { id: studentId },
    select: studentSelect,
  });
  assertCanActivate(student);

  const delivery = env.INVITE_DELIVERY;
  if (delivery === 'disabled') {
    // No token is created when it could not be delivered securely.
    throw new AppError(
      503,
      'INVITES_DISABLED',
      'Activation invites are turned off: this server has no secure way to deliver them (such as email).',
    );
  }

  const { token, hash } = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ACTIVATION_TTL_HOURS * 3_600_000);
  await prisma.$transaction(async (tx) => {
    assertCanActivate(await lockStudent(tx, studentId)); // re-checked under the lock
    await tx.activationToken.updateMany({
      where: { studentId, usedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
    await tx.activationToken.create({
      data: { studentId, tokenHash: hash, expiresAt, createdById: user.id },
    });
  });

  // delivery === 'dev-link': local development only (the env schema refuses it in
  // production). The link goes back to the staff member who asked for it; the
  // token is in the URL fragment, which browsers never send to a server.
  return { delivery, expiresAt, activationUrl: `${env.APP_URL}/activate#token=${token}` };
}

/** The latest invite that can still be used, for the staff view (never the token). */
export function pendingInvite(studentId: string) {
  return prisma.activationToken.findFirst({
    where: { studentId, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true, expiresAt: true },
  });
}

/** Public: checks a link and returns who it is for, so the page can greet the student. */
export async function previewActivation(token: string) {
  const row = await findToken(token);
  assertTokenUsable(row);
  assertCanActivate(row!.student);
  const s = row!.student;
  return {
    firstName: s.firstName,
    lastName: s.lastName,
    email: s.email!.toLowerCase(), // the address the account will use
    school: s.school.name,
  };
}

/** Public: uses the invite to create the student's login. */
export async function activateAccount({ token, password }: ActivateInput) {
  // Reject links that cannot work before spending time on bcrypt.
  const row = await findToken(token);
  assertTokenUsable(row);
  assertCanActivate(row!.student);
  const passwordHash = await hashPassword(password);
  const tokenHash = hashToken(token);

  return prisma.$transaction(async (tx) => {
    // Under the profile lock, a request that lost a race sees the account the
    // winner created and gets 409.
    const student = await lockStudent(tx, row!.student.id);
    assertCanActivate(student);

    const now = new Date();
    // Atomic claim: only an unused, unrevoked, unexpired token is marked used.
    const claimed = await tx.activationToken.updateMany({
      where: { tokenHash, usedAt: null, revokedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) {
      assertTokenUsable(
        await tx.activationToken.findUnique({
          where: { tokenHash },
          select: { usedAt: true, revokedAt: true, expiresAt: true },
        }),
        now,
      );
      throw tokenError.invalid();
    }

    // users.email is unique as well: if the address is already taken by another
    // account, this fails with 409 and the whole transaction rolls back.
    const user = await tx.user.create({
      data: {
        schoolId: student.schoolId,
        email: student.email!.toLowerCase(),
        passwordHash,
        role: 'STUDENT',
        firstName: student.firstName,
        lastName: student.lastName,
      },
      select: { id: true, email: true },
    });
    const linked = await tx.studentProfile.updateMany({
      where: { id: student.id, userId: null },
      data: { userId: user.id },
    });
    if (linked.count !== 1) {
      throw new AppError(409, 'ACCOUNT_EXISTS', 'This student already has an account.');
    }
    await tx.activationToken.updateMany({
      where: { studentId: student.id, usedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
    return { email: user.email };
  });
}
