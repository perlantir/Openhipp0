import { describe, expect, it, vi } from 'vitest';

import { VideoReasoner } from '../../../src/media/multimodal/video-reasoner.js';
import type {
  MediaDecoder,
  MultimodalClient,
} from '../../../src/media/multimodal/types.js';

describe('VideoReasoner', () => {
  it('combines frame descriptions + transcripts into a summary', async () => {
    const decoder: MediaDecoder = {
      async extractFrames({ count }) {
        return Array.from({ length: count }, (_, i) => ({
          atMs: i * 1000,
          pngBytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        }));
      },
      async extractAudio() {
        return [
          { startMs: 0, endMs: 1500, pcmBytes: new Uint8Array(), sampleRate: 16000, channels: 1 },
          { startMs: 1500, endMs: 3000, pcmBytes: new Uint8Array(), sampleRate: 16000, channels: 1 },
        ];
      },
    };
    const client: MultimodalClient = {
      describeFrame: vi.fn().mockResolvedValue('a button'),
      transcribe: vi.fn().mockResolvedValue('hello world'),
      summarize: vi.fn().mockResolvedValue('summary: ui tutorial'),
    };
    const reasoner = new VideoReasoner(decoder, client);
    const result = await reasoner.reason({
      videoBytes: new Uint8Array([1, 2, 3]),
      prompt: 'what happens',
      frameCount: 3,
      includeAudio: true,
    });
    expect(client.describeFrame).toHaveBeenCalledTimes(3);
    expect(client.transcribe).toHaveBeenCalledTimes(2);
    expect(result.summary).toBe('summary: ui tutorial');
    expect(result.evidence.length).toBe(5); // 3 frames + 2 audio
    expect(result.evidence.every((e, i, a) => i === 0 || e.atMs >= a[i - 1]!.atMs)).toBe(true);
  });

  it('omits audio when includeAudio is false', async () => {
    const decoder: MediaDecoder = {
      async extractFrames({ count }) {
        return Array.from({ length: count }, (_, i) => ({
          atMs: i * 500,
          pngBytes: new Uint8Array(),
        }));
      },
      async extractAudio() {
        throw new Error('should not be called');
      },
    };
    const client: MultimodalClient = {
      async describeFrame() {
        return 'x';
      },
      async transcribe() {
        return '';
      },
      async summarize() {
        return 'ok';
      },
    };
    const reasoner = new VideoReasoner(decoder, client);
    const result = await reasoner.reason({ videoBytes: new Uint8Array(), prompt: '', frameCount: 2 });
    expect(result.evidence).toHaveLength(2);
  });
});
