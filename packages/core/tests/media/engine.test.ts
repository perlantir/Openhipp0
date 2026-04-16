import { describe, it, expect, vi } from 'vitest';
import { MediaEngine } from '../../src/media/engine.js';
import { Hipp0MediaError, LocalTtsStub, LocalVisionStub } from '../../src/media/index.js';
import type { TranscriptionProvider } from '../../src/media/types.js';
import { enrichMessage } from '../../src/media/bridge-hooks.js';

function fakeWhisper(text: string, name = 'fake'): TranscriptionProvider {
  return {
    name,
    async transcribe() {
      return { text };
    },
  };
}

describe('MediaEngine', () => {
  it('throws when a capability has no providers', async () => {
    const engine = new MediaEngine();
    await expect(
      engine.transcribe({ kind: 'buffer', data: new Uint8Array(), filename: 'a.wav' }),
    ).rejects.toBeInstanceOf(Hipp0MediaError);
    expect(engine.hasTranscription()).toBe(false);
  });

  it('falls back to the next provider when the first fails', async () => {
    const bad: TranscriptionProvider = {
      name: 'bad',
      transcribe: vi.fn().mockRejectedValue(new Error('boom')),
    };
    const good = fakeWhisper('rescued');
    const engine = new MediaEngine({ transcription: [bad, good] });
    const r = await engine.transcribe({
      kind: 'buffer',
      data: new Uint8Array(),
      filename: 'a.wav',
    });
    expect(r.text).toBe('rescued');
    expect(bad.transcribe).toHaveBeenCalledOnce();
  });

  it('aggregates failure info when every provider throws', async () => {
    const p1: TranscriptionProvider = {
      name: 'p1',
      transcribe: vi.fn().mockRejectedValue(new Error('x')),
    };
    const engine = new MediaEngine({ transcription: [p1] });
    await expect(
      engine.transcribe({ kind: 'buffer', data: new Uint8Array(), filename: 'a.wav' }),
    ).rejects.toBeInstanceOf(Hipp0MediaError);
  });

  it('reports capability flags based on registered providers', () => {
    const engine = new MediaEngine({ tts: [new LocalTtsStub()], vision: [new LocalVisionStub()] });
    expect(engine.hasTts()).toBe(true);
    expect(engine.hasVision()).toBe(true);
    expect(engine.hasImageGeneration()).toBe(false);
  });
});

describe('enrichMessage', () => {
  it('prepends voice transcript and appends image description', async () => {
    const engine = new MediaEngine({
      transcription: [fakeWhisper('spoken text')],
      vision: [new LocalVisionStub()],
    });
    const result = await enrichMessage(engine, {
      text: 'typed text',
      voice: { data: new Uint8Array([1, 2]), filename: 'v.ogg' },
      image: { data: new Uint8Array(16), mimeType: 'image/png' },
    });
    expect(result.startsWith('spoken text')).toBe(true);
    expect(result).toContain('typed text');
    expect(result).toContain('[image:');
  });

  it('returns only the typed text when no attachments are present', async () => {
    const engine = new MediaEngine();
    const result = await enrichMessage(engine, { text: 'hi' });
    expect(result).toBe('hi');
  });
});
