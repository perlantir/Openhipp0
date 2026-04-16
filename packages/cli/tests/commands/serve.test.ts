import { describe, it, expect } from 'vitest';
import { runServe } from '../../src/commands/serve.js';

describe('runServe', () => {
  it('binds, reports the address, and stops cleanly when once=true', async () => {
    const result = await runServe({ port: 0, once: true });
    expect(result.exitCode).toBe(0);
    const data = result.data as { host: string; port: number } | undefined;
    expect(data?.port).toBeGreaterThan(0);
    expect(result.stdout?.[0]).toMatch(/listening on http:/);
  });
});
