/**
 * Default `KeyringExec` using `node:child_process`. Callers wire a
 * different impl for tests.
 */

import { spawn } from 'node:child_process';

import type { KeyringExec } from './types.js';

export const nodeKeyringExec: KeyringExec = {
  async run(cmd, args, options = {}) {
    return await new Promise((resolve, reject) => {
      const child = spawn(cmd, args, {
        env: options.env ?? process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d: Buffer) => {
        stdout += d.toString('utf8');
      });
      child.stderr.on('data', (d: Buffer) => {
        stderr += d.toString('utf8');
      });
      child.on('error', reject);
      child.on('close', (code) => {
        resolve({ stdout, stderr, code: code ?? 0 });
      });
      if (options.stdin !== undefined) {
        child.stdin.write(options.stdin);
      }
      child.stdin.end();
    });
  },
};
