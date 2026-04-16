/**
 * Phase 17 integrations — 14 skill tool factories (todoist already landed
 * in its own dir). Each block below is self-contained: config interface,
 * tool factory, and any helpers. All follow the same shape as
 * integrations/github/tools.ts: Zod validator, injectable fetch, returns
 * ToolResult (never throws).
 *
 * Coverage:
 *   Outlook (Mail), Apple Calendar (CalDAV), Google Calendar, Notion,
 *   Obsidian (local vault), Trello, Google Drive, Dropbox, Jira,
 *   Home Assistant, Philips Hue, Spotify, SMS (Twilio), Mattermost.
 */

import { z } from 'zod';
import type { Tool } from '../tools/types.js';
import type { OAuth2Client } from '../auth/index.js';
import { fetchWithRetry } from './http.js';
import { httpErr, missingKey } from './_helpers.js';

// ═══════════════════════════════════════════════════════════════════════════
// 1. Outlook (Microsoft Graph /me/messages)
// ═══════════════════════════════════════════════════════════════════════════

export interface OutlookConfig {
  oauth: OAuth2Client;
  account: string;
  fetch?: typeof fetch;
}
const GRAPH = 'https://graph.microsoft.com/v1.0';

export function createOutlookSearchTool(cfg: OutlookConfig): Tool<{ q: string; top?: number }> {
  return {
    name: 'outlook_search',
    description: "Search the authenticated user's Outlook mail.",
    permissions: ['net.fetch'],
    inputSchema: { type: 'object', required: ['q'], properties: { q: { type: 'string' }, top: { type: 'integer' } } },
    validator: z.object({ q: z.string().min(1), top: z.number().int().min(1).max(50).optional() }),
    async execute(input) {
      const f = cfg.fetch ?? fetch;
      const tok = await cfg.oauth.getAccessToken(cfg.account);
      const url = `${GRAPH}/me/messages?$search=${encodeURIComponent(`"${input.q}"`)}&$top=${input.top ?? 20}`;
      const resp = await fetchWithRetry(() => f(url, { headers: { authorization: `Bearer ${tok}` } }));
      if (!resp.ok) return httpErr('outlook', resp);
      return { ok: true, output: await resp.text() };
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Apple Calendar (CalDAV — basic auth)
// ═══════════════════════════════════════════════════════════════════════════

export interface CalDavConfig {
  baseUrl: string;
  username: string;
  password: string;
  fetch?: typeof fetch;
}

export function createAppleCalendarListTool(cfg: CalDavConfig): Tool<{ calendarPath?: string }> {
  const auth = `Basic ${Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64')}`;
  return {
    name: 'apple_calendar_list',
    description: 'List events from an Apple/iCloud CalDAV calendar.',
    permissions: ['net.fetch'],
    inputSchema: { type: 'object', properties: { calendarPath: { type: 'string' } } },
    validator: z.object({ calendarPath: z.string().optional() }),
    async execute(input) {
      const f = cfg.fetch ?? fetch;
      const path = input.calendarPath ?? '';
      const resp = await fetchWithRetry(() =>
        f(`${cfg.baseUrl}/${path}`, {
          method: 'REPORT',
          headers: { authorization: auth, 'content-type': 'application/xml', depth: '1' },
          body: '<?xml version="1.0"?><c:calendar-query xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:d="DAV:"><d:prop><c:calendar-data/></d:prop></c:calendar-query>',
        }),
      );
      if (!resp.ok) return httpErr('apple-calendar', resp);
      return { ok: true, output: await resp.text() };
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. Google Calendar (OAuth2 — Google provider)
// ═══════════════════════════════════════════════════════════════════════════

export interface GoogleCalendarConfig {
  oauth: OAuth2Client;
  account: string;
  fetch?: typeof fetch;
}
const GCAL = 'https://www.googleapis.com/calendar/v3';

export function createGoogleCalendarListTool(cfg: GoogleCalendarConfig): Tool<{ calendarId?: string; timeMin?: string; maxResults?: number }> {
  return {
    name: 'google_calendar_list',
    description: "List upcoming events from the user's Google Calendar.",
    permissions: ['net.fetch'],
    inputSchema: {
      type: 'object',
      properties: {
        calendarId: { type: 'string', default: 'primary' },
        timeMin: { type: 'string' },
        maxResults: { type: 'integer', minimum: 1, maximum: 250 },
      },
    },
    validator: z.object({
      calendarId: z.string().optional(),
      timeMin: z.string().optional(),
      maxResults: z.number().int().min(1).max(250).optional(),
    }),
    async execute(input) {
      const f = cfg.fetch ?? fetch;
      const tok = await cfg.oauth.getAccessToken(cfg.account);
      const cal = input.calendarId ?? 'primary';
      const url = new URL(`${GCAL}/calendars/${encodeURIComponent(cal)}/events`);
      url.searchParams.set('timeMin', input.timeMin ?? new Date().toISOString());
      url.searchParams.set('maxResults', String(input.maxResults ?? 25));
      url.searchParams.set('singleEvents', 'true');
      url.searchParams.set('orderBy', 'startTime');
      const resp = await fetchWithRetry(() => f(url.toString(), { headers: { authorization: `Bearer ${tok}` } }));
      if (!resp.ok) return httpErr('google-calendar', resp);
      return { ok: true, output: await resp.text() };
    },
  };
}

export function createGoogleCalendarCreateTool(cfg: GoogleCalendarConfig): Tool<{
  calendarId?: string;
  summary: string;
  startIso: string;
  endIso: string;
  description?: string;
  attendees?: string[];
}> {
  return {
    name: 'google_calendar_create',
    description: 'Create an event on the user\'s Google Calendar.',
    permissions: ['net.fetch'],
    inputSchema: {
      type: 'object',
      required: ['summary', 'startIso', 'endIso'],
      properties: {
        calendarId: { type: 'string' },
        summary: { type: 'string' },
        startIso: { type: 'string' },
        endIso: { type: 'string' },
        description: { type: 'string' },
        attendees: { type: 'array', items: { type: 'string' } },
      },
    },
    validator: z.object({
      calendarId: z.string().optional(),
      summary: z.string().min(1),
      startIso: z.string().min(1),
      endIso: z.string().min(1),
      description: z.string().optional(),
      attendees: z.array(z.string()).optional(),
    }),
    async execute(input) {
      const f = cfg.fetch ?? fetch;
      const tok = await cfg.oauth.getAccessToken(cfg.account);
      const cal = input.calendarId ?? 'primary';
      const body = {
        summary: input.summary,
        start: { dateTime: input.startIso },
        end: { dateTime: input.endIso },
        ...(input.description && { description: input.description }),
        ...(input.attendees && { attendees: input.attendees.map((email) => ({ email })) }),
      };
      const resp = await fetchWithRetry(() =>
        f(`${GCAL}/calendars/${encodeURIComponent(cal)}/events`, {
          method: 'POST',
          headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
      );
      if (!resp.ok) return httpErr('google-calendar', resp);
      return { ok: true, output: await resp.text() };
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. Notion (integration-token auth for skill usage, not the Phase 16 connector)
// ═══════════════════════════════════════════════════════════════════════════

export interface NotionSkillConfig {
  token?: string;
  fetch?: typeof fetch;
}
const NOTION = 'https://api.notion.com/v1';

export function createNotionSearchTool(cfg: NotionSkillConfig = {}): Tool<{ query: string }> {
  return {
    name: 'notion_search',
    description: 'Search pages + databases the Notion integration can access.',
    permissions: ['net.fetch'],
    inputSchema: { type: 'object', required: ['query'], properties: { query: { type: 'string' } } },
    validator: z.object({ query: z.string().min(1) }),
    async execute(input) {
      const tok = cfg.token ?? process.env['NOTION_TOKEN'];
      if (!tok) return missingKey('notion', 'NOTION_TOKEN');
      const f = cfg.fetch ?? fetch;
      const resp = await fetchWithRetry(() =>
        f(`${NOTION}/search`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${tok}`,
            'content-type': 'application/json',
            'notion-version': '2022-06-28',
          },
          body: JSON.stringify({ query: input.query }),
        }),
      );
      if (!resp.ok) return httpErr('notion', resp);
      return { ok: true, output: await resp.text() };
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. Obsidian (local vault)
// ═══════════════════════════════════════════════════════════════════════════

export interface ObsidianConfig {
  vaultPath: string;
  /** Injectable for tests. */
  fs?: { readFile(p: string): Promise<string>; writeFile(p: string, c: string): Promise<void>; readdir(p: string): Promise<string[]> };
}

export function createObsidianReadNoteTool(cfg: ObsidianConfig): Tool<{ relPath: string }> {
  return {
    name: 'obsidian_read_note',
    description: 'Read a markdown note from the Obsidian vault.',
    permissions: ['fs.read'],
    inputSchema: { type: 'object', required: ['relPath'], properties: { relPath: { type: 'string' } } },
    validator: z.object({ relPath: z.string().min(1).refine((s) => !s.includes('..'), 'path traversal blocked') }),
    async execute(input) {
      const fs = cfg.fs ?? (await loadNodeFs());
      try {
        const content = await fs.readFile(`${cfg.vaultPath}/${input.relPath}`);
        return { ok: true, output: content };
      } catch (err) {
        return { ok: false, output: err instanceof Error ? err.message : String(err), errorCode: 'HIPP0_OBSIDIAN_ERR' };
      }
    },
  };
}

async function loadNodeFs(): Promise<NonNullable<ObsidianConfig['fs']>> {
  const { promises: fs } = await import('node:fs');
  return {
    readFile: (p) => fs.readFile(p, 'utf8'),
    writeFile: (p, c) => fs.writeFile(p, c, 'utf8'),
    readdir: (p) => fs.readdir(p),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. Trello (API key + token)
// ═══════════════════════════════════════════════════════════════════════════

export interface TrelloConfig {
  apiKey?: string;
  token?: string;
  fetch?: typeof fetch;
}
const TRELLO = 'https://api.trello.com/1';

export function createTrelloListBoardsTool(cfg: TrelloConfig = {}): Tool<Record<string, unknown>> {
  return {
    name: 'trello_list_boards',
    description: 'List the authenticated user\'s Trello boards.',
    permissions: ['net.fetch'],
    inputSchema: { type: 'object' },
    validator: z.object({}).passthrough(),
    async execute() {
      const key = cfg.apiKey ?? process.env['TRELLO_API_KEY'];
      const tok = cfg.token ?? process.env['TRELLO_TOKEN'];
      if (!key || !tok) return missingKey('trello', 'TRELLO_API_KEY + TRELLO_TOKEN');
      const f = cfg.fetch ?? fetch;
      const resp = await fetchWithRetry(() =>
        f(`${TRELLO}/members/me/boards?key=${key}&token=${tok}`, { headers: { accept: 'application/json' } }),
      );
      if (!resp.ok) return httpErr('trello', resp);
      return { ok: true, output: await resp.text() };
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. Google Drive (OAuth2)
// ═══════════════════════════════════════════════════════════════════════════

export interface GoogleDriveConfig {
  oauth: OAuth2Client;
  account: string;
  fetch?: typeof fetch;
}
const DRIVE = 'https://www.googleapis.com/drive/v3';

export function createGoogleDriveSearchTool(cfg: GoogleDriveConfig): Tool<{ q: string; pageSize?: number }> {
  return {
    name: 'google_drive_search',
    description: 'Search Google Drive files (Drive v3 query syntax).',
    permissions: ['net.fetch'],
    inputSchema: {
      type: 'object',
      required: ['q'],
      properties: { q: { type: 'string' }, pageSize: { type: 'integer', minimum: 1, maximum: 100 } },
    },
    validator: z.object({ q: z.string().min(1), pageSize: z.number().int().min(1).max(100).optional() }),
    async execute(input) {
      const f = cfg.fetch ?? fetch;
      const tok = await cfg.oauth.getAccessToken(cfg.account);
      const url = new URL(`${DRIVE}/files`);
      url.searchParams.set('q', input.q);
      url.searchParams.set('pageSize', String(input.pageSize ?? 20));
      url.searchParams.set('fields', 'files(id,name,mimeType,modifiedTime,webViewLink)');
      const resp = await fetchWithRetry(() => f(url.toString(), { headers: { authorization: `Bearer ${tok}` } }));
      if (!resp.ok) return httpErr('google-drive', resp);
      return { ok: true, output: await resp.text() };
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 8. Dropbox (access token)
// ═══════════════════════════════════════════════════════════════════════════

export interface DropboxConfig {
  accessToken?: string;
  fetch?: typeof fetch;
}
const DBX = 'https://api.dropboxapi.com/2';

export function createDropboxSearchTool(cfg: DropboxConfig = {}): Tool<{ query: string; maxResults?: number }> {
  return {
    name: 'dropbox_search',
    description: 'Search files in the user\'s Dropbox.',
    permissions: ['net.fetch'],
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: { query: { type: 'string' }, maxResults: { type: 'integer', minimum: 1, maximum: 1000 } },
    },
    validator: z.object({ query: z.string().min(1), maxResults: z.number().int().min(1).max(1000).optional() }),
    async execute(input) {
      const tok = cfg.accessToken ?? process.env['DROPBOX_ACCESS_TOKEN'];
      if (!tok) return missingKey('dropbox', 'DROPBOX_ACCESS_TOKEN');
      const f = cfg.fetch ?? fetch;
      const resp = await fetchWithRetry(() =>
        f(`${DBX}/files/search_v2`, {
          method: 'POST',
          headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
          body: JSON.stringify({ query: input.query, options: { max_results: input.maxResults ?? 20 } }),
        }),
      );
      if (!resp.ok) return httpErr('dropbox', resp);
      return { ok: true, output: await resp.text() };
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 9. Jira Cloud (Basic auth email:api_token)
// ═══════════════════════════════════════════════════════════════════════════

export interface JiraConfig {
  baseUrl: string; // e.g. https://acme.atlassian.net
  email?: string;
  apiToken?: string;
  fetch?: typeof fetch;
}

export function createJiraSearchIssuesTool(cfg: JiraConfig): Tool<{ jql: string; maxResults?: number }> {
  return {
    name: 'jira_search_issues',
    description: 'Search Jira issues with JQL.',
    permissions: ['net.fetch'],
    inputSchema: {
      type: 'object',
      required: ['jql'],
      properties: { jql: { type: 'string' }, maxResults: { type: 'integer', minimum: 1, maximum: 100 } },
    },
    validator: z.object({ jql: z.string().min(1), maxResults: z.number().int().min(1).max(100).optional() }),
    async execute(input) {
      const email = cfg.email ?? process.env['JIRA_EMAIL'];
      const tok = cfg.apiToken ?? process.env['JIRA_API_TOKEN'];
      if (!email || !tok) return missingKey('jira', 'JIRA_EMAIL + JIRA_API_TOKEN');
      const auth = `Basic ${Buffer.from(`${email}:${tok}`).toString('base64')}`;
      const f = cfg.fetch ?? fetch;
      const url = new URL(`${cfg.baseUrl}/rest/api/3/search`);
      url.searchParams.set('jql', input.jql);
      url.searchParams.set('maxResults', String(input.maxResults ?? 20));
      const resp = await fetchWithRetry(() => f(url.toString(), { headers: { authorization: auth, accept: 'application/json' } }));
      if (!resp.ok) return httpErr('jira', resp);
      return { ok: true, output: await resp.text() };
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 10. Home Assistant (long-lived access token + REST API)
// ═══════════════════════════════════════════════════════════════════════════

export interface HaSkillConfig {
  baseUrl: string; // e.g. http://homeassistant.local:8123
  accessToken?: string;
  fetch?: typeof fetch;
}

export function createHaCallServiceTool(cfg: HaSkillConfig): Tool<{ domain: string; service: string; data?: Record<string, unknown> }> {
  return {
    name: 'home_assistant_call_service',
    description: 'Call a Home Assistant service (domain.service) with optional data.',
    permissions: ['net.fetch'],
    inputSchema: {
      type: 'object',
      required: ['domain', 'service'],
      properties: { domain: { type: 'string' }, service: { type: 'string' }, data: { type: 'object' } },
    },
    validator: z.object({ domain: z.string().min(1), service: z.string().min(1), data: z.record(z.unknown()).optional() }),
    async execute(input) {
      const tok = cfg.accessToken ?? process.env['HOMEASSISTANT_TOKEN'];
      if (!tok) return missingKey('home-assistant', 'HOMEASSISTANT_TOKEN');
      const f = cfg.fetch ?? fetch;
      const resp = await fetchWithRetry(() =>
        f(`${cfg.baseUrl}/api/services/${input.domain}/${input.service}`, {
          method: 'POST',
          headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
          body: JSON.stringify(input.data ?? {}),
        }),
      );
      if (!resp.ok) return httpErr('home-assistant', resp);
      return { ok: true, output: await resp.text() };
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 11. Philips Hue (Bridge v2 REST, app-key auth)
// ═══════════════════════════════════════════════════════════════════════════

export interface HueConfig {
  bridgeIp: string;
  applicationKey?: string;
  fetch?: typeof fetch;
}

export function createHueListLightsTool(cfg: HueConfig): Tool<Record<string, unknown>> {
  return {
    name: 'hue_list_lights',
    description: 'List all lights on the Hue bridge.',
    permissions: ['net.fetch'],
    inputSchema: { type: 'object' },
    validator: z.object({}).passthrough(),
    async execute() {
      const key = cfg.applicationKey ?? process.env['HUE_APPLICATION_KEY'];
      if (!key) return missingKey('hue', 'HUE_APPLICATION_KEY');
      const f = cfg.fetch ?? fetch;
      const resp = await fetchWithRetry(() =>
        f(`https://${cfg.bridgeIp}/clip/v2/resource/light`, { headers: { 'hue-application-key': key } }),
      );
      if (!resp.ok) return httpErr('hue', resp);
      return { ok: true, output: await resp.text() };
    },
  };
}

export function createHueSetLightTool(cfg: HueConfig): Tool<{ lightId: string; on?: boolean; brightness?: number }> {
  return {
    name: 'hue_set_light',
    description: 'Turn a Hue light on/off or set its brightness.',
    permissions: ['net.fetch'],
    inputSchema: {
      type: 'object',
      required: ['lightId'],
      properties: {
        lightId: { type: 'string' },
        on: { type: 'boolean' },
        brightness: { type: 'number', minimum: 0, maximum: 100 },
      },
    },
    validator: z.object({ lightId: z.string().min(1), on: z.boolean().optional(), brightness: z.number().min(0).max(100).optional() }),
    async execute(input) {
      const key = cfg.applicationKey ?? process.env['HUE_APPLICATION_KEY'];
      if (!key) return missingKey('hue', 'HUE_APPLICATION_KEY');
      const body: Record<string, unknown> = {};
      if (typeof input.on === 'boolean') body['on'] = { on: input.on };
      if (typeof input.brightness === 'number') body['dimming'] = { brightness: input.brightness };
      const f = cfg.fetch ?? fetch;
      const resp = await fetchWithRetry(() =>
        f(`https://${cfg.bridgeIp}/clip/v2/resource/light/${input.lightId}`, {
          method: 'PUT',
          headers: { 'hue-application-key': key, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
      );
      if (!resp.ok) return httpErr('hue', resp);
      return { ok: true, output: await resp.text() };
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 12. Spotify (OAuth2)
// ═══════════════════════════════════════════════════════════════════════════

export interface SpotifyConfig {
  oauth: OAuth2Client;
  account: string;
  fetch?: typeof fetch;
}
const SPOTIFY = 'https://api.spotify.com/v1';

export function createSpotifySearchTool(cfg: SpotifyConfig): Tool<{ q: string; type?: 'track' | 'album' | 'artist' | 'playlist'; limit?: number }> {
  return {
    name: 'spotify_search',
    description: 'Search Spotify tracks, albums, artists, or playlists.',
    permissions: ['net.fetch'],
    inputSchema: {
      type: 'object',
      required: ['q'],
      properties: { q: { type: 'string' }, type: { type: 'string' }, limit: { type: 'integer' } },
    },
    validator: z.object({
      q: z.string().min(1),
      type: z.enum(['track', 'album', 'artist', 'playlist']).optional(),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    async execute(input) {
      const f = cfg.fetch ?? fetch;
      const tok = await cfg.oauth.getAccessToken(cfg.account);
      const url = new URL(`${SPOTIFY}/search`);
      url.searchParams.set('q', input.q);
      url.searchParams.set('type', input.type ?? 'track');
      url.searchParams.set('limit', String(input.limit ?? 10));
      const resp = await fetchWithRetry(() => f(url.toString(), { headers: { authorization: `Bearer ${tok}` } }));
      if (!resp.ok) return httpErr('spotify', resp);
      return { ok: true, output: await resp.text() };
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 13. SMS via Twilio (REST)
// ═══════════════════════════════════════════════════════════════════════════

export interface TwilioConfig {
  accountSid?: string;
  authToken?: string;
  from?: string;
  fetch?: typeof fetch;
}

export function createTwilioSendSmsTool(cfg: TwilioConfig = {}): Tool<{ to: string; body: string; from?: string }> {
  return {
    name: 'twilio_send_sms',
    description: 'Send an SMS through Twilio.',
    permissions: ['net.fetch'],
    inputSchema: {
      type: 'object',
      required: ['to', 'body'],
      properties: { to: { type: 'string' }, body: { type: 'string' }, from: { type: 'string' } },
    },
    validator: z.object({ to: z.string().min(1), body: z.string().min(1), from: z.string().optional() }),
    async execute(input) {
      const sid = cfg.accountSid ?? process.env['TWILIO_ACCOUNT_SID'];
      const tok = cfg.authToken ?? process.env['TWILIO_AUTH_TOKEN'];
      const from = input.from ?? cfg.from ?? process.env['TWILIO_FROM'];
      if (!sid || !tok || !from) return missingKey('twilio', 'TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM');
      const auth = `Basic ${Buffer.from(`${sid}:${tok}`).toString('base64')}`;
      const f = cfg.fetch ?? fetch;
      const form = new URLSearchParams({ To: input.to, From: from, Body: input.body });
      const resp = await fetchWithRetry(() =>
        f(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
          method: 'POST',
          headers: { authorization: auth, 'content-type': 'application/x-www-form-urlencoded' },
          body: form.toString(),
        }),
      );
      if (!resp.ok) return httpErr('twilio', resp);
      return { ok: true, output: await resp.text() };
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 14. Mattermost (personal access token)
// ═══════════════════════════════════════════════════════════════════════════

export interface MattermostSkillConfig {
  baseUrl: string;
  token?: string;
  fetch?: typeof fetch;
}

export function createMattermostPostTool(cfg: MattermostSkillConfig): Tool<{ channelId: string; message: string }> {
  return {
    name: 'mattermost_post',
    description: 'Post a message to a Mattermost channel.',
    permissions: ['net.fetch'],
    inputSchema: {
      type: 'object',
      required: ['channelId', 'message'],
      properties: { channelId: { type: 'string' }, message: { type: 'string' } },
    },
    validator: z.object({ channelId: z.string().min(1), message: z.string().min(1) }),
    async execute(input) {
      const tok = cfg.token ?? process.env['MATTERMOST_TOKEN'];
      if (!tok) return missingKey('mattermost', 'MATTERMOST_TOKEN');
      const f = cfg.fetch ?? fetch;
      const resp = await fetchWithRetry(() =>
        f(`${cfg.baseUrl}/api/v4/posts`, {
          method: 'POST',
          headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
          body: JSON.stringify({ channel_id: input.channelId, message: input.message }),
        }),
      );
      if (!resp.ok) return httpErr('mattermost', resp);
      return { ok: true, output: await resp.text() };
    },
  };
}
