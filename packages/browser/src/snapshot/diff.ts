/**
 * Structural snapshot diff. Produces a list of `DiffEntry` covering url/title
 * changes, DOM hash change, screenshot hash change, a11y tree add/remove/
 * change, new network, new console, cookie deltas.
 */

import type { browser } from '@openhipp0/core';

import type {
  ConsoleEntry,
  CookieEntry,
  DiffEntry,
  NetworkEntry,
  Snapshot,
  SnapshotDiff,
} from './types.js';

type AxNode = browser.AxNode;

interface FlatAx {
  readonly key: string; // role:name
  readonly node: AxNode;
  readonly path: string;
}

function flattenAx(node: AxNode | null, prefix = ''): FlatAx[] {
  if (!node) return [];
  const key = `${node.role ?? '?'}:${node.name ?? ''}`;
  const here: FlatAx = { key, node, path: prefix };
  const out = [here];
  const children = node.children ?? [];
  for (let i = 0; i < children.length; i++) {
    out.push(...flattenAx(children[i] ?? null, `${prefix}/${i}`));
  }
  return out;
}

function cookieKey(c: CookieEntry): string {
  return `${c.domain}|${c.path}|${c.name}`;
}

function indexCookies(arr: readonly CookieEntry[]): Map<string, CookieEntry> {
  const m = new Map<string, CookieEntry>();
  for (const c of arr) m.set(cookieKey(c), c);
  return m;
}

function cookieValueEquals(a: CookieEntry, b: CookieEntry): boolean {
  return (
    a.value === b.value && a.expires === b.expires && a.httpOnly === b.httpOnly && a.secure === b.secure
  );
}

export function compareSnapshots(prev: Snapshot, curr: Snapshot): SnapshotDiff {
  const entries: DiffEntry[] = [];

  if (prev.url !== curr.url) {
    entries.push({
      kind: 'url-changed',
      prev: prev.url,
      curr: curr.url,
      message: `url: ${prev.url} → ${curr.url}`,
    });
  }
  if (prev.title !== curr.title) {
    entries.push({
      kind: 'title-changed',
      prev: prev.title,
      curr: curr.title,
      message: `title: ${prev.title} → ${curr.title}`,
    });
  }
  if (prev.dom.hash !== curr.dom.hash) {
    entries.push({
      kind: 'dom-changed',
      prev: prev.dom.hash,
      curr: curr.dom.hash,
      message: `DOM hash changed`,
    });
  }
  if (prev.screenshot.hash !== curr.screenshot.hash) {
    entries.push({
      kind: 'screenshot-changed',
      prev: prev.screenshot.hash,
      curr: curr.screenshot.hash,
      message: `screenshot hash changed`,
    });
  }

  const axPrev = flattenAx(prev.ax);
  const axCurr = flattenAx(curr.ax);
  const prevKeys = new Map(axPrev.map((n) => [n.key, n]));
  const currKeys = new Map(axCurr.map((n) => [n.key, n]));
  for (const [key, node] of currKeys) {
    const p = prevKeys.get(key);
    if (!p) {
      entries.push({
        kind: 'ax-added',
        path: node.path,
        curr: { role: node.node.role, name: node.node.name },
        message: `ax+ ${key} at ${node.path}`,
      });
    } else if (p.node.value !== node.node.value || p.node.checked !== node.node.checked) {
      entries.push({
        kind: 'ax-changed',
        path: node.path,
        prev: { value: p.node.value, checked: p.node.checked },
        curr: { value: node.node.value, checked: node.node.checked },
        message: `ax~ ${key}`,
      });
    }
  }
  for (const [key, node] of prevKeys) {
    if (!currKeys.has(key)) {
      entries.push({
        kind: 'ax-removed',
        path: node.path,
        prev: { role: node.node.role, name: node.node.name },
        message: `ax- ${key}`,
      });
    }
  }

  for (const n of curr.network as NetworkEntry[]) {
    entries.push({
      kind: 'network-added',
      path: n.requestId,
      curr: { method: n.method, url: n.url, status: n.status },
      message: `${n.method} ${n.url} → ${n.status}`,
    });
  }
  for (const c of curr.console as ConsoleEntry[]) {
    entries.push({
      kind: 'console-added',
      curr: { level: c.level, text: c.text },
      message: `[${c.level}] ${c.text}`,
    });
  }

  const prevC = indexCookies(prev.cookies);
  const currC = indexCookies(curr.cookies);
  for (const [k, c] of currC) {
    const p = prevC.get(k);
    if (!p) {
      entries.push({
        kind: 'cookie-added',
        path: k,
        curr: { value: c.value.length > 0 ? `len=${c.value.length}` : '<empty>' },
        message: `cookie+ ${k}`,
      });
    } else if (!cookieValueEquals(p, c)) {
      entries.push({
        kind: 'cookie-changed',
        path: k,
        message: `cookie~ ${k}`,
      });
    }
  }
  for (const [k] of prevC) {
    if (!currC.has(k)) {
      entries.push({ kind: 'cookie-removed', path: k, message: `cookie- ${k}` });
    }
  }

  return { prevId: prev.id, currId: curr.id, entries };
}
