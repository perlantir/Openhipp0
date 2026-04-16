/**
 * Discord bridge — built on discord.js v14.
 *
 * Scope of this implementation:
 *   - Listens for `messageCreate` events in guild channels + DMs.
 *   - Skips its own bot's messages (echo loop protection).
 *   - Sends text + optional button rows (up to 5 buttons in one action row).
 *   - Exposes attachments (file URLs) on incoming + accepts attachment URLs
 *     on outgoing (we don't upload raw bytes in this phase — URL-first).
 *
 * For testability, the whole discord.js Client is injectable. Tests pass a
 * fake Client with just `login`, `destroy`, `on`, and a mutable channel map
 * exposing `send`. The event emission is driven by calling
 * `client.emit('messageCreate', fakeMsg)`.
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  GatewayIntentBits,
  type Message as DiscordMessage,
} from 'discord.js';
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

const DISCORD_PLATFORM = 'discord' as const;

export interface DiscordBridgeOptions {
  /** Bot token. Falls back to DISCORD_BOT_TOKEN. */
  token?: string;
  /** Ids of users who should be treated as admins for this bot. */
  adminUserIds?: readonly string[];
  /** Injected client for tests. */
  client?: Client;
}

/** Minimal shape we actually use off the channel — lets tests fake just this. */
interface ChannelSendable {
  send(content: unknown): Promise<unknown>;
}

export class DiscordBridge implements MessageBridge {
  readonly platform = DISCORD_PLATFORM;
  private client: Client | undefined;
  private connected = false;
  private handlers: MessageHandler[] = [];
  private errorHandlers: ErrorHandler[] = [];
  private admins: Set<string>;

  constructor(private readonly opts: DiscordBridgeOptions = {}) {
    this.admins = new Set(opts.adminUserIds ?? []);
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    const client =
      this.opts.client ??
      (new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
          GatewayIntentBits.DirectMessages,
        ],
      }) as Client);
    this.client = client;

    client.on('messageCreate', (msg) => this.handleIncoming(msg));
    client.on('error', (err) => this.emitError(err));

    const token = this.opts.token ?? process.env.DISCORD_BOT_TOKEN;
    if (!token && !this.opts.client) {
      throw new Error('DiscordBridge: token not provided (pass `token` or set DISCORD_BOT_TOKEN).');
    }
    await client.login(token ?? 'injected');
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    try {
      await this.client?.destroy();
    } catch {
      /* ignore */
    }
    this.client = undefined;
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
    if (!this.connected || !this.client) {
      throw new Hipp0BridgeNotConnectedError(DISCORD_PLATFORM);
    }
    let channel: ChannelSendable | undefined;
    try {
      const ch = await this.client.channels.fetch(channelId);
      channel = ch as unknown as ChannelSendable;
    } catch (err) {
      throw new Hipp0BridgeSendError(DISCORD_PLATFORM, err);
    }
    if (!channel || typeof channel.send !== 'function') {
      throw new Hipp0BridgeSendError(
        DISCORD_PLATFORM,
        new Error(`channel ${channelId} is not sendable`),
      );
    }
    try {
      await channel.send(this.buildOutgoing(content));
    } catch (err) {
      throw new Hipp0BridgeSendError(DISCORD_PLATFORM, err);
    }
  }

  getCapabilities(): BridgeCapabilities {
    return {
      files: true,
      buttons: true,
      threads: true,
      slashCommands: true,
      maxMessageBytes: 2000,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────

  private handleIncoming(raw: DiscordMessage): void {
    // Skip our own messages
    if (raw.author?.id === this.client?.user?.id) return;
    // Skip webhooks + system messages
    if (raw.webhookId) return;

    const msg: IncomingMessage = {
      platform: DISCORD_PLATFORM,
      id: raw.id,
      channel: {
        id: raw.channel.id,
        ...(raw.guild && { name: `${raw.guild.name}#${raw.channelId}` }),
        isDM: !raw.guildId,
      },
      user: {
        id: raw.author.id,
        name: raw.author.username ?? 'unknown',
        isAdmin: this.admins.has(raw.author.id),
      },
      text: raw.content ?? '',
      timestamp: raw.createdTimestamp,
      ...(raw.reference?.messageId && { replyTo: raw.reference.messageId }),
      attachments: [...raw.attachments.values()].map((a) => ({
        filename: a.name ?? 'file',
        ...(a.contentType && { contentType: a.contentType }),
        ...(typeof a.size === 'number' && { size: a.size }),
        url: a.url,
      })),
      platformData: { guildId: raw.guildId ?? undefined },
    };
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

  private buildOutgoing(content: OutgoingMessage): Record<string, unknown> {
    const out: Record<string, unknown> = { content: content.text };
    if (content.buttons && content.buttons.length > 0) {
      const row = new ActionRowBuilder<ButtonBuilder>();
      for (const b of content.buttons.slice(0, 5)) {
        row.addComponents(
          new ButtonBuilder().setCustomId(b.value).setLabel(b.label).setStyle(mapStyle(b.style)),
        );
      }
      out.components = [row];
    }
    if (content.attachments && content.attachments.length > 0) {
      out.files = content.attachments.map((a) => ({
        attachment: a.url ?? a.content ?? '',
        name: a.filename,
      }));
    }
    if (content.replyTo) {
      out.reply = { messageReference: content.replyTo };
    }
    return out;
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

function mapStyle(style?: OutgoingButton['style']): ButtonStyle {
  switch (style) {
    case 'primary':
      return ButtonStyle.Primary;
    case 'danger':
      return ButtonStyle.Danger;
    default:
      return ButtonStyle.Secondary;
  }
}
