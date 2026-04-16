import { describe, expect, it } from 'vitest';
import {
  describeError,
  formatErrorLine,
  listErrorCodes,
  redactSecrets,
  redactJson,
  buildDebugBundle,
  formatBundle,
  VerboseEmitter,
  formatVerbose,
} from '../../src/debuggability/index.js';

describe('error-code registry', () => {
  it('listErrorCodes returns the full registry', () => {
    const all = listErrorCodes();
    expect(all.length).toBeGreaterThan(10);
    expect(all.every((c) => c.externalCode.startsWith('HIPP0-'))).toBe(true);
  });

  it('describeError resolves by internal code', () => {
    const meta = describeError('HIPP0_BUDGET_EXCEEDED');
    expect(meta?.externalCode).toBe('HIPP0-0004');
    expect(meta?.category).toBe('llm');
  });

  it('describeError resolves by external code', () => {
    const meta = describeError('HIPP0-0004');
    expect(meta?.code).toBe('HIPP0_BUDGET_EXCEEDED');
  });

  it('formatErrorLine returns a human-readable one-liner', () => {
    const line = formatErrorLine('HIPP0_BUDGET_EXCEEDED');
    expect(line).toContain('HIPP0-0004');
    expect(line).toContain('budget');
    expect(line).toContain('docs.openhipp0.dev');
  });

  it('formatErrorLine handles unknown codes', () => {
    expect(formatErrorLine('HIPP0-9999')).toContain('no registry entry');
  });
});

describe('redactSecrets', () => {
  it('redacts Anthropic API keys', () => {
    const out = redactSecrets('my key is sk-ant-abc123def456 do not share');
    expect(out).not.toContain('sk-ant-abc123def456');
    expect(out).toContain('<REDACTED:anthropic-key>');
  });

  it('redacts bearer tokens while keeping the Bearer prefix', () => {
    const out = redactSecrets('Authorization: Bearer eyJabc.eyJ123.sig');
    expect(out).toMatch(/Bearer\s+<REDACTED:/);
  });

  it('redacts env-style secrets', () => {
    const out = redactSecrets('OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz');
    expect(out).toContain('OPENAI_API_KEY=<REDACTED:');
  });

  it('leaves benign text alone', () => {
    const out = redactSecrets('hello world 123');
    expect(out).toBe('hello world 123');
  });

  it('supports extraLiterals', () => {
    const out = redactSecrets('the secret word is banana', { extraLiterals: ['banana'] });
    expect(out).toContain('<REDACTED:literal>');
  });
});

describe('redactJson', () => {
  it('redacts by key name', () => {
    const out = redactJson({ apiKey: 'supersecret', name: 'ok' }) as Record<string, unknown>;
    expect(out.apiKey).toBe('<REDACTED:field>');
    expect(out.name).toBe('ok');
  });

  it('redacts string values inside arrays', () => {
    const out = redactJson(['sk-ant-abc123def456']) as string[];
    expect(out[0]).toContain('<REDACTED:');
  });

  it('recurses into nested objects', () => {
    const out = redactJson({ nested: { password: 'x', count: 1 } }) as Record<string, unknown>;
    expect((out.nested as Record<string, unknown>).password).toBe('<REDACTED:field>');
    expect((out.nested as Record<string, unknown>).count).toBe(1);
  });
});

describe('buildDebugBundle + formatBundle', () => {
  it('composes sections, redacts, emits processInfo by default', async () => {
    const bundle = await buildDebugBundle({
      source: {
        async sections() {
          return [
            { name: 'recent-logs', text: 'api call sk-ant-abc123def456 failed' },
            { name: 'config', json: { token: 'secret', port: 3100 } },
          ];
        },
      },
      now: () => '2026-04-16T10:00:00Z',
    });
    expect(bundle.createdAt).toBe('2026-04-16T10:00:00Z');
    expect(bundle.processInfo?.nodeVersion).toBeDefined();
    expect(bundle.sections[0]?.text).toContain('<REDACTED:anthropic-key>');
    expect((bundle.sections[1]?.json as { token: string }).token).toBe('<REDACTED:field>');
  });

  it('skips processInfo when includeProcessInfo=false', async () => {
    const bundle = await buildDebugBundle({
      source: { async sections() { return []; } },
      includeProcessInfo: false,
    });
    expect(bundle.processInfo).toBeUndefined();
  });

  it('formatBundle wraps in a code fence', () => {
    const out = formatBundle({ createdAt: 't', sections: [] });
    expect(out).toMatch(/^<!-- hipp0 debug bundle/);
    expect(out).toContain('```json');
  });
});

describe('VerboseEmitter', () => {
  it('emits events to listeners + buffers history', () => {
    const em = new VerboseEmitter();
    const seen: string[] = [];
    em.on((e) => seen.push(e.kind));
    em.emit({ kind: 'agent.turn.begin', iteration: 1 });
    em.emit({ kind: 'agent.stop', reason: 'end_turn' });
    expect(seen).toEqual(['agent.turn.begin', 'agent.stop']);
    expect(em.history()).toHaveLength(2);
  });

  it('trims history to maxBuffer', () => {
    const em = new VerboseEmitter({ maxBuffer: 2 });
    em.emit({ kind: 'agent.turn.begin', iteration: 1 });
    em.emit({ kind: 'agent.turn.begin', iteration: 2 });
    em.emit({ kind: 'agent.turn.begin', iteration: 3 });
    expect(em.history()).toHaveLength(2);
    expect((em.history()[0] as { iteration: number }).iteration).toBe(2);
  });

  it('off() removes listeners', () => {
    const em = new VerboseEmitter();
    const seen: string[] = [];
    const off = em.on((e) => seen.push(e.kind));
    em.emit({ kind: 'agent.stop', reason: 'x' });
    off();
    em.emit({ kind: 'agent.stop', reason: 'y' });
    expect(seen).toHaveLength(1);
  });

  it('formatVerbose returns a one-line string per event kind', () => {
    expect(formatVerbose({ kind: 'agent.turn.begin', iteration: 1 })).toBe('→ turn 1');
    expect(formatVerbose({ kind: 'agent.tool.call', iteration: 1, toolName: 'f', argsPreview: '{}' })).toContain('tool f');
    expect(formatVerbose({ kind: 'agent.llm.response', iteration: 1, outputTokens: 10, costUsd: 0.01, cacheHit: false })).toContain('$0.0100');
    expect(formatVerbose({ kind: 'agent.stop', reason: 'end_turn' })).toContain('stop');
  });
});
