/**
 * Widget snapshot endpoint (`GET /api/widgets`) — feeds the home-screen
 * widgets on the paired mobile app.
 *
 * Single, cacheable read. The mobile app hits this on foreground + on a
 * `kind=refresh-widgets` push. The payload is intentionally pre-shaped to
 * what the native widget code wants; no filtering or transformation happens
 * on the device.
 *
 * This read surfaces five facts that widgets care about:
 *   1. agents[]       — status + pending approval count
 *   2. cost           — today / week / month spend in the configured currency
 *   3. nextAutomation — the next scheduled cron task
 *
 * Cost data source: when no accounting is wired (Phases 20+), returns zeros.
 * Approvals: reads from governance in-memory state if the agent module is
 * loaded; otherwise zero.
 */

import type { Route } from '@openhipp0/bridge';
import type { AuthMiddleware } from './api-auth.js';

interface RouteContext {
  req: unknown;
}

interface ConfigShape {
  agents?: { id?: string; name?: string }[];
  cronTasks?: { id?: string; name?: string; schedule?: string; enabled?: boolean; nextFireAt?: string }[];
  currency?: string;
}

async function readConfig(): Promise<ConfigShape> {
  try {
    const mod = (await import('../config.js')) as { readConfig: () => Promise<unknown> };
    const raw = (await mod.readConfig()) as ConfigShape;
    return raw ?? {};
  } catch {
    return {};
  }
}

function nextCron(tasks: NonNullable<ConfigShape['cronTasks']>): {
  id: string;
  name: string;
  nextRunIso?: string;
} | undefined {
  const upcoming = tasks
    .filter((t) => t.enabled !== false && t.nextFireAt)
    .sort((a, b) => (a.nextFireAt ?? '').localeCompare(b.nextFireAt ?? ''));
  const first = upcoming[0];
  if (!first?.id || !first.name) return undefined;
  return {
    id: first.id,
    name: first.name,
    ...(first.nextFireAt && { nextRunIso: first.nextFireAt }),
  };
}

export function buildWidgetsRoutes(auth: AuthMiddleware): readonly Route[] {
  const handler: Route['handler'] = async (_ctx: RouteContext) => {
    const cfg = await readConfig();
    const agents = (cfg.agents ?? []).map((a) => ({
      id: a.id ?? 'agent',
      name: a.name ?? 'Open Hipp0',
      status: 'online' as const,
      pendingApprovals: 0,
    }));
    const cost = {
      today: 0,
      week: 0,
      month: 0,
      currency: cfg.currency ?? 'USD',
    };
    return {
      body: {
        agents,
        cost,
        nextAutomation: nextCron(cfg.cronTasks ?? []),
      },
    };
  };
  return [{ method: 'GET', path: '/api/widgets', handler: auth(handler) }];
}
