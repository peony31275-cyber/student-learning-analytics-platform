import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { verifyPassword } from '../src/lib/password.js';
import { prisma } from '../src/lib/prisma.js';
import { type World, app, buildWorld, loginAs, resetDb } from './helpers/factories.js';

/**
 * Admin creates a teacher with a temporary password; the teacher must replace
 * it before the API serves anything else. Enforced by the backend middleware
 * (requirePasswordChanged), so these tests call the API directly.
 */
describe('Teacher first sign-in with a temporary password', () => {
  let w: World;
  const EMAIL = 'new.teacher@test.edu';
  const TEMP = 'TempPass123';
  const OWN = 'MyOwnPass456';

  beforeEach(async () => {
    await resetDb();
    w = await buildWorld();
  });

  async function adminCreatesTeacher() {
    const admin = await loginAs(w.admin.email);
    const res = await admin.post('/api/v1/users').send({
      role: 'TEACHER',
      email: EMAIL,
      firstName: 'New',
      lastName: 'Teacher',
      department: 'Science',
      password: TEMP,
    });
    expect(res.status).toBe(201);
    return { admin, created: res.body.data as { id: string; mustChangePassword: boolean } };
  }
  const login = (password: string) =>
    request(app).post('/api/v1/auth/login').send({ email: EMAIL, password });
  const changePassword = (agent: Awaited<ReturnType<typeof loginAs>>, current = TEMP) =>
    agent.patch('/api/v1/auth/password').send({ currentPassword: current, newPassword: OWN });

  it('newly created teacher must change the temporary password', async () => {
    const { created } = await adminCreatesTeacher();
    expect(created.mustChangePassword).toBe(true);
    const res = await login(TEMP);
    expect(res.status).toBe(200);
    expect(res.body.data.user.mustChangePassword).toBe(true);
  });

  it('teacher cannot access protected business APIs before changing it', async () => {
    await adminCreatesTeacher();
    const teacher = await loginAs(EMAIL, TEMP);
    for (const path of [
      '/api/v1/courses',
      '/api/v1/students',
      '/api/v1/analytics/overview',
      '/api/v1/risk-alerts',
      '/api/v1/school',
      `/api/v1/courses/${w.courseA.id}`,
    ]) {
      const res = await teacher.get(path);
      expect([path, res.status, res.body.error?.code]).toEqual([
        path,
        403,
        'PASSWORD_CHANGE_REQUIRED',
      ]);
    }
    const write = await teacher
      .post('/api/v1/courses')
      .send({ code: 'BLK-101', name: 'Blocked', term: '2026-Fall' });
    expect(write.status).toBe(403);
    expect(await prisma.course.count({ where: { code: 'BLK-101' } })).toBe(0);
    // Still allowed: who am I (to show the change-password screen) and signing out.
    expect((await teacher.get('/api/v1/auth/me')).body.data.user.mustChangePassword).toBe(true);
    expect((await teacher.post('/api/v1/auth/logout')).status).toBe(204);
  });

  it('temporary password is stored only as a bcrypt hash and never returned to the admin', async () => {
    const { admin, created } = await adminCreatesTeacher();
    const row = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(row.passwordHash).toMatch(/^\$2[aby]\$\d{2}\$.{53}$/);
    expect(row.passwordHash).not.toContain(TEMP);
    expect(await verifyPassword(TEMP, row.passwordHash)).toBe(true);

    const responses = [
      JSON.stringify(created),
      JSON.stringify((await admin.get('/api/v1/users')).body),
      JSON.stringify((await admin.get(`/api/v1/users/${created.id}`)).body),
    ];
    for (const body of responses) {
      expect(body).not.toMatch(/passwordHash|tokenVersion|"password"/);
      expect(body).not.toContain(row.passwordHash);
      expect(body).not.toContain(TEMP);
    }
  });

  it('password change succeeds and clears the first-login flag', async () => {
    await adminCreatesTeacher();
    const teacher = await loginAs(EMAIL, TEMP);
    const res = await changePassword(teacher);
    expect(res.status).toBe(204);
    const row = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(row.mustChangePassword).toBe(false);
    expect(await verifyPassword(OWN, row.passwordHash)).toBe(true);
  });

  it('old sessions are invalidated after the password change', async () => {
    await adminCreatesTeacher();
    const first = await loginAs(EMAIL, TEMP);
    const second = await loginAs(EMAIL, TEMP); // e.g. another browser
    expect((await changePassword(first)).headers['set-cookie']?.[0]).toMatch(
      /^sla_token=;.*Expires=Thu, 01 Jan 1970/,
    );
    expect((await first.get('/api/v1/auth/me')).status).toBe(401);
    expect((await second.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('new password works after signing in again; the temporary one does not', async () => {
    await adminCreatesTeacher();
    await changePassword(await loginAs(EMAIL, TEMP));
    expect((await login(TEMP)).status).toBe(401);
    const res = await login(OWN);
    expect(res.status).toBe(200);
    expect(res.body.data.user.mustChangePassword).toBe(false);
  });

  it('regular sign-in works after the first change: no forced change, full access', async () => {
    await adminCreatesTeacher();
    await changePassword(await loginAs(EMAIL, TEMP));
    const again = await loginAs(EMAIL, OWN);
    await again.post('/api/v1/auth/logout');
    const later = await loginAs(EMAIL, OWN);
    expect((await later.get('/api/v1/auth/me')).body.data.user.mustChangePassword).toBe(false);
    expect((await later.get('/api/v1/courses')).status).toBe(200);
  });

  it('a wrong temporary password does not lift the restriction', async () => {
    await adminCreatesTeacher();
    const teacher = await loginAs(EMAIL, TEMP);
    expect((await changePassword(teacher, 'NotTheTemp1')).status).toBe(400);
    expect((await teacher.get('/api/v1/courses')).status).toBe(403);
  });

  it('existing accounts are unaffected (the migration defaults the flag to false)', async () => {
    const teacher = await loginAs(w.teacherA.email);
    expect((await teacher.get('/api/v1/auth/me')).body.data.user.mustChangePassword).toBe(false);
    expect((await teacher.get('/api/v1/courses')).status).toBe(200);
  });

  it('student cannot access the teacher account setup (creating or editing staff accounts)', async () => {
    const student = await loginAs(w.studentUser.email);
    const create = await student.post('/api/v1/users').send({
      role: 'TEACHER',
      email: 'sneaky@test.edu',
      firstName: 'Sneaky',
      lastName: 'Teacher',
      password: TEMP,
    });
    expect(create.status).toBe(403);
    const edit = await student.patch(`/api/v1/users/${w.teacherA.id}`).send({ isActive: false });
    expect(edit.status).toBe(403);
    expect(await prisma.user.count({ where: { email: 'sneaky@test.edu' } })).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: w.teacherA.id } })).isActive).toBe(
      true,
    );
  });
});
