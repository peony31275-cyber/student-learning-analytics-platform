/**
 * Row-level authorization (data scoping).
 *
 * Every query that reads tenant data composes one of these `where` fragments,
 * so the visibility rules live in exactly one place:
 *
 *   ADMIN    → everything in their school
 *   TEACHER  → courses they teach, and students enrolled in those courses
 *   STUDENT  → only their own profile and the courses they are enrolled in
 *
 * Out-of-scope single resources return 404 rather than 403, so an attacker
 * cannot probe which IDs exist (prevents IDOR enumeration).
 */
import type { Prisma } from '../generated/prisma/client.js';
import type { Db } from '../lib/prisma.js';
import type { AuthUser } from '../types/auth.js';
import { forbidden, notFound } from '../utils/errors.js';

/** A UUID that can never match, used to produce an empty result set safely. */
const NO_MATCH = '00000000-0000-0000-0000-000000000000';

export function studentScope(user: AuthUser): Prisma.StudentProfileWhereInput {
  switch (user.role) {
    case 'ADMIN':
      return { schoolId: user.schoolId };
    case 'TEACHER':
      return {
        schoolId: user.schoolId,
        enrollments: { some: { course: { teacherId: user.teacherId ?? NO_MATCH } } },
      };
    case 'STUDENT':
      return { id: user.studentId ?? NO_MATCH };
  }
}

export function courseScope(user: AuthUser): Prisma.CourseWhereInput {
  switch (user.role) {
    case 'ADMIN':
      return { schoolId: user.schoolId };
    case 'TEACHER':
      return { schoolId: user.schoolId, teacherId: user.teacherId ?? NO_MATCH };
    case 'STUDENT':
      return { enrollments: { some: { studentId: user.studentId ?? NO_MATCH } } };
  }
}

/** Throws 404 unless the student is visible to the user. */
export async function assertStudentAccess(db: Db, user: AuthUser, studentId: string) {
  const student = await db.studentProfile.findFirst({
    where: { AND: [{ id: studentId }, studentScope(user)] },
    select: { id: true, schoolId: true },
  });
  if (!student) throw notFound('Student');
  return student;
}

/**
 * Throws 404 unless the course is visible to the user. With `manage: true`
 * students are rejected with 403 (they can read, but never modify, a course).
 */
export async function assertCourseAccess(
  db: Db,
  user: AuthUser,
  courseId: string,
  opts: { manage?: boolean } = {},
) {
  const course = await db.course.findFirst({
    where: { AND: [{ id: courseId }, courseScope(user)] },
    select: { id: true, schoolId: true, teacherId: true },
  });
  if (!course) throw notFound('Course');
  if (opts.manage && user.role === 'STUDENT') throw forbidden();
  return course;
}

/** Resolves an assessment and enforces access to its course. */
export async function assertAssessmentAccess(
  db: Db,
  user: AuthUser,
  assessmentId: string,
  opts: { manage?: boolean } = {},
) {
  const assessment = await db.assessment.findFirst({
    where: { id: assessmentId, course: courseScope(user) },
    select: { id: true, courseId: true, maxScore: true },
  });
  if (!assessment) throw notFound('Assessment');
  if (opts.manage && user.role === 'STUDENT') throw forbidden();
  return assessment;
}
