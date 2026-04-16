/**
 * Bridge hooks — helpers for messaging bridges to route voice / image
 * attachments through the MediaEngine.
 *
 * The bridge receives a platform-native voice message, fetches the audio
 * bytes, and calls `transcribeVoiceAttachment` which returns a transcript
 * the bridge can inject as `IncomingMessage.text`. Image attachments go
 * through `describeImageAttachment` — the description becomes a prefix
 * like "[image: a sunset over mountains]" on the text.
 */

import type { MediaEngine } from './engine.js';
import type {
  TranscriptionResult,
  VisionDescribeResult,
  VisionImage,
} from './types.js';

export interface VoiceAttachment {
  /** Raw audio bytes from the platform. */
  data: Uint8Array;
  /** Suggested filename (for providers that care about extensions). */
  filename: string;
  mimeType?: string;
  /** Optional language hint (ISO 639-1) picked up from platform metadata. */
  language?: string;
}

export async function transcribeVoiceAttachment(
  engine: MediaEngine,
  att: VoiceAttachment,
): Promise<TranscriptionResult> {
  const opts = att.language ? { language: att.language } : undefined;
  return engine.transcribe(
    {
      kind: 'buffer',
      data: att.data,
      filename: att.filename,
      ...(att.mimeType !== undefined && { mimeType: att.mimeType }),
    },
    opts,
  );
}

export interface ImageAttachment {
  data: Uint8Array;
  mimeType: string;
  /** Optional follow-up question from the sender. */
  question?: string;
}

export async function describeImageAttachment(
  engine: MediaEngine,
  att: ImageAttachment,
): Promise<VisionDescribeResult> {
  const image: VisionImage = { kind: 'buffer', data: att.data, mimeType: att.mimeType };
  return engine.describeImage({
    images: [image],
    ...(att.question !== undefined && { question: att.question }),
  });
}

/**
 * Convenience: take a message with optional voice + image attachments, return
 * the enriched text that should replace IncomingMessage.text. If both are
 * present, the voice transcript takes precedence and the image description is
 * appended in brackets.
 */
export async function enrichMessage(
  engine: MediaEngine,
  opts: {
    text?: string;
    voice?: VoiceAttachment;
    image?: ImageAttachment;
  },
): Promise<string> {
  const parts: string[] = [];
  if (opts.voice) {
    const t = await transcribeVoiceAttachment(engine, opts.voice);
    if (t.text) parts.push(t.text);
  }
  if (opts.text) parts.push(opts.text);
  if (opts.image) {
    const d = await describeImageAttachment(engine, opts.image);
    if (d.description) parts.push(`[image: ${d.description}]`);
  }
  return parts.join('\n\n').trim();
}
