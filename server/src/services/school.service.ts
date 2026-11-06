import { prisma } from '../lib/prisma.js';
import type { AuthUser } from '../types/auth.js';

export async function getSchool(user: AuthUser) {
  const school = await prisma.school.findUniqueOrThrow({
    where: { id: user.schoolId },
    select: { id: true, name: true, timezone: true, createdAt: true },
  });
  const [students, teachers, courses] = await prisma.$transaction([
    prisma.studentProfile.count({ where: { schoolId: user.schoolId, status: 'ACTIVE' } }),
    prisma.user.count({ where: { schoolId: user.schoolId, role: 'TEACHER', isActive: true } }),
    prisma.course.count({ where: { schoolId: user.schoolId } }),
  ]);
  return { ...school, counts: { students, teachers, courses } };
}

export async function updateSchool(user: AuthUser, input: { name?: string; timezone?: string }) {
  await prisma.school.update({ where: { id: user.schoolId }, data: input });
  return getSchool(user);
}
