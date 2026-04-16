import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CliBridge } from '../src/cli.js';
import type { IncomingMessage } from '../src/types.js';

let input: PassThrough;
let output: PassThrough;
let captured: string;
let bridge: CliBridge;

beforeEach(() => {
  input = new PassThrough();
  output = new PassThrough();
  captured = '';
  output.on('data', (chunk: Buffer) => {
    captured += chunk.toString('utf8');
  });
  bridge = new CliBridge({ input, output, prompt: 'you> ', userId: 'u1', userName: 'me' });
});

afterEach(async () => {
  await bridge.disconnect();
});

describe('CliBridge', () => {
  it('connect / disconnect toggle isConnected', async () => {
    expect(bridge.isConnected()).toBe(false);
    await bridge.connect();
    expect(bridge.isConnected()).toBe(true);
    await bridge.disconnect();
    expect(bridge.isConnected()).toBe(false);
  });

  it('connect prints a banner and prompt', async () => {
    await bridge.connect();
    expect(captured).toContain('connected');
    expect(captured).toContain('you> ');
  });

  it('lines on stdin fire onMessage with the typed text', async () => {
    await bridge.connect();
    const handler = vi.fn<(msg: IncomingMessage) => void>();
    bridge.onMessage(handler);
    input.write('hello\n');
    // Let readline flush.
    await new Promise((r) => setImmediate(r));
    expect(handler).toHaveBeenCalledOnce();
    const msg = handler.mock.calls[0]![0];
    expect(msg.text).toBe('hello');
    expect(msg.user).toMatchObject({ id: 'u1', name: 'me', isAdmin: true });
    expect(msg.platform).toBe('cli');
  });

  it('empty lines do not emit messages', async () => {
    await bridge.connect();
    const handler = vi.fn();
    bridge.onMessage(handler);
    input.write('\n');
    await new Promise((r) => setImmediate(r));
    expect(handler).not.toHaveBeenCalled();
  });

  it('send writes to stdout with the agent prefix + re-prompts', async () => {
    await bridge.connect();
    captured = '';
    await bridge.send('stdio', { text: 'how can I help?' });
    expect(captured).toContain('agent> how can I help?');
    expect(captured).toContain('you> ');
  });

  it('send renders buttons as numbered list', async () => {
    await bridge.connect();
    captured = '';
    await bridge.send('stdio', {
      text: 'pick one',
      buttons: [
        { label: 'Yes', value: 'y' },
        { label: 'No', value: 'n' },
      ],
    });
    expect(captured).toMatch(/\[1\] Yes\s+\[2\] No/);
  });

  it('send renders attachments as filename lines', async () => {
    await bridge.connect();
    captured = '';
    await bridge.send('stdio', {
      text: 'here',
      attachments: [{ filename: 'report.pdf', url: 'https://x/r.pdf' }],
    });
    expect(captured).toContain('📎 report.pdf');
  });

  it('send before connect throws Hipp0BridgeNotConnectedError', async () => {
    await expect(bridge.send('stdio', { text: 'x' })).rejects.toThrow(/Bridge not connected/);
  });

  it('async handler errors route through onError', async () => {
    await bridge.connect();
    const errs: unknown[] = [];
    bridge.onError((e) => errs.push(e));
    bridge.onMessage(async () => {
      throw new Error('boom');
    });
    input.write('trigger\n');
    // Wait for microtask drain
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(errs).toHaveLength(1);
    expect((errs[0] as Error).message).toBe('boom');
  });

  it('getCapabilities advertises text-only buttons', () => {
    const c = bridge.getCapabilities();
    expect(c.files).toBe(false);
    expect(c.buttons).toBe(true);
    expect(c.maxMessageBytes).toBeGreaterThan(0);
  });
});
