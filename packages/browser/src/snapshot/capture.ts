/**
 * Capture a page snapshot — a11y tree + DOM + screenshot + network + console
 * + cookies. Dedups DOM / screenshot against the previous snapshot via
 * content hash so time-travel trails don't balloon.
 */

import { createHash, randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';

import {
  SNAPSHOT_SCHEMA_VERSION,
  type CapturePageInput,
  type CookieEntry,
  type DomPayload,
  type ScreenshotPayload,
  type Snapshot,
  type SnapshotId,
} from './types.js';

function sha256(buf: Buffer | string): string {
  const h = createHash('sha256');
  h.update(typeof buf === 'string' ? Buffer.from(buf, 'utf8') : buf);
  return h.digest('hex');
}

function packDom(html: string, previous?: Snapshot): DomPayload {
  const hash = sha256(html);
  if (previous?.dom.hash === hash) {
    return { hash, refPrevId: previous.id };
  }
  const gz = gzipSync(Buffer.from(html, 'utf8'));
  return { hash, contentGzB64: gz.toString('base64') };
}

function packScreenshot(png: Buffer, previous?: Snapshot): ScreenshotPayload {
  const hash = sha256(png);
  if (previous?.screenshot.hash === hash) {
    return { hash, refPrevId: previous.id };
  }
  return { hash, pngB64: png.toString('base64') };
}

function toCookieEntry(raw: Record<string, unknown>): CookieEntry {
  const name = String(raw['name'] ?? '');
  const value = String(raw['value'] ?? '');
  const domain = String(raw['domain'] ?? '');
  const path = typeof raw['path'] === 'string' ? (raw['path'] as string) : '/';
  const out: CookieEntry = {
    name,
    value,
    domain,
    path,
    ...(typeof raw['expires'] === 'number' ? { expires: raw['expires'] as number } : {}),
    ...(typeof raw['httpOnly'] === 'boolean' ? { httpOnly: raw['httpOnly'] as boolean } : {}),
    ...(typeof raw['secure'] === 'boolean' ? { secure: raw['secure'] as boolean } : {}),
    ...(typeof raw['sameSite'] === 'string'
      ? { sameSite: raw['sameSite'] as 'Strict' | 'Lax' | 'None' }
      : {}),
  };
  return out;
}

export async function capturePageSnapshot(input: CapturePageInput): Promise<Snapshot> {
  const [title, html, png, cookies, ax] = await Promise.all([
    input.page.title(),
    input.page.content(),
    input.page.screenshot({ fullPage: false }),
    input.context.cookies(),
    input.page.accessibility.snapshot({ interestingOnly: true }),
  ]);
  const id = randomUUID() as SnapshotId;
  const dom = packDom(html, input.previous);
  const screenshot = packScreenshot(png, input.previous);
  const snap: Snapshot = {
    version: SNAPSHOT_SCHEMA_VERSION,
    id,
    sessionId: input.sessionId,
    takenAt: new Date().toISOString(),
    url: input.page.url(),
    title,
    ax: ax ?? null,
    dom,
    screenshot,
    network: input.network ?? [],
    console: input.console ?? [],
    cookies: cookies.map(toCookieEntry),
    ...(input.label ? { label: input.label } : {}),
    ...(input.metadata ? { metadata: { ...input.metadata } } : {}),
  };
  return snap;
}
