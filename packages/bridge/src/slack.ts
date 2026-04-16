/**
 * Slack bridge — built on @slack/bolt.
 *
 * Scope: socket-mode or HTTP-mode App. Listens for `message` events +
 * `block_actions` (button clicks). Sends text + optional buttons via
 * Block Kit action blocks. Threads are supported via `threadId`
 * (thread_ts).
 *
 * The `App` is injectable for tests. Production callers supply
 * `botToken` + (either `appToken` for socket mode or `signingSecret`
 * for HTTP mode).
 */

import bolt from '@slack/bolt';
import type { App as AppType, SlackEventMiddlewareArgs, SlackAction } from '@slack/bolt';
// @slack/bolt is CJS; native Node ESM requires default-import + runtime
// destructure (named imports only work through bundlers/esbuild/tsx).
// `import type` is erased at compile time, so it works regardless.
const { App } = bolt as { App: typeof AppType };
type App = AppType;
import {
  Hipp0BridgeNotConnectedError,
  Hipp0BridgeSendError,
  type BridgeCapabilities,
  type ErrorHandler,
  type IncomingMessage,
  type MessageBridge,
  type MessageHandler,
  type OutgoingButton,
  type OutgoingMessage,
} from './types.js';

const SLACK_PLATFORM = 'slack' as const;

export interface SlackBridgeOptions {
  botToken?: string; // xoxb-…; SLACK_BOT_TOKEN
  appToken?: string; // xapp-…; SLACK_APP_TOKEN (socket mode)
  signingSecret?: string; // SLACK_SIGNING_SECRET (HTTP mode)
  socketMode?: boolean;
  adminUserIds?: readonly string[];
  /** Injected App for tests. */
  app?: App;
  /** HTTP port when socketMode=false. Default 3201. */
  port?: number;
}

export class SlackBridge implements MessageBridge {
  readonly platform = SLACK_PLATFORM;
  private app: App | undefined;
  private connected = false;
  private handlers: MessageHandler[] = [];
  private errorHandlers: ErrorHandler[] = [];
  private admins: Set<string>;

  constructor(private readonly opts: SlackBridgeOptions = {}) {
    this.admins = new Set(opts.adminUserIds ?? []);
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    const app =
      this.opts.app ??
      new App({
        token: this.opts.botToken ?? process.env.SLACK_BOT_TOKEN,
        ...(this.opts.socketMode !== false && {
          socketMode: true,
          appToken: this.opts.appToken ?? process.env.SLACK_APP_TOKEN,
        }),
        ...(!this.opts.socketMode && {
          signingSecret: this.opts.signingSecret ?? process.env.SLACK_SIGNING_SECRET,
        }),
      });
    this.app = app;

    app.message(async (args) => this.handleMessage(args));
    app.action({ type: 'block_actions' }, async (args) =>
      this.handleAction(args as unknown as SlackActionArgs),
    );
    app.error(async (err) => {
      this.emitError(err);
    });

    if (!this.opts.app) {
      await app.start(this.opts.port ?? 3201);
    }
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    try {
      await this.app?.stop();
    } catch {
      /* ignore */
    }
    this.app = undefined;
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  onMessage(handler: MessageHandler): void {
    this.handlers.push(handler);
  }

  onError(handler: ErrorHandler): void {
    this.errorHandlers.push(handler);
  }

  async send(channelId: string, content: OutgoingMessage): Promise<void> {
    if (!this.connected || !this.app) {
      throw new Hipp0BridgeNotConnectedError(SLACK_PLATFORM);
    }
    const blocks = buildBlocks(content);
    try {
      await this.app.client.chat.postMessage({
        channel: channelId,
        text: content.text,
        ...(blocks.length > 0 && { blocks: blocks as unknown as never }),
        ...(content.threadId && { thread_ts: content.threadId }),
      });
    } catch (err) {
      throw new Hipp0BridgeSendError(SLACK_PLATFORM, err);
    }
  }

  getCapabilities(): BridgeCapabilities {
    return {
      files: true,
      buttons: true,
      threads: true,
      slashCommands: true,
      maxMessageBytes: 40_000,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────

  private async handleMessage(args: SlackEventMiddlewareArgs<'message'>): Promise<void> {
    const event = args.event;
    // `subtype` present → bot message / edit / join / etc. Skip those.
    if ('subtype' in event && event.subtype) return;
    // Only handle events with user + text; drop others.
    if (!('user' in event) || !('text' in event)) return;

    const userId = event.user as string;
    const text = (event.text as string | undefined) ?? '';
    const ts = (event.ts as string | undefined) ?? '';
    const channel = (event.channel as string | undefined) ?? '';
    const threadTs = (event as unknown as Record<string, unknown>).thread_ts as string | undefined;

    const msg: IncomingMessage = {
      platform: SLACK_PLATFORM,
      id: ts,
      channel: {
        id: channel,
        ...(threadTs && { threadId: threadTs }),
      },
      user: { id: userId, name: userId, isAdmin: this.admins.has(userId) },
      text,
      timestamp: Number(ts.split('.')[0] ?? 0) * 1000 || Date.now(),
    };
    this.dispatch(msg);
  }

  private handleAction(args: SlackActionArgs): void {
    const action = args.action;
    const user = args.body.user;
    const channelId = args.body.channel?.id ?? '';
    const actionId = ('action_id' in action ? action.action_id : '') ?? '';
    const value = 'value' in action ? ((action.value as string | undefined) ?? actionId) : actionId;

    const msg: IncomingMessage = {
      platform: SLACK_PLATFORM,
      id: `action:${args.body.trigger_id ?? actionId}`,
      channel: { id: channelId },
      user: {
        id: user?.id ?? 'unknown',
        name: user?.username ?? user?.name ?? 'unknown',
        isAdmin: this.admins.has(user?.id ?? ''),
      },
      text: value,
      timestamp: Date.now(),
      platformData: { frameType: 'block_actions' },
    };
    this.dispatch(msg);

    void args.ack?.().catch((err: unknown) => this.emitError(err));
  }

  private dispatch(msg: IncomingMessage): void {
    for (const h of this.handlers) {
      try {
        const r = h(msg);
        if (r && typeof (r as Promise<void>).catch === 'function') {
          (r as Promise<void>).catch((err) => this.emitError(err));
        }
      } catch (err) {
        this.emitError(err);
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

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

interface SlackActionArgs {
  action: SlackAction & { action_id?: string; value?: string };
  body: {
    user?: { id?: string; name?: string; username?: string };
    channel?: { id?: string };
    trigger_id?: string;
  };
  ack?: () => Promise<void>;
}

function buildBlocks(content: OutgoingMessage): Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = [];
  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: content.text },
  });
  if (content.buttons && content.buttons.length > 0) {
    blocks.push({
      type: 'actions',
      elements: content.buttons.slice(0, 5).map((b) => ({
        type: 'button',
        text: { type: 'plain_text', text: b.label },
        value: b.value,
        action_id: b.value,
        ...(b.style && b.style !== 'secondary' && { style: mapStyle(b.style) }),
      })),
    });
  }
  return blocks;
}

function mapStyle(style: NonNullable<OutgoingButton['style']>): string | undefined {
  if (style === 'primary') return 'primary';
  if (style === 'danger') return 'danger';
  return undefined;
}
