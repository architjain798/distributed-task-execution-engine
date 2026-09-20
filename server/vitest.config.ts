import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Structured logs are the point in production and noise in a test run.
    env: { LOG_LEVEL: 'silent' },
  },
});
