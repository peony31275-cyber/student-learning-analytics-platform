import { prisma } from '../lib/prisma.js';
import type { AuthUser } from '../types/auth.js';
import { badRequest } from '../utils/errors.js';
import type { BulkAttendanceInput } from '../validators/resource.validators.js';
import { assertCourseAccess, assertStudentAccess, courseScope } from './access.service.js';
import { onPerformanceDataChanged } from './risk.service.js';

/** Roster for one class meeting, with the recorded status (or null if not taken yet). */
export async function getCourseAttendance(user: AuthUser, courseId: string, date: Date) {
  await assertCourseAccess(prisma, user, courseId, { manage: true });
  const [enrollments, records] = await Promise.all([
    prisma.enrollment.findMany({
      where: { courseId, status: 'ACTIVE' },
      select: { student: { select: { id: true, studentNumber: true, firstName: true, lastName: true } } },
      orderBy: [{ student: { lastName: 'asc' } }, { student: { firstName: 'asc' } }],
    }),
    prisma.attendance.findMany({ where: { courseId, date } }),
  ]);
  const byStudent = new Map(records.map((r) => [r.studentId, r]));
  return {
    courseId,
    date: date.toISOString().slice(0, 10),
    rows: enrollments.map(({ student }) => {
      const r = byStudent.get(student.id);
      return { student, attendanceId: r?.id ?? null, status: r?.status ?? null, note: r?.note ?? null };
    }),
  };
}

/** Distinct class dates already recorded for a course, newest first, with per-status counts. */
export async function listSessions(user: AuthUser, courseId: string) {
  await assertCourseAccess(prisma, user, courseId, { manage: true });
  const rows = await prisma.attendance.groupBy({
    by: ['date', 'status'],
    where: { courseId },
    _count: { _all: true },
    orderBy: { date: 'desc' },
  });
  const sessions = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const key = r.date.toISOString().slice(0, 10);
    const entry = sessions.get(key) ?? { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0 };
    entry[r.status] = r._count._all;
    sessions.set(key, entry);
  }
  return [...sessions.entries()].map(([date, counts]) => ({ date, ...counts }));
}

/**
 * Records attendance for a whole class meeting. Uses one upsert per student
 * keyed on the (studentId, courseId, date) unique constraint, so re-submitting
 * the same day is idempotent and never creates duplicates.
 */
export async function recordAttendance(user: AuthUser, courseId: string, input: BulkAttendanceInput) {
  await assertCourseAccess(prisma, user, courseId, { manage: true });
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (input.date > tomorrow) throw badRequest('Attendance cannot be recorded for a future date');

  const studentIds = input.records.map((r) => r.studentId);
  const enrolled = await prisma.enrollment.findMany({
    where: { courseId, studentId: { in: studentIds }, status: 'ACTIVE' },
    select: { studentId: true },
  });
  const enrolledIds = new Set(enrolled.map((e) => e.studentId));
  const notEnrolled = studentIds.filter((id) => !enrolledIds.has(id));
  if (notEnrolled.length) throw badRequest('Some students are not actively enrolled in this course', { studentIds: notEnrolled });

  await prisma.$transaction(
    input.records.map((r) =>
      prisma.attendance.upsert({
        where: { studentId_courseId_date: { studentId: r.studentId, courseId, date: input.date } },
        create: { studentId: r.studentId, courseId, date: input.date, status: r.status, note: r.note ?? null, recordedById: user.id },
        update: { status: r.status, note: r.note ?? null, recordedById: user.id },
      }),
    ),
  );
  await onPerformanceDataChanged(courseId, studentIds);
  return { recorded: input.records.length, date: input.date.toISOString().slice(0, 10) };
}

export async function getStudentAttendance(
  user: AuthUser,
  studentId: string,
  q: { courseId?: string; from?: Date; to?: Date },
) {
  await assertStudentAccess(prisma, user, studentId);
  const records = await prisma.attendance.findMany({
    where: {
      studentId,
      course: courseScope(user),
      ...(q.courseId && { courseId: q.courseId }),
      ...((q.from || q.to) && { date: { gte: q.from, lte: q.to } }),
    },
    select: { id: true, date: true, status: true, note: true, course: { select: { id: true, code: true, name: true } } },
    orderBy: { date: 'desc' },
  });
  return records.map((r) => ({ ...r, date: r.date.toISOString().slice(0, 10) }));
}
