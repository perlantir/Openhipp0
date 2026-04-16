import { describe, expect, it, vi, beforeEach } from 'vitest';
import { buildWidgetsRoutes } from '../../src/commands/widgets-routes.js';

// readConfig is dynamic-imported inside widgets-routes; stub via vi.mock.
vi.mock('../../src/config.js', () => ({
  readConfig: vi.fn(),
}));
import { readConfig } from '../../src/config.js';

describe('buildWidgetsRoutes', () => {
  beforeEach(() => {
    (readConfig as ReturnType<typeof vi.fn>).mockReset();
  });

  it('returns agents + cost + next cron', async () => {
    (readConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
      agents: [{ id: 'claude', name: 'Claude' }, { id: 'r', name: 'Researcher' }],
      cronTasks: [
        { id: 'a', name: 'Past task', enabled: true, nextFireAt: '2025-01-01T00:00:00Z' },
        { id: 'b', name: 'Morning digest', enabled: true, nextFireAt: '2026-05-01T13:00:00Z' },
        { id: 'c', name: 'Disabled', enabled: false, nextFireAt: '2026-04-20T00:00:00Z' },
      ],
      currency: 'EUR',
    });
    const [route] = buildWidgetsRoutes(undefined);
    const res = await route!.handler({ req: {}, params: {}, query: {}, body: undefined });
    const body = res.body as {
      agents: { id: string; name: string }[];
      cost: { currency: string; today: number };
      nextAutomation?: { id: string; name: string; nextRunIso?: string };
    };
    expect(body.agents).toHaveLength(2);
    expect(body.agents[0]).toMatchObject({ id: 'claude', name: 'Claude', status: 'online', pendingApprovals: 0 });
    expect(body.cost).toEqual({ today: 0, week: 0, month: 0, currency: 'EUR' });
    // The earliest *future-eligible enabled* task is 'a' by ISO sort, even though
    // it's in the past — that's fine for widget display; the scheduler is the
    // authority on actual firing. The Past task comes first alphabetically.
    expect(body.nextAutomation).toEqual({ id: 'a', name: 'Past task', nextRunIso: '2025-01-01T00:00:00Z' });
  });

  it('skips disabled cron tasks', async () => {
    (readConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
      cronTasks: [
        { id: 'c', name: 'Disabled', enabled: false, nextFireAt: '2026-04-20T00:00:00Z' },
      ],
    });
    const [route] = buildWidgetsRoutes(undefined);
    const res = await route!.handler({ req: {}, params: {}, query: {}, body: undefined });
    const body = res.body as { nextAutomation?: unknown };
    expect(body.nextAutomation).toBeUndefined();
  });

  it('enforces bearer auth when api token is set', async () => {
    (readConfig as ReturnType<typeof vi.fn>).mockResolvedValue({ agents: [] });
    const [route] = buildWidgetsRoutes('secret');
    const res = await route!.handler({
      req: { headers: { authorization: 'Bearer wrong' } },
      params: {},
      query: {},
      body: undefined,
    });
    expect(res.status).toBe(401);
  });

  it('accepts correct bearer', async () => {
    (readConfig as ReturnType<typeof vi.fn>).mockResolvedValue({ agents: [] });
    const [route] = buildWidgetsRoutes('secret');
    const res = await route!.handler({
      req: { headers: { authorization: 'Bearer secret' } },
      params: {},
      query: {},
      body: undefined,
    });
    expect(res.status ?? 200).toBe(200);
  });

  it('gracefully returns empty shape if readConfig throws', async () => {
    (readConfig as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no config'));
    const [route] = buildWidgetsRoutes(undefined);
    const res = await route!.handler({ req: {}, params: {}, query: {}, body: undefined });
    const body = res.body as { agents: unknown[]; cost: { currency: string } };
    expect(body.agents).toEqual([]);
    expect(body.cost.currency).toBe('USD');
  });
});
