import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    // E2E tests spin up real servers/timers; give them room.
    testTimeout: 15_000,
    hookTimeout: 15_000,
    coverage: { provider: 'v8', reporter: ['text', 'lcov'] },
  },
});
