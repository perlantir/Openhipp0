/**
 * Mattermost bridge — REST for send, WebSocket for receive.
 *
 * Production uses the official mattermost-client; tests inject a stub
 * transport. Threads and slash commands are first-class.
 */

import {
  Hipp0BridgeNotConnectedError,
  Hipp0BridgeSendError,
  type BridgeCapabilities,
  type ErrorHandler,
  type IncomingMessage,
  type MessageBridge,
  type MessageHandler,
  type OutgoingMessage,
} from './types.js';

const PLATFORM = 'mattermost' as const;

export interface MattermostRawPost {
  id: string;
  channelId: string;
  userId: string;
  username?: string;
  message: string;
  createAt: number;
  rootId?: string;
  isBot?: boolean;
}

export interface MattermostTransport {
  start(handlers: {
    onPost: (post: MattermostRawPost) => void;
    onError: (err: unknown) => void;
  }): Promise<void>;
  stop(): Promise<void>;
  createPost(channelId: string, message: string, opts?: { rootId?: string }): Promise<void>;
}

export interface MattermostBridgeOptions {
  selfUserId?: string;
  adminUserIds?: readonly string[];
  transport: MattermostTransport;
}

export class MattermostBridge implements MessageBridge {
  readonly platform = PLATFORM;
  private connected = false;
  private handlers: MessageHandler[] = [];
  private errorHandlers: ErrorHandler[] = [];
  private admins: Set<string>;

  constructor(private readonly opts: MattermostBridgeOptions) {
    this.admins = new Set(opts.adminUserIds ?? []);
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    await this.opts.transport.start({
      onPost: (p) => this.ingest(p),
      onError: (e) => this.emitError(e),
    });
    this.connected = true;
  }
  async disconnect(): Promise<void> {
    if (!this.connected) return;
    await this.opts.transport.stop().catch(() => undefined);
    this.connected = false;
  }
  isConnected(): boolean {
    return this.connected;
  }
  onMessage(h: MessageHandler): void {
    this.handlers.push(h);
  }
  onError(h: ErrorHandler): void {
    this.errorHandlers.push(h);
  }

  async send(channelId: string, content: OutgoingMessage): Promise<void> {
    if (!this.connected) throw new Hipp0BridgeNotConnectedError(PLATFORM);
    try {
      await this.opts.transport.createPost(channelId, content.text, {
        ...(content.threadId !== undefined && { rootId: content.threadId }),
      });
    } catch (err) {
      throw new Hipp0BridgeSendError(PLATFORM, err);
    }
  }

  getCapabilities(): BridgeCapabilities {
    return { files: true, buttons: false, threads: true, slashCommands: true, maxMessageBytes: 4_000 };
  }

  private ingest(post: MattermostRawPost): void {
    if (post.isBot) return;
    if (this.opts.selfUserId && post.userId === this.opts.selfUserId) return;
    const msg: IncomingMessage = {
      platform: PLATFORM,
      id: post.id,
      channel: {
        id: post.channelId,
        ...(post.rootId !== undefined && { threadId: post.rootId }),
      },
      user: {
        id: post.userId,
        name: post.username ?? post.userId,
        isAdmin: this.admins.has(post.userId),
      },
      text: post.message,
      timestamp: post.createAt,
      ...(post.rootId !== undefined && { replyTo: post.rootId }),
    };
    this.dispatch(msg);
  }

  private dispatch(msg: IncomingMessage): void {
    for (const h of this.handlers) {
      try {
        const r = h(msg);
        if (r && typeof (r as Promise<void>).catch === 'function') {
          (r as Promise<void>).catch((e) => this.emitError(e));
        }
      } catch (e) {
        this.emitError(e);
      }
    }
  }
  private emitError(err: unknown): void {
    for (const h of this.errorHandlers) {
      try {
        h(err);
      } catch {
        /* swallow */
      }
    }
  }
}
