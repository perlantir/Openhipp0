import { describe, expect, it } from 'vitest';
import { MediaEngine } from '../../src/media/engine.js';
import type { MediaCostEvent } from '../../src/media/types.js';

const whisper = {
  name: 'openai-whisper',
  async transcribe() {
    return { text: 'hello world', duration: 2.5 };
  },
};

const openaiTts = {
  name: 'openai-tts',
  async synthesize() {
    return { audio: new Uint8Array([1, 2, 3]), mimeType: 'audio/mpeg' };
  },
};

const dalle = {
  name: 'dalle-3',
  async generate() {
    return { prompt: 'a whale', url: 'https://cdn.example/img.png' };
  },
};

const localTts = {
  name: 'local-stub',
  async synthesize() {
    return { audio: new Uint8Array([9]), mimeType: 'audio/mpeg' };
  },
};

describe('MediaEngine cost emission', () => {
  it('emits a transcription event with seconds + whisper USD estimate', async () => {
    const events: MediaCostEvent[] = [];
    const engine = new MediaEngine({
      transcription: [whisper],
      costSink: (e) => events.push(e),
    });
    await engine.transcribe({ kind: 'buffer', data: new Uint8Array([0]), filename: 'x.m4a' });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      capability: 'transcription',
      provider: 'openai-whisper',
      units: 2.5,
      unitLabel: 'seconds',
    });
    // $0.006 / min → $0.0001 / sec → 2.5s ≈ $0.00025
    expect(events[0]?.costUsd).toBeCloseTo(0.00025, 6);
  });

  it('emits a TTS event with character count + OpenAI USD estimate', async () => {
    const events: MediaCostEvent[] = [];
    const engine = new MediaEngine({ tts: [openaiTts], costSink: (e) => events.push(e) });
    await engine.synthesize({ text: 'hello world' });
    expect(events[0]).toMatchObject({
      capability: 'tts',
      provider: 'openai-tts',
      units: 11,
      unitLabel: 'characters',
    });
    // $15 / 1M chars → 11 chars ≈ $0.000165
    expect(events[0]?.costUsd).toBeCloseTo(0.000165, 6);
  });

  it('non-OpenAI TTS still emits the event with costUsd=0 (operator can reprice)', async () => {
    const events: MediaCostEvent[] = [];
    const engine = new MediaEngine({ tts: [localTts], costSink: (e) => events.push(e) });
    await engine.synthesize({ text: 'hi' });
    expect(events[0]?.costUsd).toBe(0);
    expect(events[0]?.units).toBe(2);
  });

  it('emits image-generation events with count', async () => {
    const events: MediaCostEvent[] = [];
    const engine = new MediaEngine({
      imageGeneration: [dalle],
      costSink: (e) => events.push(e),
    });
    await engine.generateImage({ prompt: 'a whale' });
    expect(events[0]).toMatchObject({
      capability: 'image-generation',
      units: 1,
      unitLabel: 'images',
    });
    // $0.04 per 1024x1024 standard image
    expect(events[0]?.costUsd).toBeCloseTo(0.04, 6);
  });

  it('does not throw the media call when the sink throws', async () => {
    const engine = new MediaEngine({
      transcription: [whisper],
      costSink: () => {
        throw new Error('sink down');
      },
    });
    const result = await engine.transcribe({
      kind: 'buffer',
      data: new Uint8Array(),
      filename: 'x.m4a',
    });
    expect(result.text).toBe('hello world');
  });

  it('is a no-op when no costSink is configured', async () => {
    const engine = new MediaEngine({ transcription: [whisper] });
    // Should not throw.
    await engine.transcribe({ kind: 'buffer', data: new Uint8Array(), filename: 'x.m4a' });
  });
});
