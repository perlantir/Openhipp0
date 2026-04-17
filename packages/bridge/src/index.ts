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

// Phase 13 — additional bridges.
export {
  SignalBridge,
  type SignalBridgeOptions,
  type SignalTransport,
  type SignalRawMessage,
} from './signal.js';
export {
  MatrixBridge,
  type MatrixBridgeOptions,
  type MatrixTransport,
  type MatrixRawEvent,
} from './matrix.js';
export {
  MattermostBridge,
  type MattermostBridgeOptions,
  type MattermostTransport,
  type MattermostRawPost,
} from './mattermost.js';
export {
  EmailBridge,
  type EmailBridgeOptions,
  type EmailTransport,
  type EmailRawMessage,
  type EmailOutbound,
} from './email.js';
export {
  SmsBridge,
  type SmsBridgeOptions,
  type SmsTransport,
  type SmsIncomingPayload,
} from './sms.js';
export {
  WhatsAppBusinessBridge,
  type WhatsAppBusinessBridgeOptions,
  type WhatsAppBusinessTransport,
  type WhatsAppBusinessIncoming,
} from './whatsapp-business.js';
export {
  HomeAssistantBridge,
  type HaBridgeOptions,
  type HaTransport,
  type HaConversationEvent,
} from './home-assistant.js';
export {
  Hipp0HttpServer,
  HttpError,
  createRateLimiter,
  type Hipp0HttpServerConfig,
  type Route,
  type RouteHandler,
  type RouteHandlerContext,
  type RouteResponse,
  type PreRouteMiddleware,
  type RateLimitOptions,
} from './http-server.js';
export {
  withMediaEnrichment,
  addTtsAttachment,
  type MediaEnrichmentOptions,
  type AttachmentFetcher,
} from './media.js';

// G2: streaming adapter + sentence chunker for edit-less bridges.
export {
  formatStreamEvent,
  SentenceChunker,
  StreamingAccumulator,
  type ChunkedEmitOpts,
  type StreamingBridgeDeps,
} from './streaming.js';
