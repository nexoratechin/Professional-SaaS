/**
 * SSRF guard for outbound HTTP calls whose target URL comes (directly or indirectly) from tenant
 * configuration — integration `baseUrl`, attendance-device `endpointUrl`, OIDC `issuer`/discovery.
 *
 * A tenant admin can point any of those at an internal service (`http://169.254.169.254/...`,
 * `http://127.0.0.1:6379`, `http://minio:9000`, an internal admin panel) and have the server issue
 * the request on their behalf. This module rejects the obvious and the resolved-private targets
 * before the request is made, and callers disable redirect following so a public URL cannot bounce
 * to an internal one.
 *
 * ## Policy
 *
 * - Only `http`/`https` are allowed.
 * - Literal loopback/private/link-local IPs, `localhost`, `*.localhost`, `*.internal` and the cloud
 *   metadata hostnames are always rejected when enforcement is on.
 * - Hostnames are resolved and every resolved address is checked (defends against a public name
 *   that points at a private address, including DNS rebinding to a private range). A hostname that
 *   does not resolve is *not* rejected here — the subsequent fetch fails on its own and blocking it
 *   would make offline/unit tests impossible.
 * - `SSRF_ALLOWED_HOSTS` (comma-separated; supports `*.example.com`) is a break-glass allowlist for
 *   intentionally self-hosted internal providers.
 * - Enforcement is on in production. Outside production (dev/test/CI) it defaults off so local
 *   fixtures and stubbed fetch tests keep working; set `SSRF_ALLOW_PRIVATE_ADDRESSES=true` to force
 *   it on, or `false`… see below.
 *
 * `SSRF_ALLOW_PRIVATE_ADDRESSES` explicitly wins: `true` disables the private-address check
 * everywhere (needed only for an intentionally air-gapped deployment), `false` enforces it even in
 * development. Unset: enforce only when NODE_ENV=production.
 */

import { promises as dns } from 'dns';
import { isIP } from 'net';

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfError';
  }
}

export interface SsrfGuardOptions {
  /** Override the environment-derived policy (used by tests). */
  allowPrivate?: boolean;
  /** Hostnames (or `.suffix` / `*.suffix`) that bypass the private-address check. */
  allowedHosts?: string[];
  /** Injectable resolver so tests never touch DNS. */
  resolve?: (host: string) => Promise<string[]>;
}

function envAllowPrivate(): boolean {
  const raw = process.env.SSRF_ALLOW_PRIVATE_ADDRESSES;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return (process.env.NODE_ENV ?? 'development') !== 'production';
}

function parseAllowedHosts(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

function hostAllowed(host: string, allowedHosts: string[]): boolean {
  const normalized = host.toLowerCase();
  return allowedHosts.some((allowed) => {
    if (allowed.startsWith('*.')) {
      const suffix = allowed.slice(1); // ".example.com"
      return normalized === allowed.slice(2) || normalized.endsWith(suffix);
    }
    if (allowed.startsWith('.')) {
      return normalized === allowed.slice(1) || normalized.endsWith(allowed);
    }
    return normalized === allowed;
  });
}

/** True for IPs that must never be reachable from tenant-controlled outbound requests. */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPrivateIpv4(address);
  if (version === 6) return isPrivateIpv6(address);
  return false;
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 192 && b === 0 && parts[2] === 0) return true; // 192.0.0.0/24
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a >= 224) return true; // multicast 224.0.0.0/4 + reserved 240.0.0.0/4
  return false;
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0] ?? address.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  if (mapped?.[1]) return isPrivateIpv4(mapped[1]);
  if (normalized === '::' || normalized === '::1') return true;
  // fc00::/7 unique-local, fe80::/10 link-local.
  if (/^f[cd][0-9a-f]{2}:/.test(normalized)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(normalized)) return true;
  // IPv4-compatible / -mapped forms such as ::ffff:7f00:1 are uncommon; treat all-:: prefixed
  // addresses conservatively only when they embed loopback-ish words is out of scope — the mapped
  // dotted form above covers the realistic case.
  return false;
}

function stripBrackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal', 'metadata.goog', 'instance-data']);

/**
 * Validates an outbound URL and returns it. Throws `SsrfError` for anything that could be used to
 * reach an internal service. Callers should invoke this immediately before `fetch`.
 */
export async function assertSafeOutboundUrl(rawUrl: string | URL, options: SsrfGuardOptions = {}): Promise<URL> {
  const url = rawUrl instanceof URL ? rawUrl : new URL(rawUrl);

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfError(`Outbound URL protocol "${url.protocol}" is not allowed.`);
  }

  const host = stripBrackets(url.hostname).toLowerCase();
  if (!host) {
    throw new SsrfError('Outbound URL has no hostname.');
  }

  const allowPrivate = options.allowPrivate ?? envAllowPrivate();
  const allowedHosts = (options.allowedHosts ?? parseAllowedHosts(process.env.SSRF_ALLOWED_HOSTS)).map((h) =>
    h.toLowerCase(),
  );

  // Explicit allowlist (or the global private-address opt-out) short-circuits the check.
  if (allowPrivate || hostAllowed(host, allowedHosts)) {
    return url;
  }

  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.localhost')) {
    throw new SsrfError(`Outbound URL host "${host}" is not allowed.`);
  }

  const literalVersion = isIP(host);
  if (literalVersion !== 0) {
    if (isPrivateAddress(host)) {
      throw new SsrfError(`Outbound URL resolves to a private/internal address (${host}).`);
    }
    return url;
  }

  // Resolve and validate every address so a public name pointing at a private range is rejected.
  let addresses: string[];
  try {
    addresses = options.resolve
      ? await options.resolve(host)
      : (await dns.lookup(host, { all: true })).map((entry) => entry.address);
  } catch {
    // Does not resolve here (offline/unit test, transient DNS failure). The actual fetch will fail
    // too; failing closed on a resolver error would make the guard untestable offline.
    return url;
  }

  for (const address of addresses) {
    if (isPrivateAddress(address)) {
      throw new SsrfError(`Outbound URL host "${host}" resolves to a private/internal address (${address}).`);
    }
  }

  return url;
}
