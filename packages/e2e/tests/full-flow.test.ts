/**
 * End-to-end scenario: a web client sends a message over WebSocket; the
 * agent decides to write a file via the file_write tool; we observe the
 * reply on the WS and confirm:
 *   - the file really landed on disk,
 *   - a session_history row was persisted with the correct tool count,
 *   - the assistant text came back through the Gateway.
 *
 * No mocks between the WebSocket and the DB. Only the LLM is scripted.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { db as memoryDb } from '@openhipp0/memory';
import { createFullStack, type FullStack } from '../src/index.js';

let stack: FullStack | undefined;

afterEach(async () => {
  await stack?.teardown();
  stack = undefined;
});

/**
 * Helper: open a WS, collect the first N 'response' frames, then close.
 * The server also emits a 'status' connected frame; we filter those out.
 */
async function roundTripMessage(
  url: string,
  outboundText: string,
  waitForResponses = 1,
): Promise<{ responses: Record<string, unknown>[]; channelId: string }> {
  const ws = new WebSocket(url);
  const responses: Record<string, unknown>[] = [];
  let channelId = '';

  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });

  const done = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for ${waitForResponses} response(s)`));
    }, 10_000);

    ws.on('message', (data) => {
      const frame = JSON.parse(data.toString()) as Record<string, unknown>;
      if (frame.type === 'status' && frame.status === 'connected') {
        channelId = String(frame.channelId ?? '');
        return;
      }
      if (frame.type === 'response') {
        responses.push(frame);
        if (responses.length >= waitForResponses) {
          clearTimeout(timer);
          resolve();
        }
      }
    });
    ws.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  // Server announces status before we can send — wait a micro-tick for channelId.
  if (!channelId) {
    await new Promise((r) => setTimeout(r, 30));
  }

  ws.send(JSON.stringify({ type: 'message', id: 'm1', text: outboundText }));
  await done;
  ws.close();
  return { responses, channelId };
}

describe('E2E — web bridge → gateway → agent → tool → memory', () => {
  it('routes a message, executes file_write, persists a session row', async () => {
    stack = await createFullStack({
      script: [
        {
          // Step 1: the "LLM" decides to call the file_write tool.
          toolUse: {
            name: 'file_write',
            input: {
              path: '', // filled in below at construction time of the stack
              content: 'hello from e2e',
            },
          },
        },
        {
          // Step 2: after the tool_result comes back, the LLM replies with text.
          text: 'Wrote the file successfully.',
        },
      ],
    });

    // The allowedPaths sandbox requires the target to live under scratchDir.
    const target = join(stack.scratchDir, 'note.txt');
    // Mutate the scripted step's input to point at the real path.
    const step = (stack.llm as unknown as { script: Array<{ toolUse?: { input: { path: string } } }> })
      .script[0];
    if (step?.toolUse) step.toolUse.input.path = target;

    const { responses } = await roundTripMessage(stack.wsUrl, 'please write a note', 1);

    // The response text comes back through the Gateway.
    expect(responses).toHaveLength(1);
    expect(responses[0]?.text).toBe('Wrote the file successfully.');

    // The tool actually ran — the file is on disk.
    const contents = await readFile(target, 'utf8');
    expect(contents).toBe('hello from e2e');

    // The session was persisted with tool_calls_count=1.
    const rows = stack.db.select().from(memoryDb.sessionHistory).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.toolCallsCount).toBe(1);
    expect(rows[0]?.projectId).toBe(stack.projectId);
  });

  it('ends cleanly when the LLM replies with plain text (no tools)', async () => {
    stack = await createFullStack({
      script: [{ text: 'hi there' }],
    });

    const { responses } = await roundTripMessage(stack.wsUrl, 'hello');
    expect(responses[0]?.text).toBe('hi there');
    // Exactly one LLM call: assistant's first turn.
    expect(stack.llm.calls).toHaveLength(1);
  });
});
