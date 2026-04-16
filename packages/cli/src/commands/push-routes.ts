/**
 * Push registration routes for the mobile app (`/api/push/*`).
 * Full implementation lands in Phase 19C (server-side sender).
 *
 *   POST /api/push/register   — body: { deviceId, pushToken, platform } → { ok: true }
 *
 * The actual push-event wiring (seal → Expo / APNS / FCM) is owned by the
 * Phase 19C sender in `@openhipp0/core/push`. This route only persists the
 * device → push-token mapping, so the mobile app can register even before
 * the sender is wired in.
 */

import type { Route } from '@openhipp0/bridge';
import type { AuthMiddleware } from './api-auth.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

interface RouteContext {
  req: unknown;
  body?: unknown;
}

function registryPath(): string {
  const home = process.env['HIPP0_HOME'] ?? path.join(os.homedir(), '.hipp0');
  return path.join(home, 'push-registry.json');
}

async function readRegistry(): Promise<Record<string, { pushToken: string; platform: string; updatedAt: string }>> {
  try {
    const raw = await fs.readFile(registryPath(), 'utf8');
    return JSON.parse(raw) as Record<string, { pushToken: string; platform: string; updatedAt: string }>;
  } catch {
    return {};
  }
}

async function writeRegistry(
  data: Record<string, { pushToken: string; platform: string; updatedAt: string }>,
): Promise<void> {
  const p = registryPath();
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(data, null, 2), { mode: 0o600 });
}

export function buildPushRoutes(auth: AuthMiddleware): readonly Route[] {
  const register: Route['handler'] = async (ctx: RouteContext) => {
    const body = ctx.body as
      | { deviceId?: string; pushToken?: string; platform?: 'ios' | 'android' }
      | undefined;
    if (!body?.deviceId || !body.pushToken || !body.platform) {
      return { status: 400, body: { error: 'deviceId, pushToken, platform required' } };
    }
    if (body.platform !== 'ios' && body.platform !== 'android') {
      return { status: 400, body: { error: 'platform must be ios or android' } };
    }
    const registry = await readRegistry();
    registry[body.deviceId] = {
      pushToken: body.pushToken,
      platform: body.platform,
      updatedAt: new Date().toISOString(),
    };
    await writeRegistry(registry);
    return { body: { ok: true } };
  };

  return [{ method: 'POST', path: '/api/push/register', handler: auth(register) }];
}
