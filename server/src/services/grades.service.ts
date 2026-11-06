import type { GradeStatus } from '../generated/prisma/enums.js';
import { prisma } from '../lib/prisma.js';
import type { AuthUser } from '../types/auth.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { round, toNumber } from '../utils/number.js';
import type { BulkGradesInput } from '../validators/resource.validators.js';
import {
  assertAssessmentAccess,
  assertCourseAccess,
  assertStudentAccess,
  courseScope,
} from './access.service.js';
import { onPerformanceDataChanged } from './risk.service.js';

const pct = (score: number | null, max: number) =>
  score === null ? null : round((score / max) * 100);

// ── Assessments ─────────────────────────────────────────────────────────────

export async function listAssessments(user: AuthUser, courseId: string) {
  await assertCourseAccess(prisma, user, courseId);
  const assessments = await prisma.assessment.findMany({
    where: { courseId },
    orderBy: { dueDate: 'asc' },
  });
  // One aggregate query for all assessments instead of one per assessment.
  const stats = await prisma.grade.groupBy({
    by: ['assessmentId'],
    where: { assessmentId: { in: assessments.map((a) => a.id) }, score: { not: null } },
    _avg: { score: true },
    _count: { _all: true },
  });
  const byId = new Map(stats.map((s) => [s.assessmentId, s]));
  return assessments.map((a) => {
    const s = byId.get(a.id);
    const max = Number(a.maxScore);
    return {
      id: a.id,
      courseId: a.courseId,
      title: a.title,
      type: a.type,
      maxScore: max,
      weight: Number(a.weight),
      dueDate: a.dueDate,
      gradedCount: s?._count._all ?? 0,
      averagePercent: s?._avg.score != null ? pct(Number(s._avg.score), max) : null,
    };
  });
}

type AssessmentInput = {
  title: string;
  type: 'ASSIGNMENT' | 'QUIZ' | 'EXAM' | 'PROJECT';
  maxScore: number;
  weight: number;
  dueDate: Date;
};

export async function createAssessment(user: AuthUser, courseId: string, input: AssessmentInput) {
  await assertCourseAccess(prisma, user, courseId, { manage: true });
  const a = await prisma.assessment.create({ data: { ...input, courseId } });
  return { ...a, maxScore: Number(a.maxScore), weight: Number(a.weight) };
}

export async function updateAssessment(
  user: AuthUser,
  id: string,
  input: Partial<AssessmentInput>,
) {
  const assessment = await assertAssessmentAccess(prisma, user, id, { manage: true });
  if (input.maxScore !== undefined) {
    const above = await prisma.grade.count({
      where: { assessmentId: id, score: { gt: input.maxScore } },
    });
    if (above > 0) throw conflict(`${above} existing grade(s) exceed the new maximum score`);
  }
  const a = await prisma.assessment.update({ where: { id }, data: input });
  if (input.maxScore !== undefined || input.weight !== undefined) {
    await onPerformanceDataChanged(assessment.courseId);
  }
  return { ...a, maxScore: Number(a.maxScore), weight: Number(a.weight) };
}

export async function deleteAssessment(user: AuthUser, id: string) {
  const assessment = await assertAssessmentAccess(prisma, user, id, { manage: true });
  await prisma.assessment.delete({ where: { id } });
  await onPerformanceDataChanged(assessment.courseId);
}

// ── Grades ──────────────────────────────────────────────────────────────────

/** Gradebook for one assessment: every actively enrolled student, graded or not. */
export async function getGradebook(user: AuthUser, assessmentId: string) {
  const assessment = await assertAssessmentAccess(prisma, user, assessmentId, { manage: true });
  const max = Number(assessment.maxScore);
  const [enrollments, grades] = await Promise.all([
    prisma.enrollment.findMany({
      where: { courseId: assessment.courseId, status: 'ACTIVE' },
      select: {
        student: { select: { id: true, studentNumber: true, firstName: true, lastName: true } },
      },
      orderBy: [{ student: { lastName: 'asc' } }, { student: { firstName: 'asc' } }],
    }),
    prisma.grade.findMany({ where: { assessmentId } }),
  ]);
  const byStudent = new Map(grades.map((g) => [g.studentId, g]));
  return {
    assessmentId,
    maxScore: max,
    rows: enrollments.map(({ student }) => {
      const g = byStudent.get(student.id);
      const score = toNumber(g?.score);
      return {
        student,
        gradeId: g?.id ?? null,
        score,
        percent: pct(score, max),
        status: g?.status ?? null,
        feedback: g?.feedback ?? null,
        gradedAt: g?.gradedAt ?? null,
      };
    }),
  };
}

/**
 * Bulk create/update of grades for one assessment, in a single transaction:
 * either every grade (and its history entry) is written, or none is.
 */
export async function upsertGrades(user: AuthUser, assessmentId: string, input: BulkGradesInput) {
  const assessment = await assertAssessmentAccess(prisma, user, assessmentId, { manage: true });
  const max = Number(assessment.maxScore);
  const studentIds = input.grades.map((g) => g.studentId);

  const over = input.grades.find((g) => g.score != null && g.score > max);
  if (over)
    throw badRequest(`Score ${over.score} exceeds the maximum of ${max}`, {
      studentId: over.studentId,
    });

  const enrolled = await prisma.enrollment.findMany({
    where: { courseId: assessment.courseId, studentId: { in: studentIds }, status: 'ACTIVE' },
    select: { studentId: true },
  });
  const enrolledIds = new Set(enrolled.map((e) => e.studentId));
  const notEnrolled = studentIds.filter((id) => !enrolledIds.has(id));
  if (notEnrolled.length)
    throw badRequest('Some students are not actively enrolled in this course', {
      studentIds: notEnrolled,
    });

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.grade.findMany({
      where: { assessmentId, studentId: { in: studentIds } },
    });
    const byStudent = new Map(existing.map((g) => [g.studentId, g]));
    let createdCount = 0;
    let updatedCount = 0;
    const history: {
      gradeId: string;
      oldScore: number | null;
      newScore: number | null;
      oldStatus: GradeStatus | null;
      newStatus: GradeStatus;
      changedById: string;
      reason: string | null;
    }[] = [];

    for (const entry of input.grades) {
      // MISSING / EXCUSED work has no score.
      const score =
        entry.status === 'MISSING' || entry.status === 'EXCUSED' ? null : (entry.score ?? null);
      const prev = byStudent.get(entry.studentId);
      if (!prev) {
        const g = await tx.grade.create({
          data: {
            assessmentId,
            studentId: entry.studentId,
            score,
            status: entry.status,
            feedback: entry.feedback ?? null,
            gradedById: user.id,
          },
        });
        history.push({
          gradeId: g.id,
          oldScore: null,
          newScore: score,
          oldStatus: null,
          newStatus: entry.status,
          changedById: user.id,
          reason: input.reason ?? null,
        });
        createdCount++;
        continue;
      }
      const prevScore = toNumber(prev.score);
      const changed =
        prevScore !== score ||
        prev.status !== entry.status ||
        (entry.feedback !== undefined && entry.feedback !== prev.feedback);
      if (!changed) continue;
      await tx.grade.update({
        where: { id: prev.id },
        data: {
          score,
          status: entry.status,
          feedback: entry.feedback ?? prev.feedback,
          gradedById: user.id,
          gradedAt: new Date(),
        },
      });
      if (prevScore !== score || prev.status !== entry.status) {
        history.push({
          gradeId: prev.id,
          oldScore: prevScore,
          newScore: score,
          oldStatus: prev.status,
          newStatus: entry.status,
          changedById: user.id,
          reason: input.reason ?? null,
        });
      }
      updatedCount++;
    }
    if (history.length) await tx.gradeHistory.createMany({ data: history });
    return {
      created: createdCount,
      updated: updatedCount,
      unchanged: input.grades.length - createdCount - updatedCount,
    };
  });

  await onPerformanceDataChanged(assessment.courseId, studentIds);
  return result;
}

export async function getStudentGrades(user: AuthUser, studentId: string, courseId?: string) {
  await assertStudentAccess(prisma, user, studentId);
  const grades = await prisma.grade.findMany({
    where: { studentId, assessment: { course: courseScope(user), ...(courseId && { courseId }) } },
    select: {
      id: true,
      score: true,
      status: true,
      feedback: true,
      gradedAt: true,
      assessment: {
        select: {
          id: true,
          title: true,
          type: true,
          maxScore: true,
          weight: true,
          dueDate: true,
          course: { select: { id: true, code: true, name: true } },
        },
      },
    },
    orderBy: { assessment: { dueDate: 'asc' } },
  });
  return grades.map((g) => {
    const max = Number(g.assessment.maxScore);
    const score = toNumber(g.score);
    return {
      id: g.id,
      score,
      percent: pct(score, max),
      status: g.status,
      feedback: g.feedback,
      gradedAt: g.gradedAt,
      assessment: { ...g.assessment, maxScore: max, weight: Number(g.assessment.weight) },
    };
  });
}

export async function getGradeHistory(user: AuthUser, gradeId: string) {
  const grade = await prisma.grade.findFirst({
    where: { id: gradeId, assessment: { course: courseScope(user) } },
    select: { id: true, assessmentId: true },
  });
  if (!grade) throw notFound('Grade');
  await assertAssessmentAccess(prisma, user, grade.assessmentId, { manage: true });
  const rows = await prisma.gradeHistory.findMany({
    where: { gradeId },
    orderBy: { changedAt: 'desc' },
  });
  return rows.map((h) => ({
    ...h,
    oldScore: toNumber(h.oldScore),
    newScore: toNumber(h.newScore),
  }));
}
