import { defineConfig } from 'vitest/config';

// Vitest uses esbuild for TSX transforms by default, which is sufficient for
// our dashboard tests (we don't rely on Fast Refresh or plugin-react's
// build-time JSX handling — only the JSX transform, which esbuild provides).
//
// esbuildOptions.jsx='automatic' aligns with tsconfig's "jsx": "react-jsx" so
// <Component /> needs no `import React from 'react'` in test files.
export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.tsx', 'tests/**/*.test.ts', 'src/**/*.test.tsx'],
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    coverage: { provider: 'v8', reporter: ['text', 'lcov'] },
  },
});
