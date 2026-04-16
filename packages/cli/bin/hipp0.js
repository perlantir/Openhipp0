#!/usr/bin/env node
// hipp0 — CLI entrypoint. Delegates to runCli() from ../src/index.ts.
// In production this file loads the compiled dist/index.js; for local dev
// (pnpm link or workspace bin), tsx/ts-node may resolve the src directly.
import { runCli } from '../dist/index.js';
runCli(process.argv.slice(2));
