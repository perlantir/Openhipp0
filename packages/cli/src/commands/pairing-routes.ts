/**
 * Pairing REST routes for Phase 19 mobile-app pairing.
 *
 *   POST /api/pairing/issue       — dashboard issues a QR payload (auth'd)
 *   POST /api/pairing/complete    — mobile redeems the token (open endpoint;
 *                                   the one-shot token + E2E sealed envelope
 *                                   authenticate by themselves)
 *   GET  /api/pairing/devices     — list paired devices (auth'd)
 *   DELETE /api/pairing/devices/:deviceId — unpair (auth'd)
 *
 * Storage: SqlitePairingSessionStore + SqlitePairedDeviceStore so sessions
 * survive server restarts.
 */

import type { Route } from '@openhipp0/bridge';
import type { AuthMiddleware } from './api-auth.js';

interface RouteContext {
  req: unknown;
  params: Record<string, string>;
  body?: unknown;
}

export interface PairingDeps {
  sessionStore: import('@openhipp0/core').pairing.PairingSessionStore;
  deviceStore: import('@openhipp0/core').pairing.PairedDeviceStore;
  /** Host's advertised server URL (used in QR payload). */
  serverUrl: string;
  /** Stable server id shown in QR. */
  serverId: string;
}

export function buildPairingRoutes(auth: AuthMiddleware, deps: PairingDeps): readonly Route[] {
  const issue: Route['handler'] = async (ctx: RouteContext) => {
    const body = ctx.body as
      | { ttlMs?: number; connectionMethod?: 'tailscale' | 'cloudflare' | 'relay' | 'lan' }
      | undefined;
    const core = await import('@openhipp0/core');
    const payload = await core.pairing.issuePairing(
      {
        serverId: deps.serverId,
        serverUrl: deps.serverUrl,
        connectionMethod: body?.connectionMethod ?? 'lan',
        ...(body?.ttlMs !== undefined && { ttlMs: body.ttlMs }),
      },
      deps.sessionStore,
    );
    return { body: payload };
  };

  const complete: Route['handler'] = async (ctx: RouteContext) => {
    try {
      const core = await import('@openhipp0/core');
      const { response } = await core.pairing.redeemPairing(
        ctx.body,
        deps.sessionStore,
        deps.deviceStore,
      );
      return { body: response };
    } catch (err) {
      const name = err instanceof Error ? err.name : 'Error';
      const message = err instanceof Error ? err.message : String(err);
      const status =
        name.includes('Expired') || name.includes('Unknown') || name.includes('AlreadyUsed')
          ? 400
          : 500;
      return { status, body: { error: name, message } };
    }
  };

  const listDevices: Route['handler'] = async () => {
    const rows = await deps.deviceStore.list();
    // Don't leak server secret keys to the dashboard.
    const sanitized = rows.map((d) => ({
      deviceId: d.deviceId,
      deviceName: d.deviceName,
      platform: d.platform,
      pairedAt: d.pairedAt,
    }));
    return { body: { devices: sanitized } };
  };

  const removeDevice: Route['handler'] = async (ctx: RouteContext) => {
    const id = ctx.params['deviceId'];
    if (!id) return { status: 400, body: { error: 'deviceId required' } };
    await deps.deviceStore.remove(id);
    return { status: 204 };
  };

  return [
    { method: 'POST', path: '/api/pairing/issue', handler: auth(issue) },
    // /complete intentionally UNAUTHENTICATED — the pairing token is the credential.
    { method: 'POST', path: '/api/pairing/complete', handler: complete },
    { method: 'GET', path: '/api/pairing/devices', handler: auth(listDevices) },
    { method: 'DELETE', path: '/api/pairing/devices/:deviceId', handler: auth(removeDevice) },
  ];
}
