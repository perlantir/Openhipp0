// @openhipp0/bridge — Messaging platform connectors (Discord, Telegram, Slack, Web, CLI)
//
// Phase 3a: interface + reliability primitives (types, reconnect, queue).
// Phase 3b: CLI + Web bridges.
// Phase 3c: Discord, Telegram, Slack bridges.
// Phase 3d: Unified Gateway.

export const packageName = '@openhipp0/bridge' as const;
export const version = '0.0.0' as const;

export * from './types.js';
export { ReconnectSupervisor, type ReconnectConfig, type ReconnectState } from './reconnect.js';
export { OutboundQueue, type OutboundQueueConfig, type QueuedOutbound } from './queue.js';
export { CliBridge, type CliBridgeOptions } from './cli.js';
export { WebBridge, type WebBridgeOptions, type WebAuthenticator } from './web.js';
export { DiscordBridge, type DiscordBridgeOptions } from './discord.js';
export { TelegramBridge, type TelegramBridgeOptions } from './telegram.js';
export { SlackBridge, type SlackBridgeOptions } from './slack.js';
export { Gateway, type GatewayAgent, type GatewayConfig, type ExchangeEvent } from './gateway.js';
export { Hipp0HttpServer, type Hipp0HttpServerConfig } from './http-server.js';
export {
  withMediaEnrichment,
  addTtsAttachment,
  type MediaEnrichmentOptions,
  type AttachmentFetcher,
} from './media.js';
