import { describe, expect, it, vi } from 'vitest';
import { ReconnectSupervisor } from '../src/reconnect.js';

/** Advance fake timers AND flush pending microtasks so awaited connect() resolves. */
async function flushTimers(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

describe('ReconnectSupervisor', () => {
  it('connects successfully and stays connected', async () => {
    const s = new ReconnectSupervisor(async () => undefined);
    await s.start();
    expect(s.getState()).toBe('connected');
  });

  it('schedules reconnects on connect failure, then succeeds', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const fn = vi.fn(async () => {
        calls++;
        if (calls < 3) throw new Error('nope');
      });
      const s = new ReconnectSupervisor(fn, { baseDelayMs: 10, jitter: false });
      await s.start();
      // First attempt failed → state is 'reconnecting', timer scheduled.
      expect(s.getState()).toBe('reconnecting');
      // Second attempt (delay 10ms) still fails.
      await flushTimers(10);
      expect(fn).toHaveBeenCalledTimes(2);
      expect(s.getState()).toBe('reconnecting');
      // Third attempt (delay 20ms) succeeds.
      await flushTimers(20);
      expect(fn).toHaveBeenCalledTimes(3);
      expect(s.getState()).toBe('connected');
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up after maxAttempts', async () => {
    vi.useFakeTimers();
    try {
      const onGiveUp = vi.fn();
      const fn = vi.fn(async () => {
        throw new Error('down');
      });
      const s = new ReconnectSupervisor(fn, {
        baseDelayMs: 10,
        jitter: false,
        maxAttempts: 3,
        onGiveUp,
      });
      await s.start();
      await flushTimers(10); // attempt 2
      await flushTimers(20); // attempt 3
      await flushTimers(40); // scheduleReconnect sees attempt >= 3 → give up
      expect(onGiveUp).toHaveBeenCalledOnce();
      expect(s.getState()).toBe('stopped');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reportDisconnect schedules a reconnect', async () => {
    vi.useFakeTimers();
    try {
      const connect = vi.fn(async () => undefined);
      const s = new ReconnectSupervisor(connect, { baseDelayMs: 5, jitter: false });
      await s.start();
      expect(s.getState()).toBe('connected');

      s.reportDisconnect();
      expect(s.getState()).toBe('reconnecting');

      await flushTimers(10);
      expect(connect).toHaveBeenCalledTimes(2);
      expect(s.getState()).toBe('connected');
    } finally {
      vi.useRealTimers();
    }
  });

  it('stop() halts all retries; subsequent start() throws', async () => {
    const s = new ReconnectSupervisor(async () => undefined);
    s.stop();
    await expect(s.start()).rejects.toThrow(/start\(\) after stop\(\)/);
  });

  it('exponential backoff grows without jitter', async () => {
    vi.useFakeTimers();
    try {
      const attempts: number[] = [];
      let fail = true;
      const fn = async (): Promise<void> => {
        if (fail) throw new Error('x');
      };
      const s = new ReconnectSupervisor(fn, {
        baseDelayMs: 10,
        jitter: false,
        onAttempt: (n) => attempts.push(n),
      });
      await s.start();
      // Advance through several attempts.
      await flushTimers(10); // 2nd
      await flushTimers(20); // 3rd
      await flushTimers(40); // 4th
      await flushTimers(80); // 5th
      fail = false;
      await flushTimers(160); // 6th (succeeds)
      expect(attempts).toEqual([1, 2, 3, 4, 5, 6]);
      expect(s.getState()).toBe('connected');
    } finally {
      vi.useRealTimers();
    }
  });
});
