// packages/mobile/src/voice/useVoiceInput.ts
// Convenience hook: tap mic → record → release → transcribe → insert text.
// Tolerant to permission denial, transcription failure, and super-short
// clips (<400ms) which Whisper rejects. Callers render their own feedback.

import { useCallback, useRef, useState } from "react";
import { createVoiceRecorder, type VoiceRecorder } from "./recorder.js";
import { transcribeClip } from "./transcribe.js";
import type { ApiClient } from "../api/client.js";

export interface UseVoiceInputResult {
  isRecording: boolean;
  isTranscribing: boolean;
  lastError: string | undefined;
  start: () => Promise<void>;
  stop: () => Promise<string | undefined>;
  cancel: () => Promise<void>;
}

export function useVoiceInput(api: ApiClient, opts?: { language?: string }): UseVoiceInputResult {
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const [isRecording, setRecording] = useState(false);
  const [isTranscribing, setTranscribing] = useState(false);
  const [lastError, setLastError] = useState<string | undefined>(undefined);

  const start = useCallback(async () => {
    setLastError(undefined);
    try {
      if (!recorderRef.current) recorderRef.current = createVoiceRecorder();
      await recorderRef.current.start();
      setRecording(true);
    } catch (err) {
      setLastError(err instanceof Error ? err.message : String(err));
      setRecording(false);
    }
  }, []);

  const stop = useCallback(async (): Promise<string | undefined> => {
    const rec = recorderRef.current;
    if (!rec) return undefined;
    setRecording(false);
    let clip;
    try {
      clip = await rec.stop();
    } catch (err) {
      setLastError(err instanceof Error ? err.message : String(err));
      return undefined;
    }
    if (!clip) return undefined;
    if (clip.durationMs < 400) {
      setLastError("Recording too short");
      return undefined;
    }
    setTranscribing(true);
    try {
      const result = await transcribeClip(api, clip, opts);
      return result.text.trim() || undefined;
    } catch (err) {
      setLastError(err instanceof Error ? err.message : String(err));
      return undefined;
    } finally {
      setTranscribing(false);
    }
  }, [api, opts]);

  const cancel = useCallback(async () => {
    const rec = recorderRef.current;
    setRecording(false);
    if (rec) await rec.cancel();
  }, []);

  return { isRecording, isTranscribing, lastError, start, stop, cancel };
}
