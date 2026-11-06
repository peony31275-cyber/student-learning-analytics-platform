import type { Prisma } from '../generated/prisma/client.js';
import { hashPassword } from '../lib/password.js';
import { prisma } from '../lib/prisma.js';
import type { AuthUser } from '../types/auth.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { type Pagination, buildPage, toSkipTake } from '../utils/pagination.js';
import type { CreateUserInput, UpdateUserInput } from '../validators/resource.validators.js';

/** Explicit allow-list of columns: passwordHash and tokenVersion can never leak. */
const userSelect = {
  id: true,
  email: true,
  role: true,
  firstName: true,
  lastName: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  teacherProfile: { select: { id: true, department: true, title: true } },
  studentProfile: { select: { id: true, studentNumber: true } },
} satisfies Prisma.UserSelect;

export async function listUsers(
  admin: AuthUser,
  q: Pagination & { role?: AuthUser['role']; isActive?: boolean; search?: string },
) {
  const where: Prisma.UserWhereInput = {
    schoolId: admin.schoolId,
    role: q.role,
    isActive: q.isActive,
    ...(q.search && {
      OR: [
        { email: { contains: q.search, mode: 'insensitive' } },
        { firstName: { contains: q.search, mode: 'insensitive' } },
        { lastName: { contains: q.search, mode: 'insensitive' } },
      ],
    }),
  };
  const [items, total] = await prisma.$transaction([
    prisma.user.findMany({ where, select: userSelect, orderBy: [{ role: 'asc' }, { lastName: 'asc' }], ...toSkipTake(q) }),
    prisma.user.count({ where }),
  ]);
  return buildPage(items, total, q);
}

export async function getUser(admin: AuthUser, id: string) {
  const user = await prisma.user.findFirst({ where: { id, schoolId: admin.schoolId }, select: userSelect });
  if (!user) throw notFound('User');
  return user;
}

export async function createUser(admin: AuthUser, input: CreateUserInput) {
  if (await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } })) {
    throw conflict('An account with this email already exists');
  }
  const passwordHash = await hashPassword(input.password);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        schoolId: admin.schoolId,
        email: input.email,
        passwordHash,
        role: input.role,
        firstName: input.firstName,
        lastName: input.lastName,
        ...(input.role === 'TEACHER' && { teacherProfile: { create: { department: input.department ?? null } } }),
      },
      select: { id: true },
    });

    if (input.role === 'STUDENT') {
      const linked = await tx.studentProfile.updateMany({
        where: { id: input.studentId!, schoolId: admin.schoolId, userId: null },
        data: { userId: user.id },
      });
      if (linked.count !== 1) throw badRequest('Student profile not found or already linked to an account');
    }
    return tx.user.findUniqueOrThrow({ where: { id: user.id }, select: userSelect });
  });
}

export async function updateUser(admin: AuthUser, id: string, input: UpdateUserInput) {
  const existing = await getUser(admin, id);
  if (id === admin.id && input.isActive === false) throw badRequest('You cannot deactivate your own account');

  return prisma.user.update({
    where: { id },
    data: {
      firstName: input.firstName,
      lastName: input.lastName,
      isActive: input.isActive,
      // Deactivation revokes all live sessions immediately.
      ...(input.isActive === false && { tokenVersion: { increment: 1 } }),
      ...(input.department !== undefined &&
        existing.teacherProfile && { teacherProfile: { update: { department: input.department } } }),
    },
    select: userSelect,
  });
}
