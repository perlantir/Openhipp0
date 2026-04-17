/**
 * HTML5 video caption track parser — WebVTT + SRT. No SDK dep.
 * Used by the browser when it wants to surface captions without running
 * frame-level vision.
 */

import type { Caption, CaptionTrack } from './types.js';

const TIMESTAMP_WEBVTT = /(\d{2}):(\d{2}):(\d{2})\.(\d{3})/g;
const TIMESTAMP_SRT = /(\d{2}):(\d{2}):(\d{2}),(\d{3})/g;

function msFromParts(h: string, m: string, s: string, ms: string): number {
  return Number(h) * 3_600_000 + Number(m) * 60_000 + Number(s) * 1_000 + Number(ms);
}

export function parseWebVtt(text: string, language = 'en'): CaptionTrack {
  const captions: Caption[] = [];
  const blocks = text
    .replace(/^WEBVTT[^\n]*\n/, '')
    .split(/\r?\n\r?\n/)
    .filter((b) => b.trim().length > 0);
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) continue;
    const timestampLine = lines.find((l) => l.includes('-->'));
    if (!timestampLine) continue;
    const matches = [...timestampLine.matchAll(TIMESTAMP_WEBVTT)];
    if (matches.length < 2) continue;
    const [, sh, sm, ss, sms] = matches[0]!;
    const [, eh, em, es, ems] = matches[1]!;
    const textLines = lines.filter((l) => !l.includes('-->') && !/^\d+$/.test(l.trim()));
    captions.push({
      startMs: msFromParts(sh!, sm!, ss!, sms!),
      endMs: msFromParts(eh!, em!, es!, ems!),
      text: textLines.join(' '),
      language,
    });
  }
  return { language, label: language, captions };
}

export function parseSrt(text: string, language = 'en'): CaptionTrack {
  const captions: Caption[] = [];
  const blocks = text.split(/\r?\n\r?\n/).filter((b) => b.trim().length > 0);
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) continue;
    const timestampLine = lines.find((l) => l.includes('-->'));
    if (!timestampLine) continue;
    const matches = [...timestampLine.matchAll(TIMESTAMP_SRT)];
    if (matches.length < 2) continue;
    const [, sh, sm, ss, sms] = matches[0]!;
    const [, eh, em, es, ems] = matches[1]!;
    const textLines = lines.filter((l) => !l.includes('-->') && !/^\d+$/.test(l.trim()));
    captions.push({
      startMs: msFromParts(sh!, sm!, ss!, sms!),
      endMs: msFromParts(eh!, em!, es!, ems!),
      text: textLines.join(' '),
      language,
    });
  }
  return { language, label: language, captions };
}

/** Concatenate all caption text within a time range. */
export function extractRange(track: CaptionTrack, startMs: number, endMs: number): string {
  return track.captions
    .filter((c) => c.startMs < endMs && c.endMs > startMs)
    .map((c) => c.text)
    .join(' ');
}
