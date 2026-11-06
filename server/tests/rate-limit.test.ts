import request from 'supertest';
import type { App } from 'supertest/types.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { PASSWORD, createSchool, createStudent, createUser, resetDb } from './helpers/factories.js';

/**
 * The credential rate limiter is off in the shared test app (tests sign in
 * hundreds of times), so each test here builds its own app with a small limit.
 * Every app gets a fresh in-memory counter, which keeps the tests independent.
 */
const appWithLimit = (limit: number, windowMs = 60_000) =>
  createApp({ authRateLimit: { limit, windowMs } }) as unknown as App;

const WRONG = 'Wrong-password1';

describe('credential rate limiting', () => {
  const emails: Record<'teacher' | 'admin', string> = { teacher: '', admin: '' };
  let schoolId = '';

  beforeAll(async () => {
    await resetDb();
    const school = await createSchool();
    schoolId = school.id;
    emails.teacher = (await createUser(school.id, 'TEACHER')).email;
    emails.admin = (await createUser(school.id, 'ADMIN')).email;
  });

  const login = (app: App, password: string, email = emails.teacher) =>
    request(app).post('/api/v1/auth/login').send({ email, password });

  it('blocks after the limit with 429, Retry-After and the standard error envelope', async () => {
    const app = appWithLimit(3);
    for (let i = 0; i < 3; i++) expect((await login(app, WRONG)).status).toBe(401);

    const res = await login(app, WRONG);
    expect(res.status).toBe(429);
    expect(res.body).toEqual({
      error: { code: 'RATE_LIMITED', message: expect.stringMatching(/Try again in 1 minute\./) },
    });
    const retryAfter = Number(res.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect(res.headers['ratelimit-policy']).toContain('"3-in-1min"');

    // While blocked, even the correct password is refused.
    expect((await login(app, PASSWORD)).status).toBe(429);
  });

  it('does not count successful sign-ins, so switching accounts never locks you out', async () => {
    const app = appWithLimit(3);
    for (let i = 0; i < 5; i++) {
      expect((await login(app, PASSWORD, emails.teacher)).status).toBe(200);
      expect((await login(app, PASSWORD, emails.admin)).status).toBe(200);
    }
  });

  it('keeps counting failures across successful sign-ins (a success does not reset them)', async () => {
    const app = appWithLimit(3);
    expect((await login(app, WRONG)).status).toBe(401);
    expect((await login(app, PASSWORD)).status).toBe(200);
    expect((await login(app, WRONG)).status).toBe(401);
    expect((await login(app, PASSWORD)).status).toBe(200);
    expect((await login(app, WRONG)).status).toBe(401);
    expect((await login(app, WRONG)).status).toBe(429);
  });

  it('unblocks automatically when the window ends', async () => {
    const app = appWithLimit(1, 1000);
    expect((await login(app, WRONG)).status).toBe(401);
    expect((await login(app, WRONG)).status).toBe(429);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect((await login(app, PASSWORD)).status).toBe(200);
  });

  it('session checks and sign-out do not use up the sign-in budget', async () => {
    const app = appWithLimit(2);
    const agent = request.agent(app);
    expect(
      (await agent.post('/api/v1/auth/login').send({ email: emails.teacher, password: PASSWORD }))
        .status,
    ).toBe(200);
    for (let i = 0; i < 10; i++) expect((await agent.get('/api/v1/auth/me')).status).toBe(200);
    expect((await agent.post('/api/v1/auth/logout')).status).toBe(204);

    expect((await login(app, WRONG)).status).toBe(401);
    expect((await login(app, WRONG)).status).toBe(401);
    expect((await login(app, WRONG)).status).toBe(429);
  });

  it('gives each credential endpoint its own budget', async () => {
    const app = appWithLimit(2);
    const activate = () =>
      request(app)
        .post('/api/v1/auth/activation')
        .send({ token: 'x'.repeat(43), password: 'Secret123' });
    expect((await activate()).status).toBe(400);
    expect((await activate()).status).toBe(400);
    expect((await activate()).status).toBe(429);

    // Failed activations must not lock the same network out of signing in.
    expect((await login(app, WRONG)).status).toBe(401);
  });

  it('limits failed activation checks, and every invite issued', async () => {
    const app = appWithLimit(2);
    const verify = () =>
      request(app)
        .post('/api/v1/auth/activation/verify')
        .send({ token: 'y'.repeat(43) });
    expect((await verify()).status).toBe(400);
    expect((await verify()).status).toBe(400);
    expect((await verify()).status).toBe(429);

    // Issuing an invite counts even when it succeeds: each one creates a token.
    const student = await createStudent(schoolId, { email: 'limit@test.edu' });
    const admin = request.agent(app);
    await admin.post('/api/v1/auth/login').send({ email: emails.admin, password: PASSWORD });
    const invite = () => admin.post(`/api/v1/students/${student.id}/activation-invite`);
    expect((await invite()).status).toBe(201);
    expect((await invite()).status).toBe(201);
    expect((await invite()).status).toBe(429);
  });
});
