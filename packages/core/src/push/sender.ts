/**
 * PushSender — fan-out a single PushEvent to every registered mobile device
 * via the Expo push API. Transport is injectable so tests run offline and
 * ops can swap in a raw APNS/FCM transport if they don't want the Expo hop.
 *
 * Expo ticket semantics: a `DeviceNotRegistered` error means the Expo token
 * was revoked (app uninstalled, logged out, reset) — the sender auto-prunes
 * those devices from the registry so subsequent fan-outs don't re-send.
 */

import type {
  ExpoPushMessage,
  ExpoPushTicket,
  PushDeviceRecord,
  PushEvent,
  PushRegistry,
  PushTransport,
} from './types.js';

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export interface PushSenderOptions {
  registry: PushRegistry;
  transport?: PushTransport;
  /** Expo access token — optional but recommended in production. */
  expoAccessToken?: string;
  /**
   * Android channel id; mobile app registers "default" at startup (see
   * packages/mobile/src/push/register.ts).
   */
  androidChannelId?: string;
}

export class PushSender {
  private readonly registry: PushRegistry;
  private readonly transport: PushTransport;
  private readonly androidChannelId: string;

  constructor(opts: PushSenderOptions) {
    this.registry = opts.registry;
    this.transport = opts.transport ?? new ExpoHttpTransport(opts.expoAccessToken);
    this.androidChannelId = opts.androidChannelId ?? 'default';
  }

  /** Fan out an event to every registered device. Returns delivery stats. */
  async fanOut(event: PushEvent): Promise<{ delivered: number; pruned: number; failed: number }> {
    const devices = await this.registry.list();
    if (devices.length === 0) return { delivered: 0, pruned: 0, failed: 0 };
    const messages = devices.map((d) => this.toExpoMessage(d, event));
    const tickets = await this.transport.send(messages);
    return this.reconcileTickets(devices, tickets);
  }

  /** Send to a single deviceId; skips silently if unregistered. */
  async sendTo(
    deviceId: string,
    event: PushEvent,
  ): Promise<{ delivered: boolean; pruned: boolean }> {
    const device = await this.registry.get(deviceId);
    if (!device) return { delivered: false, pruned: false };
    const [ticket] = await this.transport.send([this.toExpoMessage(device, event)]);
    if (!ticket) return { delivered: false, pruned: false };
    if (ticket.status === 'ok') return { delivered: true, pruned: false };
    if (isDeadToken(ticket)) {
      await this.registry.remove(device.deviceId);
      return { delivered: false, pruned: true };
    }
    return { delivered: false, pruned: false };
  }

  private toExpoMessage(device: PushDeviceRecord, event: PushEvent): ExpoPushMessage {
    const data: Record<string, unknown> = {
      kind: event.kind,
      ...(event.refId && { refId: event.refId }),
      ...(event.path && { path: event.path }),
      ...(event.data ?? {}),
    };
    const msg: ExpoPushMessage = {
      to: device.pushToken,
      title: event.title,
      body: event.body,
      data,
      priority: event.urgent === false ? 'normal' : 'high',
      sound: event.urgent === false ? null : 'default',
    };
    if (device.platform === 'android') msg.channelId = this.androidChannelId;
    if (event.categoryIdentifier) msg.categoryId = event.categoryIdentifier;
    return msg;
  }

  private async reconcileTickets(
    devices: readonly PushDeviceRecord[],
    tickets: readonly ExpoPushTicket[],
  ): Promise<{ delivered: number; pruned: number; failed: number }> {
    let delivered = 0;
    let pruned = 0;
    let failed = 0;
    for (let i = 0; i < devices.length; i++) {
      const device = devices[i];
      const ticket = tickets[i];
      if (!device || !ticket) continue;
      if (ticket.status === 'ok') delivered++;
      else if (isDeadToken(ticket)) {
        await this.registry.remove(device.deviceId);
        pruned++;
      } else failed++;
    }
    return { delivered, pruned, failed };
  }
}

function isDeadToken(ticket: ExpoPushTicket): boolean {
  return (
    ticket.status === 'error' &&
    (ticket.details?.error === 'DeviceNotRegistered' ||
      ticket.details?.error === 'InvalidCredentials')
  );
}

/**
 * Default transport — POSTs directly to Expo's push endpoint. Expo batches
 * 100 messages per request; we chunk the input to respect that limit.
 */
export class ExpoHttpTransport implements PushTransport {
  private readonly accessToken: string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(accessToken?: string, fetchImpl: typeof fetch = fetch) {
    this.accessToken = accessToken;
    this.fetchImpl = fetchImpl;
  }

  async send(messages: readonly ExpoPushMessage[]): Promise<readonly ExpoPushTicket[]> {
    const chunks: ExpoPushMessage[][] = [];
    for (let i = 0; i < messages.length; i += 100) {
      chunks.push(messages.slice(i, i + 100));
    }
    const tickets: ExpoPushTicket[] = [];
    for (const chunk of chunks) {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
      };
      if (this.accessToken) headers.Authorization = `Bearer ${this.accessToken}`;
      const res = await this.fetchImpl(EXPO_PUSH_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(chunk),
      });
      if (!res.ok) {
        // Expo returned non-200 — mark every message in the chunk as failed
        // with the upstream status so callers can see + alert.
        const detail = await res.text().catch(() => '');
        for (let i = 0; i < chunk.length; i++) {
          tickets.push({ status: 'error', message: `HTTP ${res.status}: ${detail.slice(0, 140)}` });
        }
        continue;
      }
      const payload = (await res.json()) as { data?: ExpoPushTicket[] };
      if (Array.isArray(payload.data)) tickets.push(...payload.data);
    }
    return tickets;
  }
}
