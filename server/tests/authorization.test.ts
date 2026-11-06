/**
 * Authorization matrix: verifies the backend enforces RBAC and row-level
 * scoping regardless of what the UI shows.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { type World, buildWorld, loginAs, resetDb } from './helpers/factories.js';

describe('Authorization (RBAC + data scoping)', () => {
  let w: World;
  beforeEach(async () => {
    await resetDb();
    w = await buildWorld();
  });

  describe('role-based access', () => {
    it('only admins can manage users', async () => {
      const admin = await loginAs(w.admin.email);
      const teacher = await loginAs(w.teacherA.email);
      const student = await loginAs(w.studentUser.email);

      expect((await admin.get('/api/v1/users')).status).toBe(200);
      expect((await teacher.get('/api/v1/users')).status).toBe(403);
      expect((await student.get('/api/v1/users')).status).toBe(403);
      expect((await teacher.post('/api/v1/users').send({})).status).toBe(403);
    });

    it('students cannot list students, create courses or record grades', async () => {
      const student = await loginAs(w.studentUser.email);
      expect((await student.get('/api/v1/students')).status).toBe(403);
      expect((await student.post('/api/v1/courses').send({})).status).toBe(403);
      expect((await student.get(`/api/v1/courses/${w.courseA.id}/students`)).status).toBe(403);
      expect(
        (await student.put(`/api/v1/courses/${w.courseA.id}/attendance`).send({})).status,
      ).toBe(403);
    });

    it('only admins can delete courses', async () => {
      const teacher = await loginAs(w.teacherA.email);
      expect((await teacher.delete(`/api/v1/courses/${w.courseA.id}`)).status).toBe(403);
      const admin = await loginAs(w.admin.email);
      expect((await admin.delete(`/api/v1/courses/${w.courseA.id}`)).status).toBe(204);
    });

    it('unauthenticated requests to protected routes get 401', async () => {
      const { default: request } = await import('supertest');
      const { app } = await import('./helpers/factories.js');
      expect((await request(app).get('/api/v1/students')).status).toBe(401);
      expect((await request(app).get('/api/v1/courses')).status).toBe(401);
    });
  });

  describe('teacher data scoping', () => {
    it("lists only students enrolled in the teacher's own courses", async () => {
      const teacher = await loginAs(w.teacherA.email);
      const res = await teacher.get('/api/v1/students');
      expect(res.status).toBe(200);
      expect(res.body.data.map((s: { id: string }) => s.id)).toEqual([w.studentA.id]);
      expect(res.body.meta.total).toBe(1);
    });

    it("returns 404 (not 403) for another teacher's student, to avoid leaking existence", async () => {
      const teacher = await loginAs(w.teacherA.email);
      const res = await teacher.get(`/api/v1/students/${w.studentB.id}`);
      expect(res.status).toBe(404);
    });

    it("cannot modify another teacher's course or its data", async () => {
      const teacher = await loginAs(w.teacherA.email);
      expect(
        (await teacher.patch(`/api/v1/courses/${w.courseB.id}`).send({ name: 'Hijacked' })).status,
      ).toBe(404);
      expect((await teacher.get(`/api/v1/courses/${w.courseB.id}/students`)).status).toBe(404);
      expect(
        (
          await teacher.post(`/api/v1/courses/${w.courseB.id}/assessments`).send({
            title: 'X',
            type: 'QUIZ',
            maxScore: 10,
            dueDate: '2026-10-01',
          })
        ).status,
      ).toBe(404);
      expect(
        (await teacher.patch(`/api/v1/students/${w.studentB.id}`).send({ firstName: 'X' })).status,
      ).toBe(404);
    });

    it("risk level, risk filter and course counts in the list only reflect the teacher's own courses", async () => {
      // studentB is HIGH risk in teacher B's course and LOW in teacher A's course.
      await prisma.enrollment.create({
        data: { studentId: w.studentB.id, courseId: w.courseA.id },
      });
      const base = { factors: [], metrics: {}, score: 0 };
      await prisma.riskAlert.createMany({
        data: [
          { ...base, studentId: w.studentB.id, courseId: w.courseB.id, level: 'HIGH', score: 80 },
          { ...base, studentId: w.studentB.id, courseId: w.courseA.id, level: 'LOW' },
        ],
      });
      const teacherA = await loginAs(w.teacherA.email);
      const list = await teacherA.get('/api/v1/students');
      const row = list.body.data.find((s: { id: string }) => s.id === w.studentB.id);
      expect(row).toMatchObject({ riskLevel: 'LOW', activeCourses: 1 });
      expect((await teacherA.get('/api/v1/students?riskLevel=HIGH')).body.data).toEqual([]);
      expect(
        (await teacherA.get('/api/v1/students?riskLevel=LOW')).body.data.map(
          (s: { id: string }) => s.id,
        ),
      ).toEqual([w.studentB.id]);

      const admin = await loginAs(w.admin.email);
      const adminRow = (await admin.get('/api/v1/students?riskLevel=HIGH')).body.data;
      expect(adminRow).toEqual([
        expect.objectContaining({ id: w.studentB.id, riskLevel: 'HIGH', activeCourses: 2 }),
      ]);
      expect((await admin.get('/api/v1/students?riskLevel=LOW')).body.data).toEqual([]);
    });

    it('cannot create a course on behalf of another teacher', async () => {
      const teacher = await loginAs(w.teacherA.email);
      const res = await teacher.post('/api/v1/courses').send({
        code: 'HACK-1',
        name: 'Hack',
        term: '2026-Fall',
        teacherId: w.teacherB.teacherProfile!.id,
      });
      expect(res.status).toBe(403);
    });
  });

  describe('student data scoping', () => {
    it('a student can read their own profile and grades but not another student', async () => {
      const student = await loginAs(w.studentUser.email);
      expect((await student.get(`/api/v1/students/${w.studentA.id}`)).status).toBe(200);
      expect((await student.get(`/api/v1/students/${w.studentA.id}/grades`)).status).toBe(200);
      expect((await student.get(`/api/v1/students/${w.studentB.id}`)).status).toBe(404);
      expect((await student.get(`/api/v1/students/${w.studentB.id}/grades`)).status).toBe(404);
    });

    it('a student only sees courses they are enrolled in', async () => {
      const student = await loginAs(w.studentUser.email);
      const res = await student.get('/api/v1/courses');
      expect(res.body.data.map((c: { id: string }) => c.id)).toEqual([w.courseA.id]);
      expect((await student.get(`/api/v1/courses/${w.courseB.id}`)).status).toBe(404);
    });
  });

  describe('tenant isolation', () => {
    it("an admin of another school sees none of this school's data", async () => {
      const other = await loginAs(w.otherAdmin.email);
      const list = await other.get('/api/v1/students');
      expect(list.body.data).toEqual([]);
      expect((await other.get(`/api/v1/students/${w.studentA.id}`)).status).toBe(404);
      expect((await other.get(`/api/v1/courses/${w.courseA.id}`)).status).toBe(404);
      expect((await other.get(`/api/v1/users/${w.teacherA.id}`)).status).toBe(404);
    });
  });

  it('rejects malformed ids with 400 before touching the database', async () => {
    const admin = await loginAs(w.admin.email);
    const res = await admin.get('/api/v1/students/not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
  describe('account security: RBAC and object-level authorization', () => {
    it('students cannot call any admin API', async () => {
      const student = await loginAs(w.studentUser.email);
      const attempts: [string, () => Promise<{ status: number }>][] = [
        ['list users', () => student.get('/api/v1/users')],
        ['read user', () => student.get(`/api/v1/users/${w.admin.id}`)],
        [
          'create admin',
          () =>
            student.post('/api/v1/users').send({
              role: 'ADMIN',
              email: 'x@evil.test',
              firstName: 'X',
              lastName: 'Y',
              password: 'Secret123',
            }),
        ],
        [
          'disable teacher',
          () => student.patch(`/api/v1/users/${w.teacherA.id}`).send({ isActive: false }),
        ],
        ['edit school', () => student.patch('/api/v1/school').send({ name: 'Hacked' })],
        ['edit risk rules', () => student.put('/api/v1/settings/risk').send({})],
        ['delete course', () => student.delete(`/api/v1/courses/${w.courseA.id}`)],
        ['issue invite', () => student.post(`/api/v1/students/${w.studentA.id}/activation-invite`)],
      ];
      for (const [label, call] of attempts)
        expect([label, (await call()).status]).toEqual([label, 403]);
      expect(await prisma.user.count({ where: { email: 'x@evil.test' } })).toBe(0);
    });

    it('teachers cannot create admin, teacher or student accounts', async () => {
      const teacher = await loginAs(w.teacherA.email);
      for (const role of ['ADMIN', 'TEACHER', 'STUDENT']) {
        const res = await teacher.post('/api/v1/users').send({
          role,
          email: `${role.toLowerCase()}@evil.test`,
          firstName: 'E',
          lastName: 'Vil',
          password: 'Secret123',
          studentId: w.studentB.id,
        });
        expect([role, res.status]).toEqual([role, 403]);
      }
      expect(await prisma.user.count({ where: { email: { endsWith: '@evil.test' } } })).toBe(0);
    });

    it("teachers cannot reach another teacher's student or course by changing ids in the URL", async () => {
      const teacher = await loginAs(w.teacherA.email);
      const [s, c] = [w.studentB.id, w.courseB.id];
      for (const path of [
        `/api/v1/students/${s}`,
        `/api/v1/students/${s}/grades`,
        `/api/v1/students/${s}/attendance`,
        `/api/v1/students/${s}/risk`,
        `/api/v1/analytics/students/${s}/progress`,
        `/api/v1/courses/${c}`,
        `/api/v1/courses/${c}/students`,
        `/api/v1/courses/${c}/assessments`,
        `/api/v1/courses/${c}/attendance?date=2026-11-02`,
        `/api/v1/courses/${c}/attendance/sessions`,
      ]) {
        expect([path, (await teacher.get(path)).status]).toEqual([path, 404]);
      }
      const writes: [string, () => Promise<{ status: number }>][] = [
        [
          'edit student',
          () => teacher.patch(`/api/v1/students/${s}`).send({ firstName: 'Changed' }),
        ],
        ['invite student', () => teacher.post(`/api/v1/students/${s}/activation-invite`)],
        ['enroll', () => teacher.post('/api/v1/enrollments').send({ studentId: s, courseId: c })],
        [
          'take attendance',
          () =>
            teacher.put(`/api/v1/courses/${c}/attendance`).send({
              date: '2026-11-02',
              records: [{ studentId: s, status: 'ABSENT' }],
            }),
        ],
      ];
      for (const [label, call] of writes)
        expect([label, (await call()).status]).toEqual([label, 404]);

      // Scoped lists leave the other teacher's student out entirely.
      const alerts = await teacher.get(`/api/v1/risk-alerts?studentId=${s}`);
      expect([alerts.status, alerts.body.data]).toEqual([200, []]);
      const after = await prisma.studentProfile.findUniqueOrThrow({ where: { id: s } });
      expect(after.firstName).not.toBe('Changed');
      expect(await prisma.activationToken.count()).toBe(0);
      expect(await prisma.attendance.count({ where: { studentId: s } })).toBe(0);
    });

    it('disabled users cannot access protected resources, even with a session they already had', async () => {
      const teacher = await loginAs(w.teacherA.email);
      expect((await teacher.get('/api/v1/courses')).status).toBe(200);
      const admin = await loginAs(w.admin.email);
      const disable = await admin.patch(`/api/v1/users/${w.teacherA.id}`).send({ isActive: false });
      expect(disable.status).toBe(200);

      for (const path of [
        '/api/v1/courses',
        `/api/v1/students/${w.studentA.id}`,
        '/api/v1/auth/me',
      ]) {
        expect([path, (await teacher.get(path)).status]).toEqual([path, 401]);
      }
      await expect(loginAs(w.teacherA.email)).rejects.toThrow(/401/);

      // Re-enabling does not revive the old session; the teacher signs in again.
      await admin.patch(`/api/v1/users/${w.teacherA.id}`).send({ isActive: true });
      expect((await teacher.get('/api/v1/courses')).status).toBe(401);
      await expect(loginAs(w.teacherA.email)).resolves.toBeDefined();
    });
  });
});
