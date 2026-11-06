import type { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../lib/prisma.js';
import type { AuthUser } from '../types/auth.js';
import { badRequest, conflict, forbidden } from '../utils/errors.js';
import { type Pagination, buildPage, toSkipTake } from '../utils/pagination.js';
import type { CreateCourseInput, UpdateCourseInput } from '../validators/resource.validators.js';
import { assertCourseAccess, courseScope } from './access.service.js';

const courseSelect = {
  id: true,
  code: true,
  name: true,
  description: true,
  term: true,
  credits: true,
  createdAt: true,
  teacher: {
    select: {
      id: true,
      department: true,
      user: { select: { firstName: true, lastName: true, email: true } },
    },
  },
  _count: { select: { enrollments: { where: { status: 'ACTIVE' } }, assessments: true } },
} satisfies Prisma.CourseSelect;

type CourseRow = Prisma.CourseGetPayload<{ select: typeof courseSelect }>;

function toCourseDto({ _count, teacher, ...c }: CourseRow) {
  return {
    ...c,
    teacher: { id: teacher.id, department: teacher.department, ...teacher.user },
    studentCount: _count.enrollments,
    assessmentCount: _count.assessments,
  };
}

export async function listCourses(
  user: AuthUser,
  q: Pagination & { search?: string; term?: string; teacherId?: string },
) {
  const where: Prisma.CourseWhereInput = {
    AND: [
      courseScope(user),
      q.term ? { term: q.term } : {},
      q.teacherId ? { teacherId: q.teacherId } : {},
      q.search
        ? {
            OR: [
              { code: { contains: q.search, mode: 'insensitive' } },
              { name: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {},
    ],
  };
  const [rows, total] = await prisma.$transaction([
    prisma.course.findMany({
      where,
      select: courseSelect,
      orderBy: [{ term: 'desc' }, { code: 'asc' }],
      ...toSkipTake(q),
    }),
    prisma.course.count({ where }),
  ]);
  return buildPage(rows.map(toCourseDto), total, q);
}

export async function getCourse(user: AuthUser, id: string) {
  await assertCourseAccess(prisma, user, id);
  return toCourseDto(
    await prisma.course.findUniqueOrThrow({ where: { id }, select: courseSelect }),
  );
}

async function resolveTeacher(user: AuthUser, requested: string | undefined): Promise<string> {
  if (user.role === 'TEACHER') {
    if (requested && requested !== user.teacherId)
      throw forbidden('Teachers can only create their own courses');
    return user.teacherId!;
  }
  if (!requested) throw badRequest('teacherId is required');
  const teacher = await prisma.teacherProfile.findFirst({
    where: { id: requested, user: { schoolId: user.schoolId, isActive: true } },
    select: { id: true },
  });
  if (!teacher) throw badRequest('Teacher not found in this school');
  return teacher.id;
}

async function assertUniqueCode(schoolId: string, code: string, term: string, excludeId?: string) {
  const clash = await prisma.course.findFirst({
    where: { schoolId, code, term, ...(excludeId && { NOT: { id: excludeId } }) },
    select: { id: true },
  });
  if (clash) throw conflict(`Course ${code} already exists for ${term}`);
}

export async function createCourse(user: AuthUser, input: CreateCourseInput) {
  const teacherId = await resolveTeacher(user, input.teacherId);
  await assertUniqueCode(user.schoolId, input.code, input.term);
  const course = await prisma.course.create({
    data: {
      schoolId: user.schoolId,
      teacherId,
      code: input.code,
      name: input.name,
      description: input.description ?? null,
      term: input.term,
      credits: input.credits,
    },
    select: courseSelect,
  });
  return toCourseDto(course);
}

export async function updateCourse(user: AuthUser, id: string, input: UpdateCourseInput) {
  const current = await assertCourseAccess(prisma, user, id, { manage: true });
  if (input.teacherId && user.role !== 'ADMIN')
    throw forbidden('Only admins can reassign a course');
  const teacherId = input.teacherId ? await resolveTeacher(user, input.teacherId) : undefined;

  if (input.code || input.term) {
    const existing = await prisma.course.findUniqueOrThrow({
      where: { id },
      select: { code: true, term: true },
    });
    await assertUniqueCode(
      current.schoolId,
      input.code ?? existing.code,
      input.term ?? existing.term,
      id,
    );
  }
  const course = await prisma.course.update({
    where: { id },
    data: { ...input, teacherId },
    select: courseSelect,
  });
  return toCourseDto(course);
}

export async function deleteCourse(user: AuthUser, id: string) {
  await assertCourseAccess(prisma, user, id, { manage: true });
  // Cascades to enrollments, assessments, grades, attendance and alerts (FK ON DELETE CASCADE).
  await prisma.course.delete({ where: { id } });
}

/** Course roster with each student's enrollment status. */
export async function getRoster(user: AuthUser, courseId: string) {
  await assertCourseAccess(prisma, user, courseId, { manage: true });
  const rows = await prisma.enrollment.findMany({
    where: { courseId },
    select: {
      id: true,
      status: true,
      enrolledAt: true,
      student: {
        select: {
          id: true,
          studentNumber: true,
          firstName: true,
          lastName: true,
          gradeLevel: true,
        },
      },
    },
    orderBy: [{ student: { lastName: 'asc' } }, { student: { firstName: 'asc' } }],
  });
  const alerts = await prisma.riskAlert.findMany({
    where: { courseId },
    select: { studentId: true, level: true, score: true },
  });
  const byStudent = new Map(alerts.map((a) => [a.studentId, a]));
  return rows.map((r) => ({
    enrollmentId: r.id,
    enrollmentStatus: r.status,
    enrolledAt: r.enrolledAt,
    ...r.student,
    riskLevel: byStudent.get(r.student.id)?.level ?? null,
    riskScore: byStudent.get(r.student.id)?.score ?? null,
  }));
}
