// Voice round-trip tests: transcribeClip + synthesizeSpeech.
// The recorder itself requires expo-av + a native audio context — covered
// by the full-device suite, not here. These tests verify only the wiring
// from VoiceClip → ApiClient.

import { describe, expect, it, vi } from "vitest";
import { transcribeClip, synthesizeSpeech } from "../src/voice/transcribe.js";
import type { VoiceClip } from "../src/voice/recorder.js";

function fakeApi(overrides: Record<string, unknown> = {}): unknown {
  return {
    transcribeVoice: vi.fn(async () => ({ text: "hello world", language: "en", duration: 1.2 })),
    synthesizeSpeech: vi.fn(async () => ({ audioBase64: "QUFB", mimeType: "audio/mpeg" })),
    ...overrides,
  };
}

function clip(): VoiceClip {
  return { base64: "BASE64DATA", mimeType: "audio/m4a", durationMs: 1200, filename: "v.m4a" };
}

describe("transcribeClip", () => {
  it("POSTs the clip to /api/voice/transcribe and returns text", async () => {
    const api = fakeApi();
    const result = await transcribeClip(
      api as Parameters<typeof transcribeClip>[0],
      clip(),
    );
    expect(result.text).toBe("hello world");
    expect(result.language).toBe("en");
    expect(result.durationSec).toBe(1.2);
    expect((api as { transcribeVoice: ReturnType<typeof vi.fn> }).transcribeVoice).toHaveBeenCalledWith({
      audioBase64: "BASE64DATA",
      mimeType: "audio/m4a",
      filename: "v.m4a",
    });
  });

  it("threads the optional language hint through", async () => {
    const api = fakeApi();
    await transcribeClip(api as Parameters<typeof transcribeClip>[0], clip(), { language: "ja" });
    expect((api as { transcribeVoice: ReturnType<typeof vi.fn> }).transcribeVoice).toHaveBeenCalledWith(
      expect.objectContaining({ language: "ja" }),
    );
  });
});

describe("synthesizeSpeech", () => {
  it("returns a data URI ready for expo-av playback", async () => {
    const api = fakeApi();
    const out = await synthesizeSpeech(api as Parameters<typeof synthesizeSpeech>[0], "hi there");
    expect(out.dataUri).toBe("data:audio/mpeg;base64,QUFB");
    expect(out.mimeType).toBe("audio/mpeg");
  });

  it("threads the voice + format options through", async () => {
    const api = fakeApi();
    await synthesizeSpeech(api as Parameters<typeof synthesizeSpeech>[0], "hi", {
      voice: "nova",
      format: "opus",
    });
    expect((api as { synthesizeSpeech: ReturnType<typeof vi.fn> }).synthesizeSpeech).toHaveBeenCalledWith({
      text: "hi",
      voice: "nova",
      format: "opus",
    });
  });
});
