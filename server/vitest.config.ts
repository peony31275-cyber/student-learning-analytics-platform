import { defineConfig } from 'vitest/config';
import { TEST_DATABASE_URL } from './tests/test-env.js';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['./tests/global-setup.ts'],
    setupFiles: ['./tests/setup.ts'],
    // Integration tests share one database; run files sequentially to avoid cross-test interference.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 120_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: TEST_DATABASE_URL,
      DIRECT_URL: TEST_DATABASE_URL,
      JWT_SECRET: 'test-secret-that-is-long-enough-for-hs256-signing',
      JWT_EXPIRES_IN: '1h',
      BCRYPT_ROUNDS: '4',
      LOG_LEVEL: 'silent',
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/generated/**', 'src/server.ts'],
    },
  },
});
