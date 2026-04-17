import { describe, expect, it } from 'vitest';

import { NetworkInspector } from '../../src/devtools/network-inspector.js';

describe('NetworkInspector', () => {
  it('pairs request/response and records duration', () => {
    const ins = new NetworkInspector();
    ins.onRequest({
      id: 'r1',
      method: 'GET',
      url: 'https://api.example.com/users?id=1',
      startedAt: '2026-04-17T00:00:00.000Z',
    });
    ins.onResponse({
      id: 'r1',
      status: 200,
      endedAt: '2026-04-17T00:00:00.250Z',
      responseHeaders: { 'content-type': 'application/json' },
      responseBodyText: '[{"id":1}]',
    });
    const done = ins.completed();
    expect(done).toHaveLength(1);
    expect(done[0]!.durationMs).toBe(250);
    expect(done[0]!.status).toBe(200);
  });

  it('builds an API catalog keyed by method + host + path', () => {
    const ins = new NetworkInspector();
    for (let i = 0; i < 3; i++) {
      ins.onRequest({
        id: `r${i}`,
        method: 'GET',
        url: `https://api/x?q=${i}`,
        startedAt: new Date().toISOString(),
      });
      ins.onResponse({
        id: `r${i}`,
        status: 200,
        endedAt: new Date().toISOString(),
        responseHeaders: { 'content-type': 'application/json' },
      });
    }
    const endpoints = ins.endpoints();
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0]!.occurrences).toBe(3);
    expect(endpoints[0]!.path).toBe('/x');
  });

  it('apiCandidates filters JSON-producing non-asset endpoints', () => {
    const ins = new NetworkInspector();
    ins.onRequest({ id: '1', method: 'GET', url: 'https://x/users', startedAt: new Date().toISOString() });
    ins.onResponse({ id: '1', status: 200, endedAt: new Date().toISOString(), responseHeaders: { 'content-type': 'application/json' } });
    ins.onRequest({ id: '2', method: 'GET', url: 'https://x/app.js', startedAt: new Date().toISOString() });
    ins.onResponse({ id: '2', status: 200, endedAt: new Date().toISOString(), responseHeaders: { 'content-type': 'application/javascript' } });
    const candidates = ins.apiCandidates();
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.path).toBe('/users');
  });

  it('exportHar produces a 1.2 log envelope', () => {
    const ins = new NetworkInspector();
    ins.onRequest({ id: '1', method: 'GET', url: 'https://x/y', startedAt: new Date().toISOString() });
    ins.onResponse({ id: '1', status: 204, endedAt: new Date().toISOString() });
    const har = ins.exportHar('https://x/');
    const log = (har.log as { version: string; entries: unknown[] });
    expect(log.version).toBe('1.2');
    expect(log.entries).toHaveLength(1);
  });
});
