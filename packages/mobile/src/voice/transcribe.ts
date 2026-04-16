// packages/mobile/src/voice/transcribe.ts
// Round-trip a VoiceClip through the paired server's /api/voice/transcribe
// endpoint. The server routes to MediaEngine (Whisper / local stub).

import type { ApiClient } from "../api/client.js";
import type { VoiceClip } from "./recorder.js";

export interface TranscriptionResult {
  text: string;
  language?: string;
  durationSec?: number;
}

export async function transcribeClip(
  api: ApiClient,
  clip: VoiceClip,
  opts?: { language?: string },
): Promise<TranscriptionResult> {
  const res = await api.transcribeVoice({
    audioBase64: clip.base64,
    mimeType: clip.mimeType,
    filename: clip.filename,
    ...(opts?.language && { language: opts.language }),
  });
  return { text: res.text, language: res.language, durationSec: res.duration };
}

export async function synthesizeSpeech(
  api: ApiClient,
  text: string,
  opts?: { voice?: string; format?: "mp3" | "opus" | "aac" | "flac" | "wav" },
): Promise<{ dataUri: string; mimeType: string }> {
  const res = await api.synthesizeSpeech({
    text,
    ...(opts?.voice && { voice: opts.voice }),
    ...(opts?.format && { format: opts.format }),
  });
  return {
    dataUri: `data:${res.mimeType};base64,${res.audioBase64}`,
    mimeType: res.mimeType,
  };
}
