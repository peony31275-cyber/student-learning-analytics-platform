import { createHash } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { generateToken } from '../src/lib/tokens.js';
import {
  type World,
  app,
  buildWorld,
  createStudent,
  enroll,
  loginAs,
  resetDb,
} from './helpers/factories.js';

/**
 * Student activation through one-time invite tokens. The test environment uses
 * INVITE_DELIVERY=dev-link, so the API returns the link (refused in production;
 * see invites-disabled.test.ts and unit/env.test.ts).
 */
describe('Student activation (one-time invite tokens)', () => {
  let w: World;
  let invitee: { id: string };
  const EMAIL = 'invitee.student@test.edu';

  beforeEach(async () => {
    await resetDb();
    w = await buildWorld();
    // A profile without a login, in teacher A's course (not teacher B's).
    invitee = await createStudent(w.school.id, {
      email: 'Invitee.Student@test.edu',
      lastName: 'Invitee',
    });
    await enroll(invitee.id, w.courseA.id);
  });

  type Agent = Awaited<ReturnType<typeof loginAs>>;
  const invite = (agent: Agent, studentId = invitee.id) =>
    agent.post(`/api/v1/students/${studentId}/activation-invite`);
  const tokenOf = (res: { body: { data: { activationUrl: string } } }) =>
    new URL(res.body.data.activationUrl).hash.replace('#token=', '');
  const verify = (token: string) =>
    request(app).post('/api/v1/auth/activation/verify').send({ token });
  const activate = (token: string, password = 'Student123') =>
    request(app).post('/api/v1/auth/activation').send({ token, password });
  const adminToken = async () => tokenOf(await invite(await loginAs(w.admin.email)));
  const accounts = (email = EMAIL) => prisma.user.count({ where: { email } });

  describe('issuing invites', () => {
    it('an admin creates an invite: 24 h expiry, token only in the link, only its hash stored', async () => {
      const res = await invite(await loginAs(w.admin.email));
      expect(res.status).toBe(201);
      expect(res.body.data.delivery).toBe('dev-link');
      expect(res.body.data.activationUrl).toMatch(
        /^http:\/\/localhost:5173\/activate#token=[A-Za-z0-9_-]{43}$/,
      );
      const hoursLeft = (Date.parse(res.body.data.expiresAt) - Date.now()) / 3_600_000;
      expect(hoursLeft).toBeGreaterThan(23.9);
      expect(hoursLeft).toBeLessThanOrEqual(24);

      const token = tokenOf(res);
      const rows = await prisma.activationToken.findMany({ where: { studentId: invitee.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
      expect(JSON.stringify(rows)).not.toContain(token);
      expect(rows[0]!.createdById).toBe(w.admin.id);
    });

    it('a teacher can invite a student enrolled in their own course', async () => {
      expect((await invite(await loginAs(w.teacherA.email))).status).toBe(201);
    });

    it('a teacher cannot invite a student outside their courses (404, nothing created)', async () => {
      const res = await invite(await loginAs(w.teacherB.email));
      expect(res.status).toBe(404);
      expect(await prisma.activationToken.count()).toBe(0);
    });

    it('unauthorized users cannot generate activation tokens', async () => {
      expect((await invite(await loginAs(w.studentUser.email))).status).toBe(403);
      expect(
        (await request(app).post(`/api/v1/students/${invitee.id}/activation-invite`)).status,
      ).toBe(401);
      expect(await prisma.activationToken.count()).toBe(0);
    });

    it('staff see that an invite is pending, but never the token or its hash', async () => {
      const admin = await loginAs(w.admin.email);
      const token = tokenOf(await invite(admin));
      const res = await admin.get(`/api/v1/students/${invitee.id}`);
      expect(res.body.data.account.status).toBe('NONE');
      expect(res.body.data.account.pendingInvite.expiresAt).toBeDefined();
      const hash = createHash('sha256').update(token).digest('hex');
      expect(JSON.stringify(res.body)).not.toContain(token);
      expect(JSON.stringify(res.body)).not.toContain(hash);
    });

    it('refuses students who already have an account, inactive records and missing emails', async () => {
      const admin = await loginAs(w.admin.email);
      const linked = await invite(admin, w.studentA.id);
      expect([linked.status, linked.body.error.code]).toEqual([409, 'ACCOUNT_EXISTS']);

      const inactive = await createStudent(w.school.id, { email: 'gone@test.edu' });
      await prisma.studentProfile.update({
        where: { id: inactive.id },
        data: { status: 'INACTIVE' },
      });
      const res = await invite(admin, inactive.id);
      expect([res.status, res.body.error.code]).toEqual([409, 'STUDENT_INACTIVE']);

      const noEmail = await createStudent(w.school.id);
      const res2 = await invite(admin, noEmail.id);
      expect([res2.status, res2.body.error.code]).toEqual([400, 'EMAIL_REQUIRED']);
      expect(await prisma.activationToken.count()).toBe(0);
    });
  });

  describe('using an invite', () => {
    it('valid token activation succeeds: linked account, hashed password, student sees own data', async () => {
      const token = await adminToken();
      const check = await verify(token);
      expect(check.status).toBe(200);
      expect(check.body.data).toEqual({
        firstName: 'Stu',
        lastName: 'Invitee',
        email: EMAIL,
        school: 'Test School',
      });

      const res = await activate(token);
      expect(res.status).toBe(201);
      expect(res.body.data).toEqual({ email: EMAIL });
      expect(res.headers['set-cookie']).toBeUndefined(); // no session: the student signs in next

      const user = await prisma.user.findUniqueOrThrow({
        where: { email: EMAIL },
        include: { studentProfile: true },
      });
      expect(user.role).toBe('STUDENT');
      expect(user.mustChangePassword).toBe(false);
      expect(user.studentProfile?.id).toBe(invitee.id);
      expect(user.passwordHash).toMatch(/^\$2[aby]\$/);
      const row = await prisma.activationToken.findFirstOrThrow({
        where: { studentId: invitee.id },
      });
      expect(row.usedAt).not.toBeNull();

      const student = await loginAs(EMAIL, 'Student123');
      expect((await student.get(`/api/v1/students/${invitee.id}`)).status).toBe(200);
      expect((await student.get(`/api/v1/students/${w.studentB.id}`)).status).toBe(404);
    });

    it('invalid token is rejected (unknown or malformed)', async () => {
      await adminToken(); // a real token exists, but none of these is it
      for (const token of [
        generateToken().token,
        'x'.repeat(43),
        'short',
        '../../etc/passwd',
        '',
      ]) {
        const v = await verify(token);
        const a = await activate(token);
        expect([v.status, v.body.error.code]).toEqual([400, 'ACTIVATION_TOKEN_INVALID']);
        expect([a.status, a.body.error.code]).toEqual([400, 'ACTIVATION_TOKEN_INVALID']);
      }
      expect(await accounts()).toBe(0);
    });

    it('expired token is rejected', async () => {
      const token = await adminToken();
      await prisma.activationToken.updateMany({
        where: { studentId: invitee.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expect((await verify(token)).body.error.code).toBe('ACTIVATION_TOKEN_EXPIRED');
      const res = await activate(token);
      expect([res.status, res.body.error.code]).toEqual([410, 'ACTIVATION_TOKEN_EXPIRED']);
      expect(await accounts()).toBe(0);
    });

    it('reused token is rejected and does not change the password', async () => {
      const token = await adminToken();
      expect((await activate(token)).status).toBe(201);
      const again = await activate(token, 'Hijack1234');
      expect([again.status, again.body.error.code]).toEqual([410, 'ACTIVATION_TOKEN_USED']);
      await expect(loginAs(EMAIL, 'Student123')).resolves.toBeDefined();
      await expect(loginAs(EMAIL, 'Hijack1234')).rejects.toThrow(/401/);
    });

    it('revoked token is rejected: a new invite replaces the old link', async () => {
      const admin = await loginAs(w.admin.email);
      const first = tokenOf(await invite(admin));
      const second = tokenOf(await invite(admin));
      expect((await verify(first)).body.error.code).toBe('ACTIVATION_TOKEN_REVOKED');
      const res = await activate(first);
      expect([res.status, res.body.error.code]).toEqual([410, 'ACTIVATION_TOKEN_REVOKED']);
      expect((await activate(second)).status).toBe(201);
    });

    it('disabled account cannot be activated, and stays disabled', async () => {
      const token = await adminToken();
      // Meanwhile the student got a login some other way and an admin disabled it.
      const disabled = await prisma.user.create({
        data: {
          schoolId: w.school.id,
          email: EMAIL,
          passwordHash: 'not-a-real-hash',
          role: 'STUDENT',
          firstName: 'Stu',
          lastName: 'Invitee',
          isActive: false,
        },
      });
      await prisma.studentProfile.update({
        where: { id: invitee.id },
        data: { userId: disabled.id },
      });

      const res = await activate(token);
      expect([res.status, res.body.error.code]).toEqual([409, 'ACCOUNT_EXISTS']);
      expect(res.body.error.message).toMatch(/disabled/);
      const after = await prisma.user.findUniqueOrThrow({ where: { id: disabled.id } });
      expect(after.isActive).toBe(false);
      expect(after.passwordHash).toBe('not-a-real-hash');
    });

    it('already activated student cannot activate again, even with another outstanding token', async () => {
      expect((await activate(await adminToken())).status).toBe(201);
      const stray = generateToken(); // e.g. an invite issued in a race
      await prisma.activationToken.create({
        data: {
          studentId: invitee.id,
          tokenHash: stray.hash,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      });
      const res = await activate(stray.token);
      expect([res.status, res.body.error.code]).toEqual([409, 'ACCOUNT_EXISTS']);
      expect(await accounts()).toBe(1);
    });

    it('concurrent activation requests cannot create duplicate accounts', async () => {
      // Five parallel requests with the same token.
      const token = await adminToken();
      const results = await Promise.all(Array.from({ length: 5 }, () => activate(token)));
      const statuses = results.map((r) => r.status);
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      expect(statuses.every((s) => [201, 409, 410].includes(s))).toBe(true);
      expect(await accounts()).toBe(1);

      // Two different valid tokens for the same student, in parallel.
      const other = await createStudent(w.school.id, { email: 'race@test.edu' });
      const [a, b] = [generateToken(), generateToken()];
      const expiresAt = new Date(Date.now() + 3_600_000);
      await prisma.activationToken.createMany({
        data: [
          { studentId: other.id, tokenHash: a.hash, expiresAt },
          { studentId: other.id, tokenHash: b.hash, expiresAt },
        ],
      });
      const both = await Promise.all([activate(a.token), activate(b.token)]);
      expect(both.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await accounts('race@test.edu')).toBe(1);
      const profile = await prisma.studentProfile.findUniqueOrThrow({ where: { id: other.id } });
      const user = await prisma.user.findUniqueOrThrow({ where: { email: 'race@test.edu' } });
      expect(profile.userId).toBe(user.id);
    });

    it('an admin-created login voids the pending invite and starts with a temporary password', async () => {
      const admin = await loginAs(w.admin.email);
      const token = tokenOf(await invite(admin));
      const res = await admin.post('/api/v1/users').send({
        role: 'STUDENT',
        email: EMAIL,
        firstName: 'Stu',
        lastName: 'Invitee',
        password: 'TempPass123',
        studentId: invitee.id,
      });
      expect(res.status).toBe(201);
      expect(res.body.data.mustChangePassword).toBe(true);
      const used = await activate(token);
      expect([used.status, used.body.error.code]).toEqual([410, 'ACTIVATION_TOKEN_REVOKED']);
      expect(await accounts()).toBe(1);
    });

    it('enforces the password policy without using up the invite', async () => {
      const token = await adminToken();
      const weak = await activate(token, 'short');
      expect(weak.status).toBe(400);
      expect(weak.body.error.code).toBe('VALIDATION_ERROR');
      expect((await activate(token)).status).toBe(201);
    });
  });
});
