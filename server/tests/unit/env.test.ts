import { describe, expect, it } from 'vitest';
import { parseEnv } from '../../src/config/env.js';

const base = {
  DATABASE_URL: 'postgresql://localhost/env_test',
  JWT_SECRET: 'x'.repeat(48),
};

describe('environment validation for activation invites', () => {
  it('turns invites off unless a delivery channel is configured', () => {
    expect(parseEnv({ ...base, NODE_ENV: 'production' }).INVITE_DELIVERY).toBe('disabled');
    expect(parseEnv({ ...base, NODE_ENV: 'development' }).INVITE_DELIVERY).toBe('disabled');
  });

  it('refuses to start in production with the development-only link delivery', () => {
    expect(() =>
      parseEnv({ ...base, NODE_ENV: 'production', INVITE_DELIVERY: 'dev-link' }),
    ).toThrow(
      /INVITE_DELIVERY: dev-link exposes activation links and is not allowed in production/,
    );
  });

  it('allows the link delivery for local development and tests', () => {
    expect(
      parseEnv({ ...base, NODE_ENV: 'development', INVITE_DELIVERY: 'dev-link' }).INVITE_DELIVERY,
    ).toBe('dev-link');
  });

  it('rejects unknown delivery modes', () => {
    expect(() => parseEnv({ ...base, INVITE_DELIVERY: 'sms' })).toThrow(/INVITE_DELIVERY/);
  });
});
