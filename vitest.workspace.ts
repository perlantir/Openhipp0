// Vitest workspace root — points to per-package vitest.config.ts files.
// Using `defineWorkspace` (stable in Vitest 3.x, still supported though the
// `test.projects` field in a root config is the newer alternative). Kept here
// to match the Phase 1b spec; can migrate later without disruption.
//
// Packages added in Phase 1c will each ship their own vitest.config.ts.

import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  // Glob matches any package with its own vitest.config.{ts,js}.
  // Empty-match is safe — vitest just reports no projects.
  'packages/*',
]);
