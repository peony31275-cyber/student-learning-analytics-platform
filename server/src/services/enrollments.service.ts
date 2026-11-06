import type { EnrollmentStatus } from '../generated/prisma/enums.js';
import { prisma } from '../lib/prisma.js';
import type { AuthUser } from '../types/auth.js';
import { conflict, notFound } from '../utils/errors.js';
import { type Pagination, buildPage, toSkipTake } from '../utils/pagination.js';
import { assertCourseAccess, assertStudentAccess, courseScope } from './access.service.js';

const enrollmentSelect = {
  id: true,
  status: true,
  enrolledAt: true,
  student: { select: { id: true, studentNumber: true, firstName: true, lastName: true } },
  course: { select: { id: true, code: true, name: true, term: true } },
} as const;

export async function listEnrollments(
  user: AuthUser,
  q: Pagination & { courseId?: string; studentId?: string; status?: EnrollmentStatus },
) {
  if (q.courseId) await assertCourseAccess(prisma, user, q.courseId);
  if (q.studentId) await assertStudentAccess(prisma, user, q.studentId);
  const where = {
    courseId: q.courseId,
    studentId: q.studentId,
    status: q.status,
    course: courseScope(user),
  };
  const [items, total] = await prisma.$transaction([
    prisma.enrollment.findMany({
      where,
      select: enrollmentSelect,
      orderBy: { enrolledAt: 'desc' },
      ...toSkipTake(q),
    }),
    prisma.enrollment.count({ where }),
  ]);
  return buildPage(items, total, q);
}

/**
 * Enrolls a school student in a course the caller manages. Re-enrolling a
 * student who previously dropped reactivates the existing row (the unique
 * (studentId, courseId) constraint keeps one row per pair, preserving history).
 */
export async function enroll(user: AuthUser, studentId: string, courseId: string) {
  const course = await assertCourseAccess(prisma, user, courseId, { manage: true });
  const student = await prisma.studentProfile.findFirst({
    where: { id: studentId, schoolId: course.schoolId },
    select: { id: true, status: true },
  });
  if (!student) throw notFound('Student');
  if (student.status !== 'ACTIVE') throw conflict('Only active students can be enrolled');

  const existing = await prisma.enrollment.findUnique({
    where: { studentId_courseId: { studentId, courseId } },
    select: { id: true, status: true },
  });
  if (existing?.status === 'ACTIVE') throw conflict('Student is already enrolled in this course');

  const enrollment = existing
    ? await prisma.enrollment.update({
        where: { id: existing.id },
        data: { status: 'ACTIVE' },
        select: enrollmentSelect,
      })
    : await prisma.enrollment.create({ data: { studentId, courseId }, select: enrollmentSelect });
  return { enrollment, reactivated: Boolean(existing) };
}

export async function updateEnrollment(user: AuthUser, id: string, status: EnrollmentStatus) {
  const enrollment = await prisma.enrollment.findFirst({
    where: { id, course: courseScope(user) },
    select: { courseId: true },
  });
  if (!enrollment) throw notFound('Enrollment');
  await assertCourseAccess(prisma, user, enrollment.courseId, { manage: true });
  return prisma.enrollment.update({ where: { id }, data: { status }, select: enrollmentSelect });
}
