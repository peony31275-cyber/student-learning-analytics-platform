import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { nextStatus } from '../src/services/risk.service.js';
import { type World, buildWorld, createStudent, enroll, loginAs, resetDb } from './helpers/factories.js';

/**
 * Builds course A with 4 assessments (max 100, weight 1) and 6 class sessions:
 *  - studentA ("struggling"): 85, 80, 50, 45 · 2 missing sessions → 66.7% attendance
 *  - good student:             90, 92, 94, 96 · perfect attendance
 */
async function seedCourseA(w: World) {
  const good = await createStudent(w.school.id, { lastName: 'Good' });
  await enroll(good.id, w.courseA.id);

  const scores = { [w.studentA.id]: [85, 80, 50, 45], [good.id]: [90, 92, 94, 96] };
  for (let i = 0; i < 4; i++) {
    const a = await prisma.assessment.create({
      data: { courseId: w.courseA.id, title: `A${i}`, type: 'QUIZ', maxScore: 100, weight: 1, dueDate: new Date(Date.UTC(2026, 8, 7 + i * 7)) },
    });
    for (const [studentId, s] of Object.entries(scores)) {
      await prisma.grade.create({ data: { assessmentId: a.id, studentId, score: s[i]! } });
    }
  }
  for (let d = 0; d < 6; d++) {
    const date = new Date(Date.UTC(2026, 8, 7 + d * 2));
    await prisma.attendance.create({ data: { courseId: w.courseA.id, studentId: good.id, date, status: 'PRESENT' } });
    await prisma.attendance.create({ data: { courseId: w.courseA.id, studentId: w.studentA.id, date, status: d < 2 ? 'ABSENT' : 'PRESENT' } });
  }
  return { good };
}

describe('Early warning engine (persisted)', () => {
  let w: World;
  beforeEach(async () => {
    await resetDb();
    w = await buildWorld();
  });

  it('recalculation persists one explainable alert per enrollment', async () => {
    const { good } = await seedCourseA(w);
    const teacher = await loginAs(w.teacherA.email);

    const res = await teacher.post('/api/v1/risk-alerts/recalculate').send({});
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ courses: 1, evaluated: 2, byLevel: { LOW: 1, HIGH: 1, MEDIUM: 0 } });

    const alerts = await prisma.riskAlert.findMany();
    expect(alerts).toHaveLength(2);
    const risky = alerts.find((a) => a.studentId === w.studentA.id)!;
    expect(risky.level).toBe('HIGH');
    expect(risky.status).toBe('OPEN');
    const rules = (risky.factors as { rule: string }[]).map((f) => f.rule);
    expect(rules).toEqual(expect.arrayContaining(['recentPerformance', 'decliningTrend', 'attendance']));
    expect(risky.metrics).toMatchObject({ recentAverage: 58.3, attendanceRate: 66.7 });

    const fine = alerts.find((a) => a.studentId === good.id)!;
    expect(fine).toMatchObject({ level: 'LOW', score: 0, status: 'RESOLVED' });

    // Idempotent: recalculating again does not create duplicates.
    await teacher.post('/api/v1/risk-alerts/recalculate').send({});
    expect(await prisma.riskAlert.count()).toBe(2);
  });

  it('lists alerts with filters, ordered by score; teachers only see their courses', async () => {
    await seedCourseA(w);
    await (await loginAs(w.admin.email)).post('/api/v1/risk-alerts/recalculate').send({});

    const teacherA = await loginAs(w.teacherA.email);
    const high = await teacherA.get('/api/v1/risk-alerts?minLevel=MEDIUM');
    expect(high.body.data).toHaveLength(1);
    expect(high.body.data[0]).toMatchObject({ level: 'HIGH', student: { id: w.studentA.id }, course: { id: w.courseA.id } });

    const teacherB = await loginAs(w.teacherB.email);
    const none = await teacherB.get('/api/v1/risk-alerts');
    expect(none.body.data.every((a: { course: { id: string } }) => a.course.id === w.courseB.id)).toBe(true);
    expect((await teacherB.get(`/api/v1/risk-alerts/${high.body.data[0].id}`)).status).toBe(404);
  });

  it('teacher acknowledges an alert; the status survives recalculation unless risk escalates', async () => {
    await seedCourseA(w);
    const teacher = await loginAs(w.teacherA.email);
    await teacher.post('/api/v1/risk-alerts/recalculate').send({});
    const alert = (await teacher.get('/api/v1/risk-alerts?level=HIGH')).body.data[0];

    const ack = await teacher.patch(`/api/v1/risk-alerts/${alert.id}`).send({ status: 'ACKNOWLEDGED', note: 'Met with student' });
    expect(ack.body.data).toMatchObject({ status: 'ACKNOWLEDGED', note: 'Met with student' });

    await teacher.post('/api/v1/risk-alerts/recalculate').send({});
    expect((await prisma.riskAlert.findUniqueOrThrow({ where: { id: alert.id } })).status).toBe('ACKNOWLEDGED');
  });

  it('nextStatus implements the alert lifecycle', () => {
    expect(nextStatus(undefined, 'HIGH')).toBe('OPEN');
    expect(nextStatus(undefined, 'LOW')).toBe('RESOLVED');
    expect(nextStatus({ level: 'MEDIUM', status: 'ACKNOWLEDGED' }, 'HIGH')).toBe('OPEN'); // escalation reopens
    expect(nextStatus({ level: 'HIGH', status: 'ACKNOWLEDGED' }, 'MEDIUM')).toBe('ACKNOWLEDGED');
    expect(nextStatus({ level: 'HIGH', status: 'RESOLVED' }, 'HIGH')).toBe('OPEN'); // still at risk
  });

  it('entering grades triggers an incremental recalculation for that student', async () => {
    const teacher = await loginAs(w.teacherA.email);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await teacher.post(`/api/v1/courses/${w.courseA.id}/assessments`).send({
        title: `Q${i}`, type: 'QUIZ', maxScore: 10, dueDate: `2026-09-1${i}`,
      });
      ids.push(res.body.data.id);
    }
    for (const id of ids) {
      await teacher.put(`/api/v1/assessments/${id}/grades`).send({ grades: [{ studentId: w.studentA.id, score: 4 }] });
    }
    const alert = await prisma.riskAlert.findUniqueOrThrow({
      where: { studentId_courseId: { studentId: w.studentA.id, courseId: w.courseA.id } },
    });
    expect(alert.level).not.toBe('LOW');
    expect((alert.factors as { rule: string }[])[0]!.rule).toBe('recentPerformance');
  });

  it('admin updates risk thresholds (validated) and alerts are recalculated; teachers cannot', async () => {
    await seedCourseA(w);
    const teacher = await loginAs(w.teacherA.email);
    expect((await teacher.put('/api/v1/settings/risk').send({})).status).toBe(403);
    expect((await teacher.get('/api/v1/settings/risk')).body.data.levels).toEqual({ medium: 25, high: 50 });

    const admin = await loginAs(w.admin.email);
    const bad = await admin.put('/api/v1/settings/risk').send({ levels: { medium: 80, high: 20 } });
    expect(bad.status).toBe(400);

    // Raising the HIGH threshold to 100 makes the struggling student MEDIUM instead of HIGH.
    const res = await admin.put('/api/v1/settings/risk').send({ levels: { medium: 25, high: 100 } });
    expect(res.status).toBe(200);
    expect(res.body.data.recalculation.byLevel.HIGH).toBe(0);
    const alert = await prisma.riskAlert.findFirstOrThrow({ where: { studentId: w.studentA.id } });
    expect(alert.level).toBe('MEDIUM');
    expect(alert.previousLevel).toBe(null);
  });

  it('removes alerts for students who dropped the course', async () => {
    await seedCourseA(w);
    const teacher = await loginAs(w.teacherA.email);
    await teacher.post('/api/v1/risk-alerts/recalculate').send({});
    const enrollment = await prisma.enrollment.findFirstOrThrow({ where: { studentId: w.studentA.id, courseId: w.courseA.id } });
    await teacher.patch(`/api/v1/enrollments/${enrollment.id}`).send({ status: 'DROPPED' });
    await teacher.post('/api/v1/risk-alerts/recalculate').send({});
    expect(await prisma.riskAlert.count({ where: { studentId: w.studentA.id } })).toBe(0);
  });

  it('a student can read their own risk explanation but not alerts lists', async () => {
    await seedCourseA(w);
    await (await loginAs(w.teacherA.email)).post('/api/v1/risk-alerts/recalculate').send({});
    const student = await loginAs(w.studentUser.email);
    const own = await student.get(`/api/v1/students/${w.studentA.id}/risk`);
    expect(own.status).toBe(200);
    expect(own.body.data[0].factors[0]).toHaveProperty('suggestion');
    expect((await student.get('/api/v1/risk-alerts')).status).toBe(403);
    expect((await student.get(`/api/v1/students/${w.studentB.id}/risk`)).status).toBe(404);
  });
});

describe('Analytics API', () => {
  let w: World;
  beforeEach(async () => {
    await resetDb();
    w = await buildWorld();
    await seedCourseA(w);
    await (await loginAs(w.admin.email)).post('/api/v1/risk-alerts/recalculate').send({});
  });

  it('overview aggregates scores, attendance, completion and risk for the caller’s scope', async () => {
    const teacher = await loginAs(w.teacherA.email);
    const res = await teacher.get('/api/v1/analytics/overview');
    expect(res.status).toBe(200);
    // mean of all 8 grades: (85+80+50+45+90+92+94+96)/8 = 79
    expect(res.body.data).toMatchObject({
      courses: 1,
      students: 2,
      assessments: 4,
      averageScore: 79,
      attendanceRate: 83.3, // 10 of 12 sessions
      completionRate: 100,
      riskDistribution: { LOW: 1, MEDIUM: 0, HIGH: 1 },
      atRiskStudents: 1,
      openAlerts: 1,
    });

    const other = await loginAs(w.teacherB.email);
    const otherRes = await other.get('/api/v1/analytics/overview');
    expect(otherRes.body.data).toMatchObject({ courses: 1, students: 1, averageScore: null });
  });

  it('excludes dropped students from statistics', async () => {
    const e = await prisma.enrollment.findFirstOrThrow({ where: { studentId: w.studentA.id, courseId: w.courseA.id } });
    await prisma.enrollment.update({ where: { id: e.id }, data: { status: 'DROPPED' } });
    const res = await (await loginAs(w.teacherA.email)).get('/api/v1/analytics/overview');
    expect(res.body.data.averageScore).toBe(93); // only the good student
    expect(res.body.data.students).toBe(1);
  });

  it('score trends are bucketed by week, overall and per course', async () => {
    const res = await (await loginAs(w.teacherA.email)).get('/api/v1/analytics/score-trends');
    expect(res.body.data.overall).toEqual([
      { period: '2026-09-07', averagePercent: 87.5, gradedCount: 2 },
      { period: '2026-09-14', averagePercent: 86, gradedCount: 2 },
      { period: '2026-09-21', averagePercent: 72, gradedCount: 2 },
      { period: '2026-09-28', averagePercent: 70.5, gradedCount: 2 },
    ]);
    expect(res.body.data.byCourse[0].points).toHaveLength(4);
  });

  it('course comparison, attendance and risk distribution', async () => {
    const admin = await loginAs(w.admin.email);
    const cmp = await admin.get('/api/v1/analytics/course-comparison');
    expect(cmp.body.data).toHaveLength(2);
    expect(cmp.body.data.find((c: { courseId: string }) => c.courseId === w.courseA.id)).toMatchObject({
      students: 2, averageScore: 79, attendanceRate: 83.3, risk: { HIGH: 1, LOW: 1 },
    });

    const att = await admin.get(`/api/v1/analytics/attendance?courseId=${w.courseA.id}`);
    const totals = att.body.data.weekly.reduce((s: number, x: { present: number; absent: number }) => s + x.present + x.absent, 0);
    expect(totals).toBe(12);
    expect(att.body.data.distribution).toEqual([
      { band: '<70', count: 1 }, { band: '70-80', count: 0 }, { band: '80-90', count: 0 }, { band: '90-95', count: 0 }, { band: '95-100', count: 1 },
    ]);

    const risk = await admin.get('/api/v1/analytics/risk-distribution');
    expect(risk.body.data.totals).toEqual({ LOW: 2, MEDIUM: 0, HIGH: 1 });
    expect(risk.body.data.topFactors.map((f: { rule: string }) => f.rule)).toContain('attendance');
  });

  it('student progress compares each score with the class average', async () => {
    const student = await loginAs(w.studentUser.email);
    const res = await student.get(`/api/v1/analytics/students/${w.studentA.id}/progress`);
    expect(res.status).toBe(200);
    expect(res.body.data.courses[0]).toMatchObject({ courseId: w.courseA.id, averageScore: 65, riskLevel: 'HIGH' });
    expect(res.body.data.timeline[0]).toMatchObject({ percent: 85, classAverage: 87.5 });
    expect((await student.get(`/api/v1/analytics/students/${w.studentB.id}/progress`)).status).toBe(404);
    expect((await student.get('/api/v1/analytics/overview')).status).toBe(403);
  });
});
