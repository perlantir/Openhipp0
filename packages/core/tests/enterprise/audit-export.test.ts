import { describe, it, expect } from 'vitest';
import {
  exportAsCsv,
  exportAsJson,
  exportAsCef,
  streamExport,
  type AuditEvent,
} from '../../src/enterprise/audit-export.js';

const sample: AuditEvent[] = [
  {
    id: 'a1',
    timestamp: '2026-04-16T10:00:00Z',
    actorId: 'u1',
    actorType: 'user',
    action: 'tool.execute',
    resource: 'browser_click',
    result: 'success',
    organizationId: 'org1',
    projectId: 'proj1',
    ip: '10.0.0.5',
    metadata: { duration_ms: 1200 },
  },
  {
    id: 'a2',
    timestamp: '2026-04-16T10:01:00Z',
    actorId: 'agent-writer',
    actorType: 'agent',
    action: 'skill.install',
    resource: 'gmail',
    result: 'denied',
  },
];

describe('audit export', () => {
  it('JSON returns one event per line', () => {
    const s = exportAsJson(sample);
    expect(s.split('\n')).toHaveLength(2);
    expect(JSON.parse(s.split('\n')[0]!).id).toBe('a1');
  });

  it('CSV has a header row + escapes commas', () => {
    const s = exportAsCsv(sample);
    const lines = s.split('\n');
    expect(lines[0]).toContain('id,timestamp');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('a1');
    // Metadata column wraps JSON in quotes and escapes inner quotes.
    expect(lines[1]).toContain('"{""duration_ms"":1200}"');
  });

  it('CEF severity varies by result', () => {
    const s = exportAsCef(sample);
    const lines = s.split('\n');
    expect(lines[0]).toContain('|3|'); // success
    expect(lines[1]).toContain('|7|'); // denied
    expect(lines[0]).toContain('suser=u1');
    expect(lines[0]).toContain('cs1=org1');
  });

  it('streamExport with csv emits header only once', async () => {
    async function* src(): AsyncGenerator<readonly AuditEvent[]> {
      yield sample;
      yield [sample[1]!];
    }
    const out: string[] = [];
    for await (const chunk of streamExport(src(), 'csv')) out.push(chunk);
    expect(out).toHaveLength(2);
    expect(out[0]!.startsWith('id,timestamp')).toBe(true);
    expect(out[1]!.startsWith('id,timestamp')).toBe(false);
  });
});
