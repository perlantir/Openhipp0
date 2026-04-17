import { describe, expect, it } from 'vitest';
import {
  isIpPrivate,
  isIpv4Private,
  isIpv6Private,
  resolveAndGuard,
  ssrfErrorCode,
} from '../../src/browser/ssrf.js';

describe('isIpv4Private', () => {
  it.each([
    ['10.0.0.1', true],
    ['127.0.0.1', true],
    ['172.16.1.1', true],
    ['172.31.255.255', true],
    ['172.32.0.1', false],
    ['192.168.1.1', true],
    ['169.254.169.254', true],
    ['100.64.1.1', true],
    ['100.63.255.255', false],
    ['8.8.8.8', false],
    ['1.1.1.1', false],
    ['0.0.0.0', true],
    ['224.0.0.1', true],
    ['255.255.255.255', true],
  ])('%s → %s', (ip, expected) => {
    expect(isIpv4Private(ip)).toBe(expected);
  });
});

describe('isIpv6Private', () => {
  it.each([
    ['::1', true],
    ['fe80::1', true],
    ['fc00::1', true],
    ['fd12:3456::', true],
    ['2001:db8::1', false],
    ['2606:4700:4700::1111', false],
  ])('%s → %s', (ip, expected) => {
    expect(isIpv6Private(ip)).toBe(expected);
  });
});

describe('isIpPrivate', () => {
  it('covers both stacks', () => {
    expect(isIpPrivate('127.0.0.1')).toBe(true);
    expect(isIpPrivate('::1')).toBe(true);
    expect(isIpPrivate('8.8.8.8')).toBe(false);
  });
});

function fakeResolver(map: Record<string, string[]>) {
  return {
    async resolve(host: string) {
      const ips = map[host];
      if (!ips) throw new Error(`ENOTFOUND ${host}`);
      return ips;
    },
  };
}

describe('resolveAndGuard', () => {
  it('rejects non-http(s) schemes', async () => {
    const r = await resolveAndGuard('file:///etc/passwd', fakeResolver({}));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('scheme');
  });

  it('rejects literal private IPs', async () => {
    const r = await resolveAndGuard('http://127.0.0.1/admin', fakeResolver({}));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('private-ip');
  });

  it('rejects when DNS fails', async () => {
    const r = await resolveAndGuard('http://dead.example/', fakeResolver({}));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('dns');
  });

  it('rejects when host resolves to ANY private IP (DNS rebind defense)', async () => {
    const resolver = fakeResolver({
      'api.example.com': ['8.8.8.8', '192.168.1.10'],
    });
    const r = await resolveAndGuard('https://api.example.com/', resolver);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('private-ip');
  });

  it('rejects empty DNS answer', async () => {
    const resolver = fakeResolver({ 'empty.example': [] });
    const r = await resolveAndGuard('https://empty.example/', resolver);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('empty-resolution');
  });

  it('accepts public-only resolution, pinning the first IP', async () => {
    const resolver = fakeResolver({ 'api.example.com': ['8.8.8.8', '1.1.1.1'] });
    const r = await resolveAndGuard('https://api.example.com/path', resolver);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.resolution.ip).toBe('8.8.8.8');
      expect(r.resolution.host).toBe('api.example.com');
      expect(r.resolution.scheme).toBe('https');
      expect(r.resolution.port).toBe(443);
    }
  });

  it('honors custom ports', async () => {
    const resolver = fakeResolver({ 'h.example': ['9.9.9.9'] });
    const r = await resolveAndGuard('http://h.example:8080/', resolver);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.resolution.port).toBe(8080);
  });
});

describe('ssrfErrorCode', () => {
  it('maps every kind to a stable error code', () => {
    expect(ssrfErrorCode('scheme')).toBe('HIPP0_BROWSER_SCHEME_BLOCKED');
    expect(ssrfErrorCode('dns')).toBe('HIPP0_BROWSER_DNS_FAILED');
    expect(ssrfErrorCode('private-ip')).toBe('HIPP0_BROWSER_PRIVATE_ADDRESS_BLOCKED');
    expect(ssrfErrorCode('empty-resolution')).toBe('HIPP0_BROWSER_DNS_EMPTY');
  });
});
