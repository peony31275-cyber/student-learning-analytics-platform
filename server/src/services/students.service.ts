import type { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../lib/prisma.js';
import type { AuthUser } from '../types/auth.js';
import { badRequest, conflict, forbidden } from '../utils/errors.js';
import { buildPage, toSkipTake } from '../utils/pagination.js';
import type {
  CreateStudentInput,
  ListStudentsQuery,
  UpdateStudentInput,
} from '../validators/resource.validators.js';
import { assertStudentAccess, courseScope, studentScope } from './access.service.js';
import { highestRisk, levelsAtLeast } from './risk-level.js';

/** Selection depends on the caller: counts and risk are limited to courses they can see. */
const listSelect = (user: AuthUser) =>
  ({
    id: true,
    studentNumber: true,
    firstName: true,
    lastName: true,
    email: true,
    gradeLevel: true,
    status: true,
    userId: true,
    _count: { select: { enrollments: { where: { status: 'ACTIVE', course: courseScope(user) } } } },
    // Risk shown to a teacher only reflects the courses they can see.
    riskAlerts: { where: { course: courseScope(user) }, select: { level: true, courseId: true } },
  }) satisfies Prisma.StudentProfileSelect;

export async function listStudents(user: AuthUser, q: ListStudentsQuery) {
  const filters: Prisma.StudentProfileWhereInput[] = [studentScope(user)];
  if (q.search) {
    filters.push({
      OR: [
        { firstName: { contains: q.search, mode: 'insensitive' } },
        { lastName: { contains: q.search, mode: 'insensitive' } },
        { studentNumber: { contains: q.search, mode: 'insensitive' } },
        { email: { contains: q.search, mode: 'insensitive' } },
      ],
    });
  }
  if (q.courseId) filters.push({ enrollments: { some: { courseId: q.courseId } } });
  if (q.gradeLevel) filters.push({ gradeLevel: q.gradeLevel });
  if (q.status) filters.push({ status: q.status });
  if (q.riskLevel) {
    // Match the student's *highest* visible level, consistent with the riskLevel shown in each row.
    const scoped = { course: courseScope(user) };
    const higher = levelsAtLeast(q.riskLevel).filter((l) => l !== q.riskLevel);
    filters.push({ riskAlerts: { some: { ...scoped, level: q.riskLevel } } });
    if (higher.length) filters.push({ riskAlerts: { none: { ...scoped, level: { in: higher } } } });
  }
  const where: Prisma.StudentProfileWhereInput = { AND: filters };

  const orderBy: Prisma.StudentProfileOrderByWithRelationInput[] =
    q.sort === 'lastName'
      ? [{ lastName: q.order }, { firstName: q.order }]
      : [{ [q.sort]: q.order }];

  // Prisma resolves the nested riskAlerts/_count selections with batched
  // queries (WHERE studentId IN (...)), not one query per row, so there is no N+1.
  const [rows, total] = await prisma.$transaction([
    prisma.studentProfile.findMany({ where, select: listSelect(user), orderBy, ...toSkipTake(q) }),
    prisma.studentProfile.count({ where }),
  ]);

  const items = rows.map(({ riskAlerts, _count, ...s }) => ({
    ...s,
    hasAccount: s.userId !== null,
    activeCourses: _count.enrollments,
    riskLevel: highestRisk(riskAlerts.map((a) => a.level)),
  }));
  return buildPage(items, total, q);
}

/**
 * Minimal school-wide lookup (name + number only) so teachers can find a
 * student to enroll who is not yet in any of their courses.
 */
export async function directory(user: AuthUser, q: { search?: string; limit: number }) {
  return prisma.studentProfile.findMany({
    where: {
      schoolId: user.schoolId,
      status: 'ACTIVE',
      ...(q.search && {
        OR: [
          { firstName: { contains: q.search, mode: 'insensitive' } },
          { lastName: { contains: q.search, mode: 'insensitive' } },
          { studentNumber: { contains: q.search, mode: 'insensitive' } },
        ],
      }),
    },
    select: { id: true, studentNumber: true, firstName: true, lastName: true, gradeLevel: true },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    take: q.limit,
  });
}

export async function getStudent(user: AuthUser, id: string) {
  await assertStudentAccess(prisma, user, id);
  const student = await prisma.studentProfile.findUniqueOrThrow({
    where: { id },
    select: {
      id: true,
      studentNumber: true,
      firstName: true,
      lastName: true,
      email: true,
      gradeLevel: true,
      status: true,
      userId: true,
      createdAt: true,
      enrollments: {
        // Teachers only see the enrollments of their own courses.
        where: { course: courseScope(user) },
        select: {
          id: true,
          status: true,
          enrolledAt: true,
          course: {
            select: {
              id: true,
              code: true,
              name: true,
              term: true,
              teacher: { select: { user: { select: { firstName: true, lastName: true } } } },
            },
          },
        },
        orderBy: { course: { code: 'asc' } },
      },
      riskAlerts: {
        where: { course: courseScope(user) },
        select: {
          id: true,
          courseId: true,
          level: true,
          score: true,
          status: true,
          computedAt: true,
        },
      },
    },
  });
  return {
    ...student,
    hasAccount: student.userId !== null,
    riskLevel: highestRisk(student.riskAlerts.map((a) => a.level)),
  };
}

export async function createStudent(user: AuthUser, input: CreateStudentInput) {
  const courseIds = [...new Set(input.courseIds)];
  // A teacher could not see a student outside their courses, so they must enroll them in at least one.
  if (user.role === 'TEACHER' && courseIds.length === 0) {
    throw badRequest('Teachers must enroll a new student in at least one of their courses');
  }
  if (courseIds.length) {
    const allowed = await prisma.course.count({
      where: { AND: [{ id: { in: courseIds } }, courseScope(user)] },
    });
    if (allowed !== courseIds.length)
      throw forbidden('You can only enroll students in courses you manage');
  }

  const duplicate = await prisma.studentProfile.findUnique({
    where: {
      schoolId_studentNumber: { schoolId: user.schoolId, studentNumber: input.studentNumber },
    },
    select: { id: true },
  });
  if (duplicate) throw conflict(`Student number ${input.studentNumber} is already in use`);

  // One transaction: the profile never exists without its initial enrollments.
  return prisma.$transaction(async (tx) => {
    const student = await tx.studentProfile.create({
      data: {
        schoolId: user.schoolId,
        studentNumber: input.studentNumber,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email ?? null,
        gradeLevel: input.gradeLevel,
      },
    });
    if (courseIds.length) {
      await tx.enrollment.createMany({
        data: courseIds.map((courseId) => ({ studentId: student.id, courseId })),
      });
    }
    return student;
  });
}

export async function updateStudent(user: AuthUser, id: string, input: UpdateStudentInput) {
  await assertStudentAccess(prisma, user, id);
  if (input.studentNumber) {
    const clash = await prisma.studentProfile.findFirst({
      where: { schoolId: user.schoolId, studentNumber: input.studentNumber, NOT: { id } },
      select: { id: true },
    });
    if (clash) throw conflict(`Student number ${input.studentNumber} is already in use`);
  }
  return prisma.studentProfile.update({ where: { id }, data: input });
}
