import { describe, expect, it } from 'vitest';

import { proposeShortcut } from '../../../src/orchestrator/api-shortcut/planner.js';
import type { ObservedApiCall, UiActionIntent } from '../../../src/orchestrator/api-shortcut/types.js';

const intent = (d: string, host = 'app.example.com', target?: string): UiActionIntent => ({
  description: d,
  host,
  ...(target ? { target } : {}),
});

const call = (method: string, url: string, extras: Partial<ObservedApiCall> = {}): ObservedApiCall => ({
  method,
  urlPattern: url,
  occurrences: extras.occurrences ?? 2,
  contentType: extras.contentType ?? 'application/json',
  ...(extras.requestBodySample ? { requestBodySample: extras.requestBodySample } : {}),
  ...(extras.responseSample ? { responseSample: extras.responseSample } : {}),
});

describe('proposeShortcut', () => {
  it('matches a POST create-user action to a POST /api/users endpoint', () => {
    const res = proposeShortcut({
      intent: intent('submit the signup form to create a new user'),
      observed: [
        call('GET', 'https://app.example.com/api/static.js', { contentType: 'application/javascript' }),
        call('POST', 'https://app.example.com/api/users'),
        call('GET', 'https://app.example.com/api/users'),
      ],
    });
    expect(res.shortcut).toBeTruthy();
    expect(res.shortcut!.method).toBe('POST');
    expect(res.shortcut!.urlPattern).toContain('/api/users');
    expect(res.shortcut!.confidence).toBeGreaterThan(0.6);
  });

  it('rejects static-asset endpoints even at high occurrence', () => {
    const res = proposeShortcut({
      intent: intent('click to download bundle'),
      observed: [call('GET', 'https://cdn.example.com/app.js', { occurrences: 20, contentType: 'application/javascript' })],
    });
    expect(res.shortcut).toBeNull();
  });

  it('returns null when no candidate meets minConfidence', () => {
    const res = proposeShortcut({
      intent: intent('do something obscure'),
      observed: [call('GET', 'https://app.example.com/api/unrelated')],
      minConfidence: 0.95,
    });
    expect(res.shortcut).toBeNull();
  });

  it('prefers higher-frequency endpoints when path overlap ties', () => {
    const res = proposeShortcut({
      intent: intent('list products'),
      observed: [
        call('GET', 'https://app.example.com/api/products', { occurrences: 1 }),
        call('GET', 'https://app.example.com/api/products', { occurrences: 10 }),
      ],
    });
    expect(res.shortcut).toBeTruthy();
    expect(res.evaluated[0]!.candidate.occurrences).toBe(10);
  });

  it('verb mismatch zeros the score', () => {
    const res = proposeShortcut({
      intent: intent('delete user 123', 'app.example.com'),
      observed: [call('GET', 'https://app.example.com/api/users/123')],
    });
    expect(res.shortcut).toBeNull();
  });
});
