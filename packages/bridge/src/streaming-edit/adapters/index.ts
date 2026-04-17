export {
  TelegramEditStreamingAdapter,
  classifyTelegramError,
  parseCallbackQuery,
  type ParsedCallbackQuery,
  type TelegramAdapterOptions,
} from './telegram.js';
export { escapeMarkdownV2 } from './telegram-markdown.js';
export {
  DiscordEditStreamingAdapter,
  classifyDiscordError,
  isParsedInteraction,
  parseButtonInteraction,
  type ClassifiedError,
  type DiscordAdapterOptions,
  type ParsedInteraction,
} from './discord.js';
