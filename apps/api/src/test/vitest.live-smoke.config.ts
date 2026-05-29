import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/test/live-provider-smoke.spec.ts'],
    testTimeout: Number(
      process.env.MENGTU_LIVE_PROVIDER_SMOKE_TEST_TIMEOUT_MS ?? 180000
    ),
  },
});
