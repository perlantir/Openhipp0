#!/usr/bin/env node
// hipp0 CLI entrypoint. Loads the compiled dist (production).
//
// Note (Phase 8): running directly from source via this binary requires
// every workspace dep's package.json `main` to point at `dist/index.js`
// AND a fix for the @slack/bolt CJS named-import interop in bridge/slack.ts.
// Both land in Phase 9 "Production Hardening" alongside the Docker image
// smoke test. For now the test suite exercises every path through vitest
// (which handles the CJS interop via esbuild).
import { runCli } from '../dist/index.js';
runCli(process.argv.slice(2));
