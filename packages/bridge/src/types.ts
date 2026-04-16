/**
 * Platform-agnostic messaging bridge interface.
 *
 * Every bridge (Discord, Telegram, Slack, Web, CLI) implements `MessageBridge`.
 * The gateway composes bridges + routes incoming messages to the agent runtime
 * + sends responses back through the originating bridge.
 *
 * Types are intentionally light: `platformData` carries SDK-specific context
 * opaquely so the gateway doesn't need to know about Discord interactions or
 * Slack view submissions to do its job.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Identity
// ─────────────────────────────────────────────────────────────────────────────

export type Platform =
  | 'discord'
  | 'telegram'
  | 'slack'
  | 'whatsapp'
  | 'whatsapp-business'
  | 'web'
  | 'cli'
  | 'signal'
  | 'matrix'
  | 'mattermost'
  | 'email'
  | 'sms'
  | 'home-assistant';

export interface BridgeUser {
  /** Platform-scoped user id. */
  id: string;
  /** Display name. */
  name: string;
  /** Whether this user has been granted admin privileges for the agent. */
  isAdmin?: boolean;
}

export interface BridgeChannel {
  /** Platform-scoped channel id. CLI uses a fixed 'stdout' / 'stdin'. */
  id: string;
  /** Human-readable channel name. */
  name?: string;
  /** Whether this is a DM / 1:1. */
  isDM?: boolean;
  /** Thread / topic id, if the platform supports threading. */
  threadId?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Incoming
// ─────────────────────────────────────────────────────────────────────────────

export interface IncomingMessage {
  platform: Platform;
  /** Unique per-message id. Used for de-duping and replies. */
  id: string;
  channel: BridgeChannel;
  user: BridgeUser;
  /** Plain-text content the agent should treat as user input. */
  text: string;
  /** File / image attachments. */
  attachments?: readonly Attachment[];
  /** Unix ms. */
  timestamp: number;
  /** If this message is a reply to another, the parent's id. */
  replyTo?: string;
  /** Platform-specific opaque payload. Platform code may reach in here. */
  platformData?: Record<string, unknown>;
}

export interface Attachment {
  filename: string;
  /** MIME or best-effort. */
  contentType?: string;
  /** Bytes. */
  size?: number;
  /** Fetch URL (may be temporary / require auth headers). */
  url: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Outgoing
// ─────────────────────────────────────────────────────────────────────────────

export interface OutgoingMessage {
  text: string;
  /** Attach files on reply. */
  attachments?: readonly OutgoingAttachment[];
  /** Inline buttons. Bridges without button support render as plain text. */
  buttons?: readonly OutgoingButton[];
  /** Reply-in-thread hint (Slack / Discord threads). */
  threadId?: string;
  /** Reply-to hint — in-reply marker on a parent message. */
  replyTo?: string;
  /** Platform-specific opaque payload. */
  platformData?: Record<string, unknown>;
}

export interface OutgoingAttachment {
  filename: string;
  contentType?: string;
  /** Either bytes or a URL the bridge can fetch. */
  content?: Buffer | string;
  url?: string;
}

export interface OutgoingButton {
  label: string;
  /** Bridges encode this into their native button payload. Returned as `value`
   *  on the resulting IncomingMessage's platformData.buttonValue field. */
  value: string;
  style?: 'primary' | 'danger' | 'secondary';
}

// ─────────────────────────────────────────────────────────────────────────────
// Capabilities + state
// ─────────────────────────────────────────────────────────────────────────────

export interface BridgeCapabilities {
  readonly files: boolean;
  readonly buttons: boolean;
  readonly threads: boolean;
  readonly slashCommands: boolean;
  readonly maxMessageBytes: number;
}

export type MessageHandler = (msg: IncomingMessage) => void | Promise<void>;
export type ErrorHandler = (err: unknown) => void;

export interface MessageBridge {
  readonly platform: Platform;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  onMessage(handler: MessageHandler): void;
  onError(handler: ErrorHandler): void;
  send(channelId: string, content: OutgoingMessage): Promise<void>;
  getCapabilities(): BridgeCapabilities;
}

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

export class Hipp0BridgeError extends Error {
  readonly code: string;
  readonly platform: Platform;
  constructor(message: string, platform: Platform, code = 'HIPP0_BRIDGE_ERROR') {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.platform = platform;
  }
}

export class Hipp0BridgeNotConnectedError extends Hipp0BridgeError {
  constructor(platform: Platform) {
    super(`Bridge not connected: ${platform}`, platform, 'HIPP0_BRIDGE_NOT_CONNECTED');
  }
}

export class Hipp0BridgeSendError extends Hipp0BridgeError {
  override readonly cause: unknown;
  constructor(platform: Platform, cause: unknown) {
    super(`Bridge send failed: ${platform}`, platform, 'HIPP0_BRIDGE_SEND');
    this.cause = cause;
  }
}
