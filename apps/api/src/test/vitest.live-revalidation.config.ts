import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/test/live-provider-revalidation.spec.ts'],
    testTimeout: Number(
      process.env.MENGTU_LIVE_PROVIDER_REVALIDATION_TEST_TIMEOUT_MS ?? 600000
    ),
  },
});
