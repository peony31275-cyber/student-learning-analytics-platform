import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { type World, buildWorld, createStudent, loginAs, resetDb } from './helpers/factories.js';

describe('Core API', () => {
  let w: World;
  beforeEach(async () => {
    await resetDb();
    w = await buildWorld();
  });

  describe('students', () => {
    it('admin creates a student with enrollments in one transaction', async () => {
      const admin = await loginAs(w.admin.email);
      const res = await admin.post('/api/v1/students').send({
        studentNumber: 'S-NEW', firstName: 'Nia', lastName: 'Lee', gradeLevel: 11, courseIds: [w.courseA.id, w.courseB.id],
      });
      expect(res.status).toBe(201);
      expect(await prisma.enrollment.count({ where: { studentId: res.body.data.id } })).toBe(2);
    });

    it('rolls back the profile if an enrollment cannot be created', async () => {
      const admin = await loginAs(w.admin.email);
      const res = await admin.post('/api/v1/students').send({
        studentNumber: 'S-ROLLBACK', firstName: 'A', lastName: 'B', gradeLevel: 9,
        courseIds: ['11111111-1111-4111-8111-111111111111'],
      });
      expect(res.status).toBe(403);
      expect(await prisma.studentProfile.count({ where: { studentNumber: 'S-ROLLBACK' } })).toBe(0);
    });

    it('teachers must enroll a new student in one of their courses', async () => {
      const teacher = await loginAs(w.teacherA.email);
      const noCourse = await teacher.post('/api/v1/students').send({ studentNumber: 'S-T1', firstName: 'A', lastName: 'B', gradeLevel: 9 });
      expect(noCourse.status).toBe(400);
      const otherCourse = await teacher.post('/api/v1/students').send({
        studentNumber: 'S-T1', firstName: 'A', lastName: 'B', gradeLevel: 9, courseIds: [w.courseB.id],
      });
      expect(otherCourse.status).toBe(403);
      const okRes = await teacher.post('/api/v1/students').send({
        studentNumber: 'S-T1', firstName: 'A', lastName: 'B', gradeLevel: 9, courseIds: [w.courseA.id],
      });
      expect(okRes.status).toBe(201);
    });

    it('rejects a duplicate student number with 409', async () => {
      const admin = await loginAs(w.admin.email);
      const res = await admin.post('/api/v1/students').send({
        studentNumber: w.studentA.studentNumber, firstName: 'A', lastName: 'B', gradeLevel: 9,
      });
      expect(res.status).toBe(409);
    });

    it('paginates, searches and filters', async () => {
      for (let i = 0; i < 25; i++) await createStudent(w.school.id, { lastName: `Zeta${String(i).padStart(2, '0')}` });
      const admin = await loginAs(w.admin.email);

      const page2 = await admin.get('/api/v1/students?page=2&pageSize=10');
      expect(page2.body.meta).toEqual({ page: 2, pageSize: 10, total: 27, totalPages: 3 });
      expect(page2.body.data).toHaveLength(10);

      const search = await admin.get('/api/v1/students?search=zeta0');
      expect(search.body.meta.total).toBe(10);

      const byCourse = await admin.get(`/api/v1/students?courseId=${w.courseB.id}`);
      expect(byCourse.body.data.map((s: { id: string }) => s.id)).toEqual([w.studentB.id]);

      const tooBig = await admin.get('/api/v1/students?pageSize=1000');
      expect(tooBig.status).toBe(400);
    });

    it('updates a student and validates the payload', async () => {
      const teacher = await loginAs(w.teacherA.email);
      const res = await teacher.patch(`/api/v1/students/${w.studentA.id}`).send({ gradeLevel: 12 });
      expect(res.status).toBe(200);
      expect(res.body.data.gradeLevel).toBe(12);
      expect((await teacher.patch(`/api/v1/students/${w.studentA.id}`).send({ gradeLevel: 99 })).status).toBe(400);
      expect((await teacher.patch(`/api/v1/students/${w.studentA.id}`).send({})).status).toBe(400);
    });
  });

  describe('courses and enrollments', () => {
    it('teacher creates a course assigned to themselves; duplicate code+term is 409', async () => {
      const teacher = await loginAs(w.teacherA.email);
      const res = await teacher.post('/api/v1/courses').send({ code: 'bio-101', name: 'Biology', term: '2026-Fall' });
      expect(res.status).toBe(201);
      expect(res.body.data.code).toBe('BIO-101');
      expect(res.body.data.teacher.id).toBe(w.teacherA.teacherProfile!.id);
      const dup = await teacher.post('/api/v1/courses').send({ code: 'BIO-101', name: 'Again', term: '2026-Fall' });
      expect(dup.status).toBe(409);
    });

    it('admin must specify a valid teacher', async () => {
      const admin = await loginAs(w.admin.email);
      expect((await admin.post('/api/v1/courses').send({ code: 'X-1', name: 'Xylophone', term: '2026-Fall' })).status).toBe(400);
      const res = await admin.post('/api/v1/courses').send({ code: 'X-1', name: 'Xylophone', term: '2026-Fall', teacherId: w.teacherB.teacherProfile!.id });
      expect(res.status).toBe(201);
    });

    it('enrolls, prevents duplicates, drops and re-activates', async () => {
      const teacher = await loginAs(w.teacherA.email);
      const first = await teacher.post('/api/v1/enrollments').send({ studentId: w.studentB.id, courseId: w.courseA.id });
      expect(first.status).toBe(201);
      const dup = await teacher.post('/api/v1/enrollments').send({ studentId: w.studentB.id, courseId: w.courseA.id });
      expect(dup.status).toBe(409);

      const drop = await teacher.patch(`/api/v1/enrollments/${first.body.data.id}`).send({ status: 'DROPPED' });
      expect(drop.body.data.status).toBe('DROPPED');
      const again = await teacher.post('/api/v1/enrollments').send({ studentId: w.studentB.id, courseId: w.courseA.id });
      expect(again.status).toBe(200);
      expect(again.body.data.id).toBe(first.body.data.id);
    });

    it('returns the roster with enrollment status', async () => {
      const teacher = await loginAs(w.teacherA.email);
      const res = await teacher.get(`/api/v1/courses/${w.courseA.id}/students`);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([expect.objectContaining({ id: w.studentA.id, enrollmentStatus: 'ACTIVE' })]);
    });
  });

  describe('assessments and grades', () => {
    async function makeAssessment(maxScore = 50) {
      const teacher = await loginAs(w.teacherA.email);
      const res = await teacher.post(`/api/v1/courses/${w.courseA.id}/assessments`).send({
        title: 'Midterm', type: 'EXAM', maxScore, weight: 2, dueDate: '2026-10-15',
      });
      expect(res.status).toBe(201);
      return { teacher, assessmentId: res.body.data.id as string };
    }

    it('records grades and writes a history entry for every change', async () => {
      const { teacher, assessmentId } = await makeAssessment();

      const first = await teacher.put(`/api/v1/assessments/${assessmentId}/grades`).send({ grades: [{ studentId: w.studentA.id, score: 40 }] });
      expect(first.body.data).toEqual({ created: 1, updated: 0, unchanged: 0 });

      const second = await teacher.put(`/api/v1/assessments/${assessmentId}/grades`).send({
        grades: [{ studentId: w.studentA.id, score: 45 }], reason: 'Regrade request',
      });
      expect(second.body.data).toEqual({ created: 0, updated: 1, unchanged: 0 });

      const same = await teacher.put(`/api/v1/assessments/${assessmentId}/grades`).send({ grades: [{ studentId: w.studentA.id, score: 45 }] });
      expect(same.body.data.unchanged).toBe(1);

      const book = await teacher.get(`/api/v1/assessments/${assessmentId}/grades`);
      const row = book.body.data.rows[0];
      expect(row).toMatchObject({ score: 45, percent: 90, status: 'SUBMITTED' });

      const history = await teacher.get(`/api/v1/grades/${row.gradeId}/history`);
      expect(history.body.data).toHaveLength(2);
      expect(history.body.data[0]).toMatchObject({ oldScore: 40, newScore: 45, reason: 'Regrade request' });
    });

    it('rejects scores above the maximum and students not in the course (atomically)', async () => {
      const { teacher, assessmentId } = await makeAssessment(50);
      const tooHigh = await teacher.put(`/api/v1/assessments/${assessmentId}/grades`).send({ grades: [{ studentId: w.studentA.id, score: 51 }] });
      expect(tooHigh.status).toBe(400);

      const mixed = await teacher.put(`/api/v1/assessments/${assessmentId}/grades`).send({
        grades: [{ studentId: w.studentA.id, score: 30 }, { studentId: w.studentB.id, score: 30 }],
      });
      expect(mixed.status).toBe(400);
      expect(await prisma.grade.count()).toBe(0);
    });

    it('requires a score for submitted work and clears it for missing work', async () => {
      const { teacher, assessmentId } = await makeAssessment();
      const noScore = await teacher.put(`/api/v1/assessments/${assessmentId}/grades`).send({ grades: [{ studentId: w.studentA.id, status: 'SUBMITTED' }] });
      expect(noScore.status).toBe(400);
      await teacher.put(`/api/v1/assessments/${assessmentId}/grades`).send({ grades: [{ studentId: w.studentA.id, status: 'MISSING', score: 10 }] });
      const g = await prisma.grade.findFirstOrThrow();
      expect(g.score).toBeNull();
      expect(g.status).toBe('MISSING');
    });

    it('lets a student read their own grades with percentages', async () => {
      const { teacher, assessmentId } = await makeAssessment(50);
      await teacher.put(`/api/v1/assessments/${assessmentId}/grades`).send({ grades: [{ studentId: w.studentA.id, score: 35 }] });
      const student = await loginAs(w.studentUser.email);
      const res = await student.get(`/api/v1/students/${w.studentA.id}/grades`);
      expect(res.body.data).toEqual([expect.objectContaining({ score: 35, percent: 70 })]);
    });

    it('blocks lowering maxScore below existing grades', async () => {
      const { teacher, assessmentId } = await makeAssessment(50);
      await teacher.put(`/api/v1/assessments/${assessmentId}/grades`).send({ grades: [{ studentId: w.studentA.id, score: 45 }] });
      const res = await teacher.patch(`/api/v1/assessments/${assessmentId}`).send({ maxScore: 40 });
      expect(res.status).toBe(409);
    });
  });

  describe('attendance', () => {
    it('records a class meeting idempotently (upsert on student+course+date)', async () => {
      const teacher = await loginAs(w.teacherA.email);
      const url = `/api/v1/courses/${w.courseA.id}/attendance`;
      await teacher.put(url).send({ date: '2026-10-05', records: [{ studentId: w.studentA.id, status: 'ABSENT' }] });
      const res = await teacher.put(url).send({ date: '2026-10-05', records: [{ studentId: w.studentA.id, status: 'LATE' }] });
      expect(res.status).toBe(200);
      expect(await prisma.attendance.count()).toBe(1);

      const day = await teacher.get(`${url}?date=2026-10-05`);
      expect(day.body.data.rows[0]).toMatchObject({ status: 'LATE' });
      const sessions = await teacher.get(`${url}/sessions`);
      expect(sessions.body.data).toEqual([{ date: '2026-10-05', PRESENT: 0, ABSENT: 0, LATE: 1, EXCUSED: 0 }]);
    });

    it('rejects future dates, bad statuses and non-enrolled students', async () => {
      const teacher = await loginAs(w.teacherA.email);
      const url = `/api/v1/courses/${w.courseA.id}/attendance`;
      expect((await teacher.put(url).send({ date: '2999-01-01', records: [{ studentId: w.studentA.id, status: 'PRESENT' }] })).status).toBe(400);
      expect((await teacher.put(url).send({ date: '2026-10-05', records: [{ studentId: w.studentA.id, status: 'ASLEEP' }] })).status).toBe(400);
      expect((await teacher.put(url).send({ date: '2026-10-05', records: [{ studentId: w.studentB.id, status: 'PRESENT' }] })).status).toBe(400);
    });
  });

  describe('users (admin)', () => {
    it('creates a teacher with a profile; deactivating revokes their session', async () => {
      const admin = await loginAs(w.admin.email);
      const res = await admin.post('/api/v1/users').send({
        email: 'new.teacher@test.edu', password: 'Teacher123', role: 'TEACHER', firstName: 'New', lastName: 'Teacher', department: 'Art',
      });
      expect(res.status).toBe(201);
      expect(res.body.data.teacherProfile.department).toBe('Art');
      expect(res.body.data).not.toHaveProperty('passwordHash');

      const teacher = await loginAs('new.teacher@test.edu', 'Teacher123');
      expect((await teacher.get('/api/v1/auth/me')).status).toBe(200);
      await admin.patch(`/api/v1/users/${res.body.data.id}`).send({ isActive: false });
      expect((await teacher.get('/api/v1/auth/me')).status).toBe(401);
    });

    it('an admin cannot deactivate themselves', async () => {
      const admin = await loginAs(w.admin.email);
      const res = await admin.patch(`/api/v1/users/${w.admin.id}`).send({ isActive: false });
      expect(res.status).toBe(400);
    });
  });
});
