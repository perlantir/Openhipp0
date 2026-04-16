/**
 * Media enrichment — middleware that wraps a MessageHandler so that voice
 * attachments get transcribed and image attachments get described BEFORE
 * the handler sees the message.
 *
 * Keeps the bridges media-agnostic: they produce an IncomingMessage with
 * attachments referencing URLs; the middleware decides (based on MIME)
 * whether to transcribe/describe and injects the result into `text`.
 */

import type { MediaEngine, TtsProvider } from '@openhipp0/core';
import { enrichMessage } from '@openhipp0/core';
import type {
  Attachment,
  IncomingMessage,
  MessageHandler,
  OutgoingAttachment,
  OutgoingMessage,
} from './types.js';

/**
 * Called by the middleware to fetch attachment bytes. Bridges with
 * authenticated file URLs (Telegram's file API) pass their own fetcher;
 * default uses `globalThis.fetch`.
 */
export type AttachmentFetcher = (attachment: Attachment) => Promise<Uint8Array>;

export interface MediaEnrichmentOptions {
  /** Required — engine holding Whisper + vision providers. */
  engine: MediaEngine;
  /** Override for non-public URLs. Default: `fetch()` then arrayBuffer. */
  fetchAttachment?: AttachmentFetcher;
  /** MIME prefixes we treat as voice. Default: audio/*. */
  voiceMimes?: readonly string[];
  /** MIME prefixes we treat as images. Default: image/*. */
  imageMimes?: readonly string[];
  /** Optional language hint taken from platformData for voice messages. */
  pickLanguage?: (msg: IncomingMessage) => string | undefined;
}

const DEFAULT_VOICE_MIMES = ['audio/'];
const DEFAULT_IMAGE_MIMES = ['image/'];

export function withMediaEnrichment(
  handler: MessageHandler,
  opts: MediaEnrichmentOptions,
): MessageHandler {
  const fetcher = opts.fetchAttachment ?? defaultFetchAttachment;
  const voiceMimes = opts.voiceMimes ?? DEFAULT_VOICE_MIMES;
  const imageMimes = opts.imageMimes ?? DEFAULT_IMAGE_MIMES;

  return async (msg: IncomingMessage) => {
    if (!msg.attachments || msg.attachments.length === 0) {
      return handler(msg);
    }
    const voice = msg.attachments.find((a) => matches(a, voiceMimes));
    const image = msg.attachments.find((a) => matches(a, imageMimes));
    if (!voice && !image) return handler(msg);

    const enriched: Parameters<typeof enrichMessage>[1] = { text: msg.text };
    if (voice) {
      const data = await fetcher(voice);
      const lang = opts.pickLanguage?.(msg);
      enriched.voice = {
        data,
        filename: voice.filename,
        ...(voice.contentType !== undefined && { mimeType: voice.contentType }),
        ...(lang !== undefined && { language: lang }),
      };
    }
    if (image) {
      const data = await fetcher(image);
      enriched.image = {
        data,
        mimeType: image.contentType ?? 'image/png',
      };
    }
    const text = await enrichMessage(opts.engine, enriched);
    return handler({ ...msg, text });
  };
}

function matches(att: Attachment, prefixes: readonly string[]): boolean {
  const ct = att.contentType ?? '';
  return prefixes.some((p) => ct.startsWith(p));
}

async function defaultFetchAttachment(att: Attachment): Promise<Uint8Array> {
  const resp = await fetch(att.url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch attachment ${att.url}: ${resp.status}`);
  }
  return new Uint8Array(await resp.arrayBuffer());
}

// ─────────────────────────────────────────────────────────────────────────────
// Outbound TTS convenience
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert a text reply into an outgoing message with an attached TTS audio
 * file. Useful for voice-first channels (Telegram voice-reply, Discord voice
 * channels). Bridges that don't support audio attachments can ignore this.
 */
export async function addTtsAttachment(
  message: OutgoingMessage,
  tts: TtsProvider,
  opts: { voice?: string; format?: 'mp3' | 'opus' | 'wav' } = {},
): Promise<OutgoingMessage> {
  const input: Parameters<TtsProvider['synthesize']>[0] = { text: message.text };
  if (opts.voice !== undefined) input.voice = opts.voice;
  if (opts.format !== undefined) input.format = opts.format;
  const synth = await tts.synthesize(input);
  const ext = opts.format ?? 'mp3';
  const attachment: OutgoingAttachment = {
    filename: `reply.${ext}`,
    contentType: synth.mimeType,
    content: Buffer.from(synth.audio),
  };
  return {
    ...message,
    attachments: [...(message.attachments ?? []), attachment],
  };
}
