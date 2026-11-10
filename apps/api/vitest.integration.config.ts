import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    globalSetup: ['test/integration/globalSetup.ts'],
    fileParallelism: false,
    // Tests about other things skip the signed-agreement gate; consent.test.ts turns it back on.
    env: { CONSENT_ENFORCEMENT: 'off' },
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
