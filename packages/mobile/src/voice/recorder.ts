// packages/mobile/src/voice/recorder.ts
// Thin wrapper over expo-av's Audio.Recording so the Composer + Chat screen
// can start / stop / discard without touching the SDK directly. Resolves to
// a base64-encoded audio blob ready for POST /api/voice/transcribe.

import { Audio } from "expo-av";

export interface VoiceClip {
  base64: string;
  mimeType: string;
  durationMs: number;
  filename: string;
}

export interface VoiceRecorder {
  start(): Promise<void>;
  stop(): Promise<VoiceClip | null>;
  cancel(): Promise<void>;
  readonly isRecording: boolean;
}

const IOS_EXT = "m4a";
const ANDROID_EXT = "m4a";

/**
 * iOS + Android both accept `HIGH_QUALITY` here — that maps to AAC 44.1 kHz
 * on iOS and AAC 44.1 kHz on Android, which Whisper handles natively.
 */
export function createVoiceRecorder(): VoiceRecorder {
  let recording: Audio.Recording | null = null;

  return {
    get isRecording() {
      return recording !== null;
    },

    async start() {
      if (recording) return;
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) throw new Error("Microphone permission denied");
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      const { recording: rec } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      recording = rec;
    },

    async stop(): Promise<VoiceClip | null> {
      const rec = recording;
      recording = null;
      if (!rec) return null;
      const status = await rec.stopAndUnloadAsync().catch(() => null);
      const uri = rec.getURI();
      if (!uri) return null;
      const durationMs = status?.durationMillis ?? 0;
      // Read as base64 without pulling in expo-file-system: fetch(uri) works
      // for file:// on both platforms (Expo Router ships WHATWG fetch).
      const blob = await fetch(uri).then((r) => r.blob());
      const base64 = await blobToBase64(blob);
      return {
        base64,
        mimeType: "audio/m4a",
        durationMs,
        filename: `voice-${Date.now()}.${IOS_EXT}`,
      };
    },

    async cancel() {
      const rec = recording;
      recording = null;
      if (rec) await rec.stopAndUnloadAsync().catch(() => undefined);
    },
  };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("FileReader returned non-string"));
        return;
      }
      // result = `data:audio/m4a;base64,XXXX`
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("blob read failed"));
    reader.readAsDataURL(blob);
  });
}

// Kept so platform-specific code can branch later without editing callers.
export const VOICE_FILE_EXT = { ios: IOS_EXT, android: ANDROID_EXT };
