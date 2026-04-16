import { describe, it, expect, vi } from 'vitest';
import { MediaEngine, LocalTtsStub, LocalVisionStub } from '@openhipp0/core';
import type { TranscriptionProvider } from '@openhipp0/core';
import { withMediaEnrichment, addTtsAttachment } from '../src/media.js';
import type { IncomingMessage } from '../src/types.js';

function fakeWhisper(text: string): TranscriptionProvider {
  return { name: 'fake', async transcribe() { return { text }; } };
}

const baseMsg: IncomingMessage = {
  platform: 'telegram',
  id: 'm1',
  channel: { id: 'c1' },
  user: { id: 'u1', name: 'U' },
  text: 'typed',
  timestamp: 0,
};

describe('withMediaEnrichment', () => {
  it('passes unchanged messages through when there are no attachments', async () => {
    const inner = vi.fn();
    const engine = new MediaEngine();
    const wrapped = withMediaEnrichment(inner, { engine });
    await wrapped(baseMsg);
    expect(inner).toHaveBeenCalledWith(baseMsg);
  });

  it('transcribes an audio attachment and replaces text', async () => {
    const inner = vi.fn();
    const engine = new MediaEngine({ transcription: [fakeWhisper('spoken hello')] });
    const fetcher = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
    const wrapped = withMediaEnrichment(inner, { engine, fetchAttachment: fetcher });
    await wrapped({
      ...baseMsg,
      text: '',
      attachments: [{ filename: 'v.ogg', contentType: 'audio/ogg', url: 'x' }],
    });
    expect(fetcher).toHaveBeenCalledOnce();
    const call = inner.mock.calls[0]![0];
    expect(call.text).toBe('spoken hello');
    expect(call.attachments).toBeTruthy();
  });

  it('describes an image attachment and appends to text', async () => {
    const inner = vi.fn();
    const engine = new MediaEngine({ vision: [new LocalVisionStub()] });
    const fetcher = vi.fn().mockResolvedValue(new Uint8Array(8));
    const wrapped = withMediaEnrichment(inner, { engine, fetchAttachment: fetcher });
    await wrapped({
      ...baseMsg,
      text: 'look',
      attachments: [{ filename: 'a.png', contentType: 'image/png', url: 'x' }],
    });
    const call = inner.mock.calls[0]![0];
    expect(call.text.startsWith('look')).toBe(true);
    expect(call.text).toContain('[image:');
  });

  it('handles both voice and image on one message', async () => {
    const inner = vi.fn();
    const engine = new MediaEngine({
      transcription: [fakeWhisper('said hi')],
      vision: [new LocalVisionStub()],
    });
    const fetcher = vi.fn().mockResolvedValue(new Uint8Array(4));
    const wrapped = withMediaEnrichment(inner, { engine, fetchAttachment: fetcher });
    await wrapped({
      ...baseMsg,
      text: '',
      attachments: [
        { filename: 'v.ogg', contentType: 'audio/ogg', url: 'v' },
        { filename: 'i.jpg', contentType: 'image/jpeg', url: 'i' },
      ],
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const call = inner.mock.calls[0]![0];
    expect(call.text).toContain('said hi');
    expect(call.text).toContain('[image:');
  });
});

describe('addTtsAttachment', () => {
  it('attaches synthesized audio to an outgoing message', async () => {
    const tts = new LocalTtsStub();
    const out = await addTtsAttachment({ text: 'ok friend' }, tts, { format: 'wav' });
    expect(out.attachments?.length).toBe(1);
    const att = out.attachments![0]!;
    expect(att.filename).toBe('reply.wav');
    expect(att.contentType).toBe('audio/wav');
    expect(Buffer.isBuffer(att.content)).toBe(true);
  });
});
