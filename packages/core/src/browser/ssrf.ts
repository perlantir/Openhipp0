/**
 * SSRF + DNS-rebinding guard for browser navigation.
 *
 * Hardening (Phase B4):
 *   - http(s) only — no file://, chrome://, data: etc.
 *   - Rejects literal private / loopback / link-local IPs.
 *   - Resolves the hostname and rejects when ANY answer falls in a private
 *     range (pessimistic — closes the DNS-rebinding window where an
 *     authoritative resolver can flip mid-session).
 *   - Returns a pinned public IP so callers can navigate by IP + Host header
 *     (prevents subsequent DNS flips during the same connection).
 */

export interface DnsResolver {
  resolve(host: string): Promise<readonly string[]>;
}

export function isIpv4Private(ip: string): boolean {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip);
  if (!m) return false;
  const [a, b, c, d] = [
    parseInt(m[1]!, 10),
    parseInt(m[2]!, 10),
    parseInt(m[3]!, 10),
    parseInt(m[4]!, 10),
  ];
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 224) return true;
  if (a === 255 && b === 255 && c === 255 && d === 255) return true;
  return false;
}

export function isIpv6Private(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  if (lower.startsWith('fe80:')) return true;
  // fc00::/7 covers ULA — first byte is 0xfc or 0xfd, i.e. lower starts with
  // "fc" or "fd" followed by any two hex chars then ':'.
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true;
  if (lower.startsWith('fc00:') || lower.startsWith('fd00:')) return true;
  return false;
}

export function isIpPrivate(ip: string): boolean {
  return isIpv4Private(ip) || isIpv6Private(ip);
}

export interface NavigationResolution {
  readonly url: string;
  readonly host: string;
  readonly ip: string;
  readonly scheme: 'http' | 'https';
  readonly port: number;
}

export type NavigationError =
  | { kind: 'scheme'; detail: string }
  | { kind: 'dns'; detail: string }
  | { kind: 'private-ip'; detail: string; ip: string }
  | { kind: 'empty-resolution'; detail: string };

export async function resolveAndGuard(
  url: string,
  resolver: DnsResolver,
): Promise<
  | { ok: true; resolution: NavigationResolution }
  | { ok: false; error: NavigationError }
> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: { kind: 'scheme', detail: 'invalid URL' } };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      ok: false,
      error: { kind: 'scheme', detail: `non-http(s) scheme: ${parsed.protocol}` },
    };
  }
  const scheme: 'http' | 'https' = parsed.protocol === 'http:' ? 'http' : 'https';
  const port = parsed.port ? parseInt(parsed.port, 10) : scheme === 'http' ? 80 : 443;
  const host = parsed.hostname;
  if (isIpPrivate(host)) {
    return {
      ok: false,
      error: { kind: 'private-ip', detail: 'literal private address', ip: host },
    };
  }
  let ips: readonly string[];
  try {
    ips = await resolver.resolve(host);
  } catch (err) {
    return { ok: false, error: { kind: 'dns', detail: (err as Error).message } };
  }
  if (ips.length === 0) {
    return {
      ok: false,
      error: { kind: 'empty-resolution', detail: `${host}: no A/AAAA records` },
    };
  }
  for (const ip of ips) {
    if (isIpPrivate(ip)) {
      return {
        ok: false,
        error: { kind: 'private-ip', detail: `${host} resolved to private ${ip}`, ip },
      };
    }
  }
  return {
    ok: true,
    resolution: { url, host, ip: ips[0]!, scheme, port },
  };
}

/** Default DnsResolver backed by `node:dns/promises`. */
export function createSystemResolver(): DnsResolver {
  return {
    async resolve(host: string): Promise<readonly string[]> {
      const dns = await import('node:dns/promises');
      try {
        const a = await dns.resolve4(host).catch(() => [] as string[]);
        const aaaa = await dns.resolve6(host).catch(() => [] as string[]);
        return [...a, ...aaaa];
      } catch {
        return [];
      }
    },
  };
}

export function ssrfErrorCode(kind: NavigationError['kind']): string {
  switch (kind) {
    case 'scheme':
      return 'HIPP0_BROWSER_SCHEME_BLOCKED';
    case 'dns':
      return 'HIPP0_BROWSER_DNS_FAILED';
    case 'private-ip':
      return 'HIPP0_BROWSER_PRIVATE_ADDRESS_BLOCKED';
    case 'empty-resolution':
      return 'HIPP0_BROWSER_DNS_EMPTY';
  }
}
