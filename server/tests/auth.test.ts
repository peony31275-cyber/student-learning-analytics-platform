import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { signToken } from '../src/lib/jwt.js';
import { prisma } from '../src/lib/prisma.js';
import { PASSWORD, app, createSchool, createUser, loginAs, resetDb } from './helpers/factories.js';

describe('Authentication', () => {
  let schoolId: string;

  beforeEach(async () => {
    await resetDb();
    schoolId = (await createSchool()).id;
  });

  describe('POST /api/v1/auth/login', () => {
    it('sets an httpOnly cookie and returns the user without the password hash', async () => {
      const user = await createUser(schoolId, 'TEACHER', { email: 'teach@test.edu' });

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'TEACH@test.edu', password: PASSWORD }); // email is case-insensitive

      expect(res.status).toBe(200);
      expect(res.body.data.user).toMatchObject({
        id: user.id,
        role: 'TEACHER',
        email: 'teach@test.edu',
      });
      expect(res.body.data.user.teacherId).toBe(user.teacherProfile!.id);
      expect(JSON.stringify(res.body)).not.toContain('passwordHash');

      const cookie = String(res.headers['set-cookie']);
      expect(cookie).toContain('sla_token=');
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');
    });

    it('returns the same 401 message for an unknown email and a wrong password', async () => {
      await createUser(schoolId, 'ADMIN', { email: 'admin@test.edu' });

      const wrongPw = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'admin@test.edu', password: 'nope12345' });
      const noUser = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'ghost@test.edu', password: 'nope12345' });

      expect(wrongPw.status).toBe(401);
      expect(noUser.status).toBe(401);
      expect(wrongPw.body.error.message).toBe(noUser.body.error.message);
    });

    it('rejects deactivated accounts', async () => {
      await createUser(schoolId, 'TEACHER', { email: 'off@test.edu', isActive: false });
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'off@test.edu', password: PASSWORD });
      expect(res.status).toBe(401);
    });

    it('validates the request body with a 400 and field details', async () => {
      const res = await request(app).post('/api/v1/auth/login').send({ email: 'not-an-email' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual(
        expect.arrayContaining(['email', 'password']),
      );
    });

    it('rejects malformed JSON with a 400', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"email":');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('BAD_REQUEST');
    });
  });

  describe('GET /api/v1/auth/me', () => {
    it('returns 401 without a token', async () => {
      const res = await request(app).get('/api/v1/auth/me');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 for a tampered token', async () => {
      const user = await createUser(schoolId, 'ADMIN');
      const token = signToken({ sub: user.id, role: 'ADMIN', tv: 0 });
      const tampered = token.slice(0, -2) + (token.endsWith('aa') ? 'bb' : 'aa');
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tampered}`);
      expect(res.status).toBe(401);
    });

    it('accepts a valid Bearer token as well as the cookie', async () => {
      const user = await createUser(schoolId, 'ADMIN');
      const token = signToken({ sub: user.id, role: 'ADMIN', tv: 0 });
      const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.user.id).toBe(user.id);
    });

    it('rejects a still-unexpired token once the user is deactivated', async () => {
      const user = await createUser(schoolId, 'TEACHER');
      const agent = await loginAs(user.email);
      expect((await agent.get('/api/v1/auth/me')).status).toBe(200);

      await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
      expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
    });
  });

  describe('logout', () => {
    it('logout clears the cookie', async () => {
      const user = await createUser(schoolId, 'ADMIN');
      const agent = await loginAs(user.email);
      const res = await agent.post('/api/v1/auth/logout');
      expect(res.status).toBe(204);
      expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
    });

    it('logout expires the cookie with the same attributes it was set with', async () => {
      const user = await createUser(schoolId, 'TEACHER');
      const login = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: PASSWORD });
      const setCookie = String(login.headers['set-cookie']);
      expect(setCookie).toMatch(/sla_token=[^;]+;.*Path=\/.*HttpOnly.*SameSite=Lax/);

      const res = await request(app).post('/api/v1/auth/logout').set('Cookie', setCookie);
      expect(res.status).toBe(204);
      const cleared = String(res.headers['set-cookie']);
      // A browser only deletes a cookie when name, Path (and Domain) match.
      expect(cleared).toMatch(/^sla_token=;/);
      expect(cleared).toContain('Path=/');
      expect(cleared).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
      expect(cleared).toContain('HttpOnly');
      expect(cleared).toContain('SameSite=Lax');
    });

    it('protected endpoints reject a request after logout (no cookie)', async () => {
      const user = await createUser(schoolId, 'TEACHER');
      const agent = await loginAs(user.email);
      expect((await agent.get('/api/v1/risk-alerts')).status).toBe(200);
      await agent.post('/api/v1/auth/logout');
      const res = await agent.get('/api/v1/risk-alerts');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('logout-all revokes tokens issued earlier (tokenVersion)', async () => {
      const user = await createUser(schoolId, 'ADMIN');
      const oldToken = signToken({ sub: user.id, role: 'ADMIN', tv: 0 });
      const agent = await loginAs(user.email);

      expect((await agent.post('/api/v1/auth/logout-all')).status).toBe(204);
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${oldToken}`);
      expect(res.status).toBe(401);
    });
  });

  describe('old self-registration (student number + email)', () => {
    it('no longer exists: knowing a student number and email cannot create an account', async () => {
      const profile = await prisma.studentProfile.create({
        data: {
          schoolId,
          studentNumber: 'S-1',
          firstName: 'New',
          lastName: 'Student',
          email: 'new.student@test.edu',
          gradeLevel: 10,
        },
      });
      const res = await request(app).post('/api/v1/auth/register').send({
        email: 'new.student@test.edu',
        password: 'Secret123',
        studentNumber: 'S-1',
        firstName: 'New',
        lastName: 'Student',
      });
      expect(res.status).toBe(401); // unknown public route: falls through to authentication
      expect(await prisma.user.count({ where: { email: 'new.student@test.edu' } })).toBe(0);
      const after = await prisma.studentProfile.findUniqueOrThrow({ where: { id: profile.id } });
      expect(after.userId).toBeNull();
    });
  });

  describe('PATCH /api/v1/auth/password', () => {
    it('changes the password and ends every session, including the caller’s', async () => {
      const user = await createUser(schoolId, 'TEACHER');
      const otherSession = await loginAs(user.email);
      const agent = await loginAs(user.email);

      const res = await agent
        .patch('/api/v1/auth/password')
        .send({ currentPassword: PASSWORD, newPassword: 'NewPass456' });
      expect(res.status).toBe(204);
      expect(String(res.headers['set-cookie'])).toMatch(/^sla_token=;.*Expires=Thu, 01 Jan 1970/);

      expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
      expect((await otherSession.get('/api/v1/auth/me')).status).toBe(401);
      await expect(loginAs(user.email, 'NewPass456')).resolves.toBeDefined();
      expect(
        (
          await request(app)
            .post('/api/v1/auth/login')
            .send({ email: user.email, password: PASSWORD })
        ).status,
      ).toBe(401);
    });

    it('rejects reusing the current password as the new one', async () => {
      const user = await createUser(schoolId, 'TEACHER');
      const agent = await loginAs(user.email);
      const res = await agent
        .patch('/api/v1/auth/password')
        .send({ currentPassword: PASSWORD, newPassword: PASSWORD });
      expect(res.status).toBe(400);
      expect(res.body.error.details[0].path).toBe('newPassword');
    });

    it('rejects an incorrect current password', async () => {
      const user = await createUser(schoolId, 'TEACHER');
      const agent = await loginAs(user.email);
      const res = await agent
        .patch('/api/v1/auth/password')
        .send({ currentPassword: 'wrong123', newPassword: 'NewPass456' });
      expect(res.status).toBe(400);
    });
  });

  it('returns 401 for unknown routes when unauthenticated and a JSON 404 when authenticated', async () => {
    expect((await request(app).get('/api/v1/nope')).status).toBe(401);
    const user = await createUser(schoolId, 'ADMIN');
    const res = await (await loginAs(user.email)).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
