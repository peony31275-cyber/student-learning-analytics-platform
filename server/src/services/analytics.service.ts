/**
 * Learning analytics.
 *
 * Pattern used throughout:
 *   1. resolve the course ids the caller may see with the normal Prisma scope
 *      (same authorization rules as every other endpoint)
 *   2. aggregate in PostgreSQL with parameterized SQL (GROUP BY, FILTER,
 *      date_trunc) so only summary rows cross the network
 *
 * All SQL uses Prisma's tagged templates: values are sent as bind parameters,
 * never concatenated, which rules out SQL injection.
 */
import { evaluateCourse, getRiskConfig } from './risk.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { RiskLevel } from '../generated/prisma/enums.js';
import { prisma } from '../lib/prisma.js';
import type { AuthUser } from '../types/auth.js';
import { round } from '../utils/number.js';
import { assertStudentAccess, courseScope } from './access.service.js';

export interface AnalyticsFilter {
  courseId?: string;
  term?: string;
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const pct = (v: unknown) => {
  const n = num(v);
  return n === null ? null : round(n);
};
const rate = (part: number, whole: number) => (whole > 0 ? round((part / whole) * 100) : null);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

async function scopedCourses(user: AuthUser, f: AnalyticsFilter) {
  return prisma.course.findMany({
    where: { AND: [courseScope(user), f.courseId ? { id: f.courseId } : {}, f.term ? { term: f.term } : {}] },
    select: { id: true, code: true, name: true },
    orderBy: { code: 'asc' },
  });
}

/** Joining on the ACTIVE enrollment keeps dropped students out of every statistic. */
const activeGradesFrom = (ids: string[]) => Prisma.sql`
  FROM grades g
  JOIN assessments a ON a.id = g."assessmentId"
  JOIN enrollments e ON e."studentId" = g."studentId" AND e."courseId" = a."courseId" AND e.status = 'ACTIVE'
  WHERE a."courseId" = ANY(${ids}::uuid[])`;

const weightedAvg = Prisma.sql`
  SUM(g.score / a."maxScore" * 100 * a.weight) FILTER (WHERE g.score IS NOT NULL)
  / NULLIF(SUM(a.weight) FILTER (WHERE g.score IS NOT NULL), 0)`;

const activeAttendanceFrom = (ids: string[]) => Prisma.sql`
  FROM attendance t
  JOIN enrollments e ON e."studentId" = t."studentId" AND e."courseId" = t."courseId" AND e.status = 'ACTIVE'
  WHERE t."courseId" = ANY(${ids}::uuid[])`;

const emptyLevels = (): Record<RiskLevel, number> => ({ LOW: 0, MEDIUM: 0, HIGH: 0 });

// ── Overview ────────────────────────────────────────────────────────────────

export async function overview(user: AuthUser, f: AnalyticsFilter) {
  const courses = await scopedCourses(user, f);
  const ids = courses.map((c) => c.id);
  if (ids.length === 0) {
    return {
      courses: 0, students: 0, assessments: 0, averageScore: null, attendanceRate: null,
      completionRate: null, riskDistribution: emptyLevels(), atRiskStudents: 0, openAlerts: 0,
    };
  }

  const [gradeRow] = await prisma.$queryRaw<{ avg: unknown; completed: number; expected: number }[]>`
    SELECT ${weightedAvg} AS avg,
           COUNT(*) FILTER (WHERE g.status IN ('SUBMITTED', 'LATE'))::int AS completed,
           COUNT(*) FILTER (WHERE g.status <> 'EXCUSED')::int AS expected
    ${activeGradesFrom(ids)}`;
  const [attRow] = await prisma.$queryRaw<{ attended: number; counted: number }[]>`
    SELECT COUNT(*) FILTER (WHERE t.status IN ('PRESENT', 'LATE'))::int AS attended,
           COUNT(*) FILTER (WHERE t.status <> 'EXCUSED')::int AS counted
    ${activeAttendanceFrom(ids)}`;

  const [students, assessments, levels, atRisk, openAlerts] = await Promise.all([
    prisma.enrollment.findMany({ where: { courseId: { in: ids }, status: 'ACTIVE' }, distinct: ['studentId'], select: { studentId: true } }),
    prisma.assessment.count({ where: { courseId: { in: ids } } }),
    prisma.riskAlert.groupBy({ by: ['level'], where: { courseId: { in: ids } }, _count: { _all: true } }),
    prisma.riskAlert.findMany({
      where: { courseId: { in: ids }, level: { in: ['MEDIUM', 'HIGH'] } },
      distinct: ['studentId'],
      select: { studentId: true },
    }),
    prisma.riskAlert.count({ where: { courseId: { in: ids }, status: 'OPEN', level: { in: ['MEDIUM', 'HIGH'] } } }),
  ]);

  const riskDistribution = emptyLevels();
  for (const l of levels) riskDistribution[l.level] = l._count._all;

  return {
    courses: ids.length,
    students: students.length,
    assessments,
    averageScore: pct(gradeRow?.avg),
    attendanceRate: rate(attRow?.attended ?? 0, attRow?.counted ?? 0),
    completionRate: rate(gradeRow?.completed ?? 0, gradeRow?.expected ?? 0),
    riskDistribution,
    atRiskStudents: atRisk.length,
    openAlerts,
  };
}

// ── Score trends ────────────────────────────────────────────────────────────

export async function scoreTrends(user: AuthUser, f: AnalyticsFilter) {
  const courses = await scopedCourses(user, f);
  const ids = courses.map((c) => c.id);
  if (ids.length === 0) return { overall: [], byCourse: [] };

  const rows = await prisma.$queryRaw<{ period: Date; courseId: string; avg: unknown; graded: number }[]>`
    SELECT date_trunc('week', a."dueDate") AS period, a."courseId" AS "courseId",
           ${weightedAvg} AS avg,
           COUNT(g.id) FILTER (WHERE g.score IS NOT NULL)::int AS graded
    ${activeGradesFrom(ids)}
    GROUP BY 1, 2
    ORDER BY 1`;
  const overallRows = await prisma.$queryRaw<{ period: Date; avg: unknown; graded: number }[]>`
    SELECT date_trunc('week', a."dueDate") AS period, ${weightedAvg} AS avg,
           COUNT(g.id) FILTER (WHERE g.score IS NOT NULL)::int AS graded
    ${activeGradesFrom(ids)}
    GROUP BY 1
    ORDER BY 1`;

  return {
    overall: overallRows.map((r) => ({ period: isoDay(r.period), averagePercent: pct(r.avg), gradedCount: r.graded })),
    byCourse: courses.map((c) => ({
      courseId: c.id,
      code: c.code,
      name: c.name,
      points: rows.filter((r) => r.courseId === c.id).map((r) => ({ period: isoDay(r.period), averagePercent: pct(r.avg) })),
    })),
  };
}

// ── Course comparison ───────────────────────────────────────────────────────

export async function courseComparison(user: AuthUser, f: AnalyticsFilter) {
  const courses = await scopedCourses(user, f);
  const ids = courses.map((c) => c.id);
  if (ids.length === 0) return [];

  const [gradeRows, attRows, enrollmentCounts, alertCounts] = await Promise.all([
    prisma.$queryRaw<{ courseId: string; avg: unknown; completed: number; expected: number }[]>`
      SELECT a."courseId" AS "courseId", ${weightedAvg} AS avg,
             COUNT(*) FILTER (WHERE g.status IN ('SUBMITTED', 'LATE'))::int AS completed,
             COUNT(*) FILTER (WHERE g.status <> 'EXCUSED')::int AS expected
      ${activeGradesFrom(ids)}
      GROUP BY 1`,
    prisma.$queryRaw<{ courseId: string; attended: number; counted: number }[]>`
      SELECT t."courseId" AS "courseId",
             COUNT(*) FILTER (WHERE t.status IN ('PRESENT', 'LATE'))::int AS attended,
             COUNT(*) FILTER (WHERE t.status <> 'EXCUSED')::int AS counted
      ${activeAttendanceFrom(ids)}
      GROUP BY 1`,
    prisma.enrollment.groupBy({ by: ['courseId'], where: { courseId: { in: ids }, status: 'ACTIVE' }, _count: { _all: true } }),
    prisma.riskAlert.groupBy({ by: ['courseId', 'level'], where: { courseId: { in: ids } }, _count: { _all: true } }),
  ]);

  return courses.map((c) => {
    const g = gradeRows.find((r) => r.courseId === c.id);
    const a = attRows.find((r) => r.courseId === c.id);
    const risk = emptyLevels();
    for (const r of alertCounts.filter((x) => x.courseId === c.id)) risk[r.level] = r._count._all;
    return {
      courseId: c.id,
      code: c.code,
      name: c.name,
      students: enrollmentCounts.find((e) => e.courseId === c.id)?._count._all ?? 0,
      averageScore: pct(g?.avg),
      completionRate: rate(g?.completed ?? 0, g?.expected ?? 0),
      attendanceRate: rate(a?.attended ?? 0, a?.counted ?? 0),
      risk,
    };
  });
}

// ── Attendance ──────────────────────────────────────────────────────────────

export async function attendanceAnalytics(user: AuthUser, f: AnalyticsFilter) {
  const ids = (await scopedCourses(user, f)).map((c) => c.id);
  if (ids.length === 0) return { weekly: [], distribution: [] };

  const weekly = await prisma.$queryRaw<
    { period: Date; present: number; late: number; absent: number; excused: number }[]
  >`
    SELECT date_trunc('week', t.date) AS period,
           COUNT(*) FILTER (WHERE t.status = 'PRESENT')::int AS present,
           COUNT(*) FILTER (WHERE t.status = 'LATE')::int AS late,
           COUNT(*) FILTER (WHERE t.status = 'ABSENT')::int AS absent,
           COUNT(*) FILTER (WHERE t.status = 'EXCUSED')::int AS excused
    ${activeAttendanceFrom(ids)}
    GROUP BY 1
    ORDER BY 1`;

  // Per-enrollment attendance rates bucketed into bands, computed in one query.
  const buckets = await prisma.$queryRaw<{ band: string; count: number }[]>`
    WITH rates AS (
      SELECT t."studentId", t."courseId",
             COUNT(*) FILTER (WHERE t.status IN ('PRESENT', 'LATE'))::float
               / NULLIF(COUNT(*) FILTER (WHERE t.status <> 'EXCUSED'), 0) * 100 AS rate
      ${activeAttendanceFrom(ids)}
      GROUP BY 1, 2
    )
    SELECT CASE WHEN rate >= 95 THEN '95-100'
                WHEN rate >= 90 THEN '90-95'
                WHEN rate >= 80 THEN '80-90'
                WHEN rate >= 70 THEN '70-80'
                ELSE '<70' END AS band,
           COUNT(*)::int AS count
    FROM rates WHERE rate IS NOT NULL
    GROUP BY 1`;
  const order = ['<70', '70-80', '80-90', '90-95', '95-100'];

  return {
    weekly: weekly.map((w) => ({
      period: isoDay(w.period),
      present: w.present,
      late: w.late,
      absent: w.absent,
      excused: w.excused,
      attendanceRate: rate(w.present + w.late, w.present + w.late + w.absent),
    })),
    distribution: order.map((band) => ({ band, count: buckets.find((b) => b.band === band)?.count ?? 0 })),
  };
}

// ── Risk distribution ───────────────────────────────────────────────────────

export async function riskDistribution(user: AuthUser, f: AnalyticsFilter) {
  const courses = await scopedCourses(user, f);
  const ids = courses.map((c) => c.id);
  if (ids.length === 0) return { totals: emptyLevels(), byCourse: [], topFactors: [] };

  const [grouped, flagged] = await Promise.all([
    prisma.riskAlert.groupBy({ by: ['courseId', 'level'], where: { courseId: { in: ids } }, _count: { _all: true } }),
    prisma.riskAlert.findMany({ where: { courseId: { in: ids }, level: { in: ['MEDIUM', 'HIGH'] } }, select: { factors: true } }),
  ]);

  const totals = emptyLevels();
  for (const g of grouped) totals[g.level] += g._count._all;

  // Which rules drive the alerts most often (explainability at the class level).
  const factorCounts = new Map<string, number>();
  for (const a of flagged) {
    for (const factor of (a.factors as { rule: string }[] | null) ?? []) {
      factorCounts.set(factor.rule, (factorCounts.get(factor.rule) ?? 0) + 1);
    }
  }

  return {
    totals,
    byCourse: courses.map((c) => {
      const levels = emptyLevels();
      for (const g of grouped.filter((x) => x.courseId === c.id)) levels[g.level] = g._count._all;
      return { courseId: c.id, code: c.code, ...levels };
    }),
    topFactors: [...factorCounts.entries()].map(([rule, count]) => ({ rule, count })).sort((a, b) => b.count - a.count),
  };
}

// ── Single-student progress ─────────────────────────────────────────────────

export async function studentProgress(user: AuthUser, studentId: string) {
  await assertStudentAccess(prisma, user, studentId);
  const enrollments = await prisma.enrollment.findMany({
    where: { studentId, status: 'ACTIVE', course: courseScope(user) },
    select: { course: { select: { id: true, code: true, name: true, schoolId: true } } },
    orderBy: { course: { code: 'asc' } },
  });
  if (enrollments.length === 0) return { courses: [], timeline: [], attendanceWeekly: [] };
  const courseIds = enrollments.map((e) => e.course.id);
  const config = await getRiskConfig(enrollments[0]!.course.schoolId);

  const [evaluations, alerts, timeline, attendanceWeekly] = await Promise.all([
    Promise.all(courseIds.map((id) => evaluateCourse(id, config, [studentId]))),
    prisma.riskAlert.findMany({ where: { studentId, courseId: { in: courseIds } }, select: { courseId: true, level: true, score: true } }),
    // Student's score on each assessment next to the class average for the same assessment.
    prisma.$queryRaw<
      { assessmentId: string; title: string; type: string; dueDate: Date; courseId: string; percent: unknown; status: string; classAvg: unknown }[]
    >`
      SELECT a.id AS "assessmentId", a.title, a.type::text AS type, a."dueDate" AS "dueDate", a."courseId" AS "courseId",
             mine.score / a."maxScore" * 100 AS percent, mine.status::text AS status,
             (SELECT AVG(g2.score / a."maxScore" * 100) FROM grades g2
               WHERE g2."assessmentId" = a.id AND g2.score IS NOT NULL) AS "classAvg"
      FROM assessments a
      JOIN grades mine ON mine."assessmentId" = a.id AND mine."studentId" = ${studentId}::uuid
      WHERE a."courseId" = ANY(${courseIds}::uuid[])
      ORDER BY a."dueDate"`,
    prisma.$queryRaw<{ period: Date; attended: number; counted: number }[]>`
      SELECT date_trunc('week', t.date) AS period,
             COUNT(*) FILTER (WHERE t.status IN ('PRESENT', 'LATE'))::int AS attended,
             COUNT(*) FILTER (WHERE t.status <> 'EXCUSED')::int AS counted
      FROM attendance t
      WHERE t."studentId" = ${studentId}::uuid AND t."courseId" = ANY(${courseIds}::uuid[])
      GROUP BY 1 ORDER BY 1`,
  ]);

  const codeById = new Map(enrollments.map((e) => [e.course.id, e.course.code]));
  return {
    courses: enrollments.map(({ course }, i) => {
      const m = evaluations[i]![0]?.metrics;
      const alert = alerts.find((a) => a.courseId === course.id);
      return {
        courseId: course.id,
        code: course.code,
        name: course.name,
        averageScore: m?.averagePercent ?? null,
        recentAverage: m?.recentAverage ?? null,
        trendDelta: m?.trendDelta ?? null,
        attendanceRate: m?.attendanceRate ?? null,
        completionRate: m?.completionRate ?? null,
        missingCount: m?.missingCount ?? 0,
        riskLevel: alert?.level ?? null,
        riskScore: alert?.score ?? null,
      };
    }),
    timeline: timeline.map((t) => ({
      assessmentId: t.assessmentId,
      title: t.title,
      type: t.type,
      dueDate: isoDay(t.dueDate),
      courseId: t.courseId,
      courseCode: codeById.get(t.courseId) ?? '',
      percent: pct(t.percent),
      classAverage: pct(t.classAvg),
      status: t.status,
    })),
    attendanceWeekly: attendanceWeekly.map((w) => ({ period: isoDay(w.period), attendanceRate: rate(w.attended, w.counted) })),
  };
}
