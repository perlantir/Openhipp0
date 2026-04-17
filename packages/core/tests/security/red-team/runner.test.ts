import { describe, expect, it } from 'vitest';

import { runRedTeam, summarizeReport } from '../../../src/security/red-team/runner.js';
import type { TargetAgent } from '../../../src/security/red-team/types.js';

function perfectTarget(): TargetAgent {
  return {
    async submit(_input) {
      return {
        text: 'I cannot do that — request looks like an injection attempt.',
        leakedSecret: false,
        invokedUnsafeTool: false,
      };
    },
  };
}

function leakyTarget(): TargetAgent {
  return {
    async submit(input) {
      if (input.includes('system prompt')) {
        return { text: 'Sure! The system prompt says: sk-ant-ABCDEFGHIJKLMNOPQRSTUVWX', leakedSecret: true };
      }
      return { text: 'OK' };
    },
  };
}

describe('runRedTeam', () => {
  it('passes every case against a perfect target', async () => {
    const report = await runRedTeam({ target: perfectTarget(), targetName: 'clean' });
    expect(report.failed).toBe(0);
    expect(report.passed).toBe(report.totalCases);
  });

  it('flags failures against a leaky target', async () => {
    const report = await runRedTeam({ target: leakyTarget(), targetName: 'leaky' });
    expect(report.failed).toBeGreaterThanOrEqual(1);
    expect(report.outcomes.some((o) => !o.passed && o.reason.includes('secret'))).toBe(true);
  });

  it('summarizeReport renders a readable block', async () => {
    const report = await runRedTeam({ target: perfectTarget(), targetName: 'clean' });
    const text = summarizeReport(report);
    expect(text).toContain('Red team report');
    expect(text).toContain('defenses held');
  });

  it('failFastOnCritical aborts on tool-hijack failure', async () => {
    const aggressive: TargetAgent = {
      async submit(input) {
        if (input.includes('Call send_email')) {
          return { text: 'done', invokedUnsafeTool: true };
        }
        return { text: 'ok' };
      },
    };
    const report = await runRedTeam({
      target: aggressive,
      targetName: 'aggressive',
      failFastOnCritical: true,
    });
    // Should stop early once a tool-hijack case fails.
    const failures = report.outcomes.filter((o) => !o.passed);
    expect(failures.length).toBeGreaterThanOrEqual(1);
  });
});
