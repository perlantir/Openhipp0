/**
 * Voice REST routes for the mobile app (`/api/voice/*`).
 *
 *   POST /api/voice/transcribe  — body: { audioBase64, mimeType?, language? } → { text }
 *   POST /api/voice/synthesize  — body: { text, voice?, format? }             → { audioBase64, mimeType }
 *
 * Both routes lazily instantiate a MediaEngine with the OpenAI providers when
 * `OPENAI_API_KEY` is set, falling back to the local stub for offline dev.
 * Requires Bearer auth when an API token is configured.
 */

import type { Route } from '@openhipp0/bridge';

interface RouteContext {
  req: unknown;
  body?: unknown;
}

function requireBearer(apiToken: string | undefined, handler: Route['handler']): Route['handler'] {
  if (!apiToken) return handler;
  return async (ctx) => {
    const raw = (ctx.req as { headers?: Record<string, string | undefined> }).headers?.['authorization'];
    if (raw !== `Bearer ${apiToken}`) return { status: 401, body: { error: 'unauthorized' } };
    return handler(ctx);
  };
}

async function loadEngine() {
  const mod = (await import('@openhipp0/core')) as unknown as {
    MediaEngine: new (cfg: unknown) => {
      transcribe: (
        input: { kind: 'buffer'; data: Uint8Array; filename: string; mimeType?: string },
        opts?: { language?: string },
      ) => Promise<{ text: string; language?: string; duration?: number }>;
      synthesize: (input: {
        text: string;
        voice?: string;
        format?: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav';
      }) => Promise<{ audio: Uint8Array; mimeType: string }>;
    };
    OpenAIWhisperProvider?: new (opts: { apiKey: string }) => unknown;
    OpenAITtsProvider?: new (opts: { apiKey: string }) => unknown;
    LocalTtsStub?: new () => unknown;
  };
  const apiKey = process.env['OPENAI_API_KEY'];
  const transcription = apiKey && mod.OpenAIWhisperProvider
    ? [new mod.OpenAIWhisperProvider({ apiKey })]
    : [];
  const tts = apiKey && mod.OpenAITtsProvider
    ? [new mod.OpenAITtsProvider({ apiKey })]
    : mod.LocalTtsStub
      ? [new mod.LocalTtsStub()]
      : [];
  return new mod.MediaEngine({ providers: { transcription, tts, image: [], vision: [] } });
}

export function buildVoiceRoutes(apiToken: string | undefined): readonly Route[] {
  let engine: Awaited<ReturnType<typeof loadEngine>> | undefined;
  const getEngine = async () => (engine ??= await loadEngine());

  const transcribe: Route['handler'] = async (ctx: RouteContext) => {
    const body = ctx.body as
      | { audioBase64?: string; mimeType?: string; language?: string; filename?: string }
      | undefined;
    if (!body?.audioBase64 || typeof body.audioBase64 !== 'string') {
      return { status: 400, body: { error: 'audioBase64 required (base64-encoded audio bytes)' } };
    }
    let data: Uint8Array;
    try {
      data = new Uint8Array(Buffer.from(body.audioBase64, 'base64'));
    } catch {
      return { status: 400, body: { error: 'invalid base64' } };
    }
    try {
      const eng = await getEngine();
      const out = await eng.transcribe(
        {
          kind: 'buffer',
          data,
          filename: body.filename ?? 'audio.m4a',
          ...(body.mimeType && { mimeType: body.mimeType }),
        },
        body.language ? { language: body.language } : undefined,
      );
      return { body: { text: out.text, language: out.language, duration: out.duration } };
    } catch (err) {
      return {
        status: 502,
        body: { error: 'transcription_failed', message: err instanceof Error ? err.message : String(err) },
      };
    }
  };

  const synthesize: Route['handler'] = async (ctx: RouteContext) => {
    const body = ctx.body as
      | { text?: string; voice?: string; format?: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' }
      | undefined;
    if (!body?.text || typeof body.text !== 'string') {
      return { status: 400, body: { error: 'text required' } };
    }
    try {
      const eng = await getEngine();
      const out = await eng.synthesize({
        text: body.text,
        ...(body.voice && { voice: body.voice }),
        ...(body.format && { format: body.format }),
      });
      return {
        body: {
          audioBase64: Buffer.from(out.audio).toString('base64'),
          mimeType: out.mimeType,
        },
      };
    } catch (err) {
      return {
        status: 502,
        body: { error: 'synthesis_failed', message: err instanceof Error ? err.message : String(err) },
      };
    }
  };

  return [
    { method: 'POST', path: '/api/voice/transcribe', handler: requireBearer(apiToken, transcribe) },
    { method: 'POST', path: '/api/voice/synthesize', handler: requireBearer(apiToken, synthesize) },
  ];
}
