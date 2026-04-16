/**
 * Gmail integration — OAuth2 (GOOGLE_GMAIL provider).
 *
 * Minimal surface for Phase 10:
 *   gmail_search  → GET /messages?q=...
 *   gmail_send    → POST /messages/send  (RFC-822 payload, base64url-encoded)
 *
 * Larger operations (attachments, threads, labels management) are scoped
 * for a follow-up — the OAuth2 plumbing is the hard part and that's done.
 */

import { z } from 'zod';
import type { Tool } from '../../tools/types.js';
import type { OAuth2Client } from '../../auth/index.js';
import { fetchWithRetry } from '../http.js';

const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

export interface GmailConfig {
  /** OAuth2 client preconfigured for GOOGLE_GMAIL. */
  oauth: OAuth2Client;
  /** Account name used when reading tokens out of the store. */
  account: string;
}

async function authHeader(cfg: GmailConfig): Promise<string> {
  return `Bearer ${await cfg.oauth.getAccessToken(cfg.account)}`;
}

export function createGmailSearchTool(cfg: GmailConfig): Tool<{ q: string; maxResults?: number }> {
  return {
    name: 'gmail_search',
    description: 'Search the authenticated user\'s Gmail with Gmail query syntax (from:, subject:, etc.).',
    permissions: ['net.fetch'],
    inputSchema: {
      type: 'object',
      required: ['q'],
      properties: {
        q: { type: 'string' },
        maxResults: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
      },
    },
    validator: z.object({ q: z.string().min(1), maxResults: z.number().int().min(1).max(100).optional() }),
    async execute(input) {
      const url = new URL(`${BASE}/messages`);
      url.searchParams.set('q', input.q);
      url.searchParams.set('maxResults', String(input.maxResults ?? 10));
      const auth = await authHeader(cfg);
      const resp = await fetchWithRetry(() =>
        fetch(url.toString(), { headers: { authorization: auth, accept: 'application/json' } }),
      );
      if (!resp.ok) {
        return { ok: false, output: `Gmail ${resp.status}: ${await resp.text()}`, errorCode: 'HIPP0_GMAIL_HTTP' };
      }
      return { ok: true, output: await resp.text() };
    },
  };
}

export function createGmailSendTool(cfg: GmailConfig): Tool<{
  to: string;
  subject: string;
  body: string;
  from?: string;
}> {
  return {
    name: 'gmail_send',
    description: 'Send a plain-text email through the authenticated Gmail account.',
    permissions: ['net.fetch'],
    inputSchema: {
      type: 'object',
      required: ['to', 'subject', 'body'],
      properties: {
        to: { type: 'string' },
        subject: { type: 'string' },
        body: { type: 'string' },
        from: { type: 'string' },
      },
    },
    validator: z.object({
      to: z.string().min(3),
      subject: z.string(),
      body: z.string(),
      from: z.string().optional(),
    }),
    async execute(input) {
      const auth = await authHeader(cfg);
      const rfc822 = [
        `To: ${input.to}`,
        input.from ? `From: ${input.from}` : undefined,
        `Subject: ${input.subject}`,
        'Content-Type: text/plain; charset=UTF-8',
        '',
        input.body,
      ]
        .filter(Boolean)
        .join('\r\n');
      const raw = Buffer.from(rfc822, 'utf8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const resp = await fetchWithRetry(() =>
        fetch(`${BASE}/messages/send`, {
          method: 'POST',
          headers: {
            authorization: auth,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ raw }),
        }),
      );
      if (!resp.ok) {
        return { ok: false, output: `Gmail ${resp.status}: ${await resp.text()}`, errorCode: 'HIPP0_GMAIL_HTTP' };
      }
      return { ok: true, output: await resp.text() };
    },
  };
}
