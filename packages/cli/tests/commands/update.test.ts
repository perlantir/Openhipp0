import { describe, it, expect, vi } from 'vitest';
import { runUpdate } from '../../src/commands/misc.js';

function fakeFetch(body: unknown, status = 200): typeof fetch {
  return vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })) as unknown as typeof fetch;
}

function okExec(): (cmd: string) => Promise<{ stdout: string; stderr: string; code: number }> {
  return vi.fn(async () => ({ stdout: 'ok', stderr: '', code: 0 }));
}

describe('runUpdate', () => {
  it('--check reports current + latest without executing', async () => {
    const fetcher = fakeFetch({ 'dist-tags': { latest: '2.0.0' } });
    const r = await runUpdate({ check: true, fetch: fetcher, currentVersion: '1.0.0' });
    expect(r.exitCode).toBe(0);
    expect(r.stdout!.some((l) => l.includes('1.0.0'))).toBe(true);
    expect(r.stdout!.some((l) => l.includes('2.0.0'))).toBe(true);
  });

  it('--check when up-to-date says "up to date"', async () => {
    const fetcher = fakeFetch({ 'dist-tags': { latest: '1.0.0' } });
    const r = await runUpdate({ check: true, fetch: fetcher, currentVersion: '1.0.0' });
    expect(r.stdout!.some((l) => l.includes('up to date'))).toBe(true);
  });

  it('--dry-run prints intent without invoking npm', async () => {
    const fetcher = fakeFetch({ 'dist-tags': { latest: '2.0.0' } });
    const exec = okExec();
    const r = await runUpdate({ dryRun: true, fetch: fetcher, exec, currentVersion: '1.0.0' });
    expect(r.exitCode).toBe(0);
    expect(exec).not.toHaveBeenCalled();
    expect(r.stdout!.join('\n')).toContain('1.0.0 → 2.0.0');
  });

  it('upgrade path runs npm install then hipp0 doctor', async () => {
    const fetcher = fakeFetch({ 'dist-tags': { latest: '2.0.0' } });
    const exec = vi.fn(async () => ({ stdout: '', stderr: '', code: 0 }));
    const r = await runUpdate({ fetch: fetcher, exec, currentVersion: '1.0.0' });
    expect(r.exitCode).toBe(0);
    const commands = exec.mock.calls.map((c) => c[0]);
    expect(commands.some((c) => c.includes('npm install -g @openhipp0/cli@2.0.0'))).toBe(true);
    expect(commands.some((c) => c === 'hipp0 doctor')).toBe(true);
  });

  it('auto-rolls-back if post-upgrade doctor fails', async () => {
    const fetcher = fakeFetch({ 'dist-tags': { latest: '2.0.0' } });
    const exec = vi.fn(async (cmd: string) => {
      if (cmd === 'hipp0 doctor') return { stdout: '', stderr: 'bad', code: 1 };
      return { stdout: '', stderr: '', code: 0 };
    });
    const r = await runUpdate({ fetch: fetcher, exec, currentVersion: '1.0.0' });
    expect(r.exitCode).toBe(1);
    expect(exec.mock.calls.some((c) => c[0].includes('@openhipp0/cli@1.0.0'))).toBe(true);
  });

  it('--rollback invokes npm install with @previous', async () => {
    const exec = vi.fn(async () => ({ stdout: '', stderr: '', code: 0 }));
    const r = await runUpdate({ rollback: true, exec });
    expect(r.exitCode).toBe(0);
    expect(exec.mock.calls[0]?.[0]).toBe('npm install -g @openhipp0/cli@previous');
  });
});
