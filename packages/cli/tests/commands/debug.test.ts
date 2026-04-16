import { describe, expect, it } from 'vitest';
import { runDebugBundle, runDebugErrorCodes, runDebugExplain } from '../../src/commands/debug.js';

describe('runDebugBundle', () => {
  it('emits a redacted, fenced bundle', async () => {
    const result = await runDebugBundle({
      source: {
        async sections() {
          return [
            { name: 'logs', text: 'api key sk-ant-abc123def456 used' },
            { name: 'config', json: { token: 'hunter2', port: 3100 } },
          ];
        },
      },
      now: () => '2026-04-16T00:00:00Z',
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout[0]).toContain('```json');
    expect(result.stdout[0]).not.toContain('sk-ant-abc123def456');
    expect(result.stdout[0]).not.toContain('hunter2');
  });
});

describe('runDebugErrorCodes', () => {
  it('lists all registry entries', async () => {
    const result = await runDebugErrorCodes();
    const joined = result.stdout.join('\n');
    expect(joined).toContain('HIPP0-0004');
    expect(joined).toContain('cause:');
    expect(joined).toContain('fix:');
  });
});

describe('runDebugExplain', () => {
  it('returns one-line for a known code', async () => {
    const result = await runDebugExplain('HIPP0_BUDGET_EXCEEDED');
    expect(result.stdout[0]).toContain('HIPP0-0004');
  });

  it('throws on an unknown code', async () => {
    await expect(runDebugExplain('HIPP0-9999')).rejects.toThrow(/No registry entry/);
  });
});
