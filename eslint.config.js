// ESLint flat config — ESLint 9 + typescript-eslint 8
// Type-aware linting is OFF until package tsconfigs exist (Phase 1c+).
// To enable later: add `parserOptions: { projectService: true }` and switch
// to `tseslint.configs.recommendedTypeChecked`.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/*.tsbuildinfo',
      'pnpm-lock.yaml',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        // Node globals — each package can override if it runs in browser/edge.
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
        globalThis: 'readonly',
      },
    },
    rules: {
      // Hipp0 style: unused vars warn (not error), allow _-prefix to silence.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // `any` is a warning, not an error — we allow it at API boundaries per CLAUDE.md §1.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Pino handles logging; console use is fine in CLI/dashboard.
      'no-console': 'off',
      // Prefer `const` but don't fail on `let` for mutable locals.
      'prefer-const': 'warn',
      // Catch truly dangerous errors as errors.
      'no-debugger': 'error',
      'no-alert': 'error',
    },
  },
  {
    // Test files: relax a few rules.
    files: ['**/*.test.ts', '**/*.test.tsx', '**/tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
