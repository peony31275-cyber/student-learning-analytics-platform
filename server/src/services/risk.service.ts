/**
 * Early-warning orchestration: load data in bulk, run the pure engine,
 * persist one RiskAlert per enrollment.
 *
 * Query cost per course is constant (school config, enrollments, grades,
 * attendance, existing alerts, then one write transaction) no matter how many
 * students are enrolled, which avoids the N+1 pattern of evaluating students
 * one at a time.
 */
import { type RiskConfig, resolveRiskConfig, riskConfigSchema } from '../domain/risk/config.js';
import { type RiskEvaluation, evaluateRisk } from '../domain/risk/engine.js';
import {
  type AttendanceStatusLike,
  type GradePoint,
  type RiskMetrics,
  computeMetrics,
} from '../domain/risk/metrics.js';
import type { AlertStatus, RiskLevel } from '../generated/prisma/enums.js';
import type { Prisma } from '../generated/prisma/client.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import type { AuthUser } from '../types/auth.js';
import { notFound } from '../utils/errors.js';
import { type Pagination, buildPage, toSkipTake } from '../utils/pagination.js';
import { assertCourseAccess, assertStudentAccess, courseScope } from './access.service.js';
import { RISK_ORDER, levelsAtLeast } from './risk-level.js';

// ── Configuration ───────────────────────────────────────────────────────────

export async function getRiskConfig(schoolId: string): Promise<RiskConfig> {
  const school = await prisma.school.findUniqueOrThrow({
    where: { id: schoolId },
    select: { riskConfig: true },
  });
  return resolveRiskConfig(school.riskConfig);
}

export async function updateRiskConfig(user: AuthUser, input: unknown) {
  const config = riskConfigSchema.parse(input);
  await prisma.school.update({ where: { id: user.schoolId }, data: { riskConfig: config } });
  // New thresholds apply to everyone immediately.
  const summary = await recalculateForSchool(user.schoolId);
  return { config, recalculation: summary };
}

// ── Evaluation ──────────────────────────────────────────────────────────────

export interface EnrollmentEvaluation extends RiskEvaluation {
  studentId: string;
  courseId: string;
  metrics: RiskMetrics;
}

/** Evaluates every active enrollment of a course (optionally a subset of students). */
export async function evaluateCourse(courseId: string, config: RiskConfig, studentIds?: string[]) {
  const studentFilter = studentIds ? { studentId: { in: studentIds } } : {};
  const [enrollments, grades, attendance] = await Promise.all([
    prisma.enrollment.findMany({
      where: { courseId, status: 'ACTIVE', ...studentFilter },
      select: { studentId: true },
    }),
    prisma.grade.findMany({
      where: { assessment: { courseId }, ...studentFilter },
      select: {
        studentId: true,
        score: true,
        status: true,
        assessment: { select: { maxScore: true, weight: true, dueDate: true } },
      },
    }),
    prisma.attendance.findMany({
      where: { courseId, ...studentFilter },
      select: { studentId: true, status: true },
    }),
  ]);

  const gradesByStudent = new Map<string, GradePoint[]>();
  for (const g of grades) {
    const max = Number(g.assessment.maxScore);
    const list = gradesByStudent.get(g.studentId) ?? [];
    list.push({
      percent: g.score === null ? null : (Number(g.score) / max) * 100,
      status: g.status,
      weight: Number(g.assessment.weight),
      dueDate: g.assessment.dueDate,
    });
    gradesByStudent.set(g.studentId, list);
  }
  const attendanceByStudent = new Map<string, AttendanceStatusLike[]>();
  for (const a of attendance) {
    const list = attendanceByStudent.get(a.studentId) ?? [];
    list.push(a.status);
    attendanceByStudent.set(a.studentId, list);
  }

  return enrollments.map(({ studentId }): EnrollmentEvaluation => {
    const metrics = computeMetrics(
      gradesByStudent.get(studentId) ?? [],
      attendanceByStudent.get(studentId) ?? [],
      config.recentWindow,
    );
    return { studentId, courseId, metrics, ...evaluateRisk(metrics, config) };
  });
}

/**
 * Alert lifecycle on recalculation:
 *  - LOW risk is auto-resolved (nothing to act on)
 *  - a new alert, or an escalation (e.g. MEDIUM to HIGH), is (re)opened
 *  - otherwise the teacher's status (ACKNOWLEDGED/RESOLVED) is preserved
 */
export function nextStatus(
  prev: { level: RiskLevel; status: AlertStatus } | undefined,
  level: RiskLevel,
): AlertStatus {
  if (level === 'LOW') return 'RESOLVED';
  if (!prev || RISK_ORDER[level] > RISK_ORDER[prev.level]) return 'OPEN';
  return prev.status === 'RESOLVED' ? 'OPEN' : prev.status;
}

async function persist(evaluations: EnrollmentEvaluation[]) {
  if (evaluations.length === 0) return;
  const courseIds = [...new Set(evaluations.map((e) => e.courseId))];
  const existing = await prisma.riskAlert.findMany({
    where: { courseId: { in: courseIds }, studentId: { in: evaluations.map((e) => e.studentId) } },
    select: { studentId: true, courseId: true, level: true, status: true },
  });
  const prevByKey = new Map(existing.map((a) => [`${a.studentId}:${a.courseId}`, a]));
  const now = new Date();

  await prisma.$transaction(
    evaluations.map((e) => {
      const prev = prevByKey.get(`${e.studentId}:${e.courseId}`);
      const status = nextStatus(prev, e.level);
      const reopened = status === 'OPEN' && prev?.status !== 'OPEN';
      const data = {
        level: e.level,
        score: e.score,
        factors: e.factors as unknown as Prisma.InputJsonValue,
        metrics: { ...e.metrics, skipped: e.skipped } as unknown as Prisma.InputJsonValue,
        status,
        computedAt: now,
      };
      return prisma.riskAlert.upsert({
        where: { studentId_courseId: { studentId: e.studentId, courseId: e.courseId } },
        create: { studentId: e.studentId, courseId: e.courseId, ...data },
        update: {
          ...data,
          previousLevel: prev?.level ?? null,
          ...(reopened && { acknowledgedAt: null, acknowledgedById: null }),
        },
      });
    }),
  );
}

export interface RecalculationSummary {
  courses: number;
  evaluated: number;
  byLevel: Record<RiskLevel, number>;
  durationMs: number;
}

async function recalculateCourses(
  courseIds: string[],
  config: RiskConfig,
): Promise<RecalculationSummary> {
  const started = Date.now();
  const byLevel: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 0, HIGH: 0 };
  let evaluated = 0;
  for (const courseId of courseIds) {
    const evaluations = await evaluateCourse(courseId, config);
    await persist(evaluations);
    // Alerts for students who are no longer actively enrolled are stale.
    await prisma.riskAlert.deleteMany({
      where: { courseId, student: { enrollments: { none: { courseId, status: 'ACTIVE' } } } },
    });
    evaluated += evaluations.length;
    for (const e of evaluations) byLevel[e.level]++;
  }
  return { courses: courseIds.length, evaluated, byLevel, durationMs: Date.now() - started };
}

export async function recalculateForSchool(schoolId: string) {
  const config = await getRiskConfig(schoolId);
  const courses = await prisma.course.findMany({ where: { schoolId }, select: { id: true } });
  return recalculateCourses(
    courses.map((c) => c.id),
    config,
  );
}

/** Manual recalculation endpoint: teachers recalculate their courses, admins the whole school. */
export async function recalculate(user: AuthUser, courseId?: string) {
  if (courseId) await assertCourseAccess(prisma, user, courseId, { manage: true });
  const courses = await prisma.course.findMany({
    where: { AND: [courseScope(user), courseId ? { id: courseId } : {}] },
    select: { id: true },
  });
  return recalculateCourses(
    courses.map((c) => c.id),
    await getRiskConfig(user.schoolId),
  );
}

/**
 * Incremental recalculation after grades/attendance change, limited to the
 * affected students. Failures are logged, not thrown: the write that triggered
 * it has already been committed and must not be reported as failed.
 */
export async function onPerformanceDataChanged(
  courseId: string,
  studentIds?: string[],
): Promise<void> {
  try {
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: { schoolId: true },
    });
    if (!course) return;
    const config = await getRiskConfig(course.schoolId);
    await persist(await evaluateCourse(courseId, config, studentIds));
  } catch (err) {
    logger.error({ err, courseId }, 'Risk recalculation failed');
  }
}

// ── Alert queries ───────────────────────────────────────────────────────────

const alertSelect = {
  id: true,
  level: true,
  previousLevel: true,
  score: true,
  factors: true,
  metrics: true,
  status: true,
  computedAt: true,
  acknowledgedAt: true,
  note: true,
  student: {
    select: { id: true, studentNumber: true, firstName: true, lastName: true, gradeLevel: true },
  },
  course: { select: { id: true, code: true, name: true } },
} satisfies Prisma.RiskAlertSelect;

export async function listAlerts(
  user: AuthUser,
  q: Pagination & {
    level?: RiskLevel;
    minLevel?: RiskLevel;
    status?: AlertStatus;
    courseId?: string;
    studentId?: string;
  },
) {
  const where: Prisma.RiskAlertWhereInput = {
    course: courseScope(user),
    courseId: q.courseId,
    studentId: q.studentId,
    status: q.status,
    level: q.level ?? (q.minLevel ? { in: levelsAtLeast(q.minLevel) } : undefined),
  };
  const [items, total] = await prisma.$transaction([
    prisma.riskAlert.findMany({
      where,
      select: alertSelect,
      orderBy: [{ score: 'desc' }, { computedAt: 'desc' }],
      ...toSkipTake(q),
    }),
    prisma.riskAlert.count({ where }),
  ]);
  return buildPage(items, total, q);
}

export async function getAlert(user: AuthUser, id: string) {
  const alert = await prisma.riskAlert.findFirst({
    where: { id, course: courseScope(user) },
    select: alertSelect,
  });
  if (!alert) throw notFound('Risk alert');
  return alert;
}

export async function updateAlert(
  user: AuthUser,
  id: string,
  input: { status: AlertStatus; note?: string | null },
) {
  const alert = await getAlert(user, id);
  await assertCourseAccess(prisma, user, alert.course.id, { manage: true });
  return prisma.riskAlert.update({
    where: { id },
    data: {
      status: input.status,
      note: input.note === undefined ? undefined : input.note,
      acknowledgedAt: input.status === 'OPEN' ? null : new Date(),
      acknowledgedById: input.status === 'OPEN' ? null : user.id,
    },
    select: alertSelect,
  });
}

/** A student's own alerts, used by the student dashboard (includes suggestions). */
export async function getStudentRisk(user: AuthUser, studentId: string) {
  await assertStudentAccess(prisma, user, studentId);
  return prisma.riskAlert.findMany({
    where: { studentId, course: courseScope(user) },
    select: alertSelect,
    orderBy: { score: 'desc' },
  });
}
