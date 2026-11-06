import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as EnvModule from '../src/config/env.js';
import { prisma } from '../src/lib/prisma.js';
import { type World, buildWorld, createStudent, loginAs, resetDb } from './helpers/factories.js';

// This file runs the app as production would without an email service:
// INVITE_DELIVERY is "disabled" (the default when it is not set).
vi.mock('../src/config/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof EnvModule>();
  return { ...actual, env: { ...actual.env, INVITE_DELIVERY: 'disabled' } };
});

describe('activation invites without a configured delivery channel', () => {
  let w: World;
  beforeEach(async () => {
    await resetDb();
    w = await buildWorld();
  });

  it('refuses to issue invites with 503, creates no token and returns no link', async () => {
    const student = await createStudent(w.school.id, { email: 'waiting@test.edu' });
    const admin = await loginAs(w.admin.email);
    const res = await admin.post(`/api/v1/students/${student.id}/activation-invite`);

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('INVITES_DISABLED');
    expect(res.body.error.message).toMatch(/no secure way to deliver/);
    expect(JSON.stringify(res.body)).not.toMatch(/token=|activationUrl/);
    expect(await prisma.activationToken.count()).toBe(0);
  });

  it('there is still no way to activate without an invite', async () => {
    const admin = await loginAs(w.admin.email);
    const res = await admin.get(`/api/v1/students/${w.studentB.id}`);
    expect(res.body.data.account).toEqual({ status: 'NONE', pendingInvite: null });
  });
});
