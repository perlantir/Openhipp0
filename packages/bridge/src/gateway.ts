/**
 * Gateway — runs a fleet of MessageBridges and routes their traffic through
 * an agent (any object implementing `handleMessage(req) → AgentResponse`).
 *
 * Responsibilities:
 *   - Connect all configured bridges on start(); disconnect on stop().
 *   - For each incoming message: derive a session key (platform+user+channel),
 *     fetch or create its conversation buffer, invoke the agent, append the
 *     assistant reply to the buffer, send it back through the origin bridge.
 *   - Cap each session's buffer (default 40 messages — newer kept).
 *   - Drop messages from the bot itself (handled inside each bridge already)
 *     and from users whose `isAdmin=false` for channels that require admin
 *     (opt-in via `requireAdminChannels`).
 *   - Errors in one session never affect another.
 *
 * The agent dependency is structural: anything with `handleMessage(req):
 * Promise<AgentResponse>` works — tests pass a stub, production passes a
 * real AgentRuntime from @openhipp0/core.
 */

import type { AgentResponse, HandleMessageRequest, Message } from '@openhipp0/core';
import {
  Hipp0BridgeError,
  type IncomingMessage,
  type MessageBridge,
  type OutgoingMessage,
  type Platform,
} from './types.js';

export interface GatewayAgent {
  handleMessage(req: HandleMessageRequest): Promise<AgentResponse>;
}

export interface GatewayConfig {
  bridges: readonly MessageBridge[];
  agent: GatewayAgent;
  /** Max messages kept per session buffer. Default 40. */
  sessionBufferSize?: number;
  /** Channels in this set require isAdmin=true on the incoming user. */
  requireAdminChannels?: readonly string[];
  /** If set, every outgoing reply carries these buttons (e.g. "thumbs up/down"). */
  defaultButtons?: OutgoingMessage['buttons'];
  /** Logs every routed exchange. Default: no-op. */
  onExchange?: (evt: ExchangeEvent) => void;
  /** Error sink. Default: rethrows on start() only. */
  onError?: (err: unknown, origin?: { platform: Platform; msgId: string }) => void;
}

export interface ExchangeEvent {
  platform: Platform;
  channelId: string;
  userId: string;
  inboundId: string;
  inboundText: string;
  outboundText: string;
  iterations: number;
  toolCallsCount: number;
  startedAt: number;
  finishedAt: number;
}

interface Session {
  key: string;
  platform: Platform;
  channelId: string;
  userId: string;
  conversation: Message[];
}

export class Gateway {
  private readonly sessions = new Map<string, Session>();
  private readonly bridges: readonly MessageBridge[];
  private started = false;

  constructor(private readonly config: GatewayConfig) {
    this.bridges = config.bridges;
  }

  async start(): Promise<void> {
    if (this.started) return;
    for (const b of this.bridges) {
      b.onMessage((msg) => {
        void this.route(b, msg);
      });
      b.onError((err) => this.config.onError?.(err));
    }
    await Promise.all(this.bridges.map((b) => b.connect()));
    this.started = true;
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    await Promise.all(
      this.bridges.map(async (b) => {
        try {
          await b.disconnect();
        } catch (err) {
          this.config.onError?.(err);
        }
      }),
    );
    this.started = false;
    this.sessions.clear();
  }

  /** Per-platform bridge accessor, e.g. for admin tooling. */
  getBridge(platform: Platform): MessageBridge | undefined {
    return this.bridges.find((b) => b.platform === platform);
  }

  /** Snapshot of live session keys. */
  listSessions(): string[] {
    return [...this.sessions.keys()];
  }

  // ─────────────────────────────────────────────────────────────────────────

  private sessionKey(msg: IncomingMessage): string {
    return `${msg.platform}|${msg.user.id}|${msg.channel.id}`;
  }

  private getOrCreateSession(msg: IncomingMessage): Session {
    const key = this.sessionKey(msg);
    const existing = this.sessions.get(key);
    if (existing) return existing;
    const s: Session = {
      key,
      platform: msg.platform,
      channelId: msg.channel.id,
      userId: msg.user.id,
      conversation: [],
    };
    this.sessions.set(key, s);
    return s;
  }

  private async route(bridge: MessageBridge, msg: IncomingMessage): Promise<void> {
    const started = Date.now();
    const requireAdmin = this.config.requireAdminChannels?.includes(msg.channel.id) ?? false;
    if (requireAdmin && !msg.user.isAdmin) {
      this.config.onError?.(
        new Hipp0BridgeError(
          `non-admin user in admin-only channel: ${msg.user.id} @ ${msg.channel.id}`,
          msg.platform,
        ),
        { platform: msg.platform, msgId: msg.id },
      );
      return;
    }

    const session = this.getOrCreateSession(msg);
    const maxBuf = this.config.sessionBufferSize ?? 40;

    let response: AgentResponse;
    try {
      response = await this.config.agent.handleMessage({
        userId: msg.user.id,
        message: msg.text,
        // Snapshot: the agent must not see later pushes through a shared reference.
        conversation: session.conversation.slice(),
      });
    } catch (err) {
      this.config.onError?.(err, { platform: msg.platform, msgId: msg.id });
      return;
    }

    // Append the user turn + assistant reply to the session buffer.
    session.conversation.push({ role: 'user', content: msg.text });
    session.conversation.push({ role: 'assistant', content: response.text });
    if (session.conversation.length > maxBuf) {
      // Drop oldest pairs until under cap.
      session.conversation.splice(0, session.conversation.length - maxBuf);
    }

    // Prefer the client's reference (platformData.clientRef, set by WebBridge
    // when the client supplied an id) so browsers can correlate responses
    // against the id they originally sent. Falls back to the server-authored
    // message id for platforms that don't carry a clientRef.
    const clientRef =
      msg.platformData && typeof (msg.platformData as Record<string, unknown>)['clientRef'] === 'string'
        ? ((msg.platformData as Record<string, unknown>)['clientRef'] as string)
        : undefined;
    const outgoing: OutgoingMessage = {
      text: response.text || '(no response)',
      ...(this.config.defaultButtons && { buttons: this.config.defaultButtons }),
      replyTo: clientRef ?? msg.id,
    };
    try {
      await bridge.send(msg.channel.id, outgoing);
    } catch (err) {
      this.config.onError?.(err, { platform: msg.platform, msgId: msg.id });
    }

    this.config.onExchange?.({
      platform: msg.platform,
      channelId: msg.channel.id,
      userId: msg.user.id,
      inboundId: msg.id,
      inboundText: msg.text,
      outboundText: response.text,
      iterations: response.iterations,
      toolCallsCount: response.toolCallsCount,
      startedAt: started,
      finishedAt: Date.now(),
    });
  }
}
