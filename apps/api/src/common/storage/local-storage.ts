import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';

/**
 * Local-filesystem implementation of the object-storage surface, used when STORAGE_DRIVER=local
 * so the platform runs without S3/MinIO in development. It is deliberately minimal: it stores
 * objects under `<dir>/<bucket>/<key>` and mirrors the metadata the S3 driver returns.
 *
 * The same directory is shared with the worker (relative paths resolve against the workspace
 * root), so documents uploaded through the API are the exact bytes the worker scans/retains.
 */
export interface LocalObjectMetadata {
  sizeBytes: number;
  contentType: string | null;
  etag: string | null;
  lastModified: Date | null;
}

/** Walk up from `start` until pnpm-workspace.yaml is found, so a relative STORAGE_LOCAL_DIR is
 *  the same directory regardless of which app (api/ or worker/) was launched. */
export function resolveWorkspaceRoot(start: string = process.cwd()): string {
  let dir = resolve(start);
  for (let depth = 0; depth < 12; depth += 1) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(start);
}

export class LocalObjectStore {
  /** Absolute root of this bucket's objects: <storageDir>/<bucket>. */
  private readonly root: string;

  constructor(storageDir: string, bucket: string) {
    const base = isAbsolute(storageDir) ? storageDir : resolve(resolveWorkspaceRoot(), storageDir);
    this.root = join(base, bucket);
  }

  /** Maps a storage key (which may contain '/') to an absolute path, rejecting traversal outside
   *  the bucket root. Keys come from StorageService.buildKey (already sanitized) but are treated
   *  as untrusted here as defense in depth. */
  private pathFor(key: string): string {
    const normalized = key.replace(/\\/g, '/').replace(/^\/+/, '');
    const full = resolve(this.root, normalized);
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new Error('Invalid storage key.');
    }
    return full;
  }

  async ensureReady(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }

  async putBuffer(key: string, body: Buffer): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  async putStream(key: string, stream: Readable): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await pipeline(stream, createWriteStream(path));
  }

  readStream(key: string): Readable {
    return createReadStream(this.pathFor(key));
  }

  async getBuffer(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.pathFor(key));
      return true;
    } catch {
      return false;
    }
  }

  async metadata(key: string): Promise<LocalObjectMetadata> {
    const info = await stat(this.pathFor(key));
    return { sizeBytes: info.size, contentType: null, etag: null, lastModified: info.mtime };
  }

  async sha256(key: string): Promise<string> {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(this.pathFor(key))) {
      hash.update(chunk as Buffer);
    }
    return hash.digest('hex');
  }

  /** Idempotent delete: a missing object is a successful delete. */
  async remove(key: string): Promise<void> {
    try {
      await rm(this.pathFor(key));
    } catch {
      // Missing objects are a successful delete.
    }
  }
}

export interface LocalTokenPayload {
  /** Storage key. */
  k: string;
  /** Method this URL authorises: upload (`put`) or download (`get`). */
  m: 'put' | 'get';
  /** Expiry, epoch seconds. */
  e: number;
  /** Content type (upload: what the client may send; download: the response Content-Type). */
  ct?: string;
  /** Download response Content-Disposition. */
  cd?: string;
}

const TOKEN_VERSION = 1;

/** Single-purpose, short-lived URL token. Mirrors S3 presigning semantics: it grants exactly one
 *  method against exactly one key until it expires, and it is signed server-side so the browser
 *  can neither forge nor widen it. */
export function signLocalToken(payload: LocalTokenPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify({ v: TOKEN_VERSION, ...payload })).toString('base64url');
  const mac = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function verifyLocalToken(token: string, secret: string): LocalTokenPayload {
  const [body, mac] = token.split('.');
  if (!body || !mac) throw new Error('Malformed storage token.');
  const expected = createHmac('sha256', secret).update(body).digest();
  const provided = Buffer.from(mac, 'base64url');
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new Error('Invalid storage token.');
  }
  const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as LocalTokenPayload & {
    v?: number;
  };
  if (parsed.v !== TOKEN_VERSION) throw new Error('Unsupported storage token version.');
  if (!parsed.k || (parsed.m !== 'put' && parsed.m !== 'get')) throw new Error('Invalid storage token payload.');
  if (typeof parsed.e !== 'number' || parsed.e < Math.floor(Date.now() / 1000)) {
    throw new Error('Storage token expired.');
  }
  const payload: LocalTokenPayload = { k: parsed.k, m: parsed.m, e: parsed.e };
  if (parsed.ct) payload.ct = parsed.ct;
  if (parsed.cd) payload.cd = parsed.cd;
  return payload;
}

/** Signing secret for local URLs. Uses a dedicated STORAGE_LOCAL_SIGNING_SECRET when configured,
 *  otherwise derives one from the JWT private key (always present) so no new required secret is
 *  introduced; rotating the keypair simply invalidates in-flight URLs. */
export function localSigningSecret(read: (key: string) => unknown): string {
  const dedicated = read('STORAGE_LOCAL_SIGNING_SECRET');
  if (typeof dedicated === 'string' && dedicated.length > 0) return dedicated;
  const jwt = read('JWT_PRIVATE_KEY');
  return createHash('sha256')
    .update(typeof jwt === 'string' && jwt.length > 0 ? jwt : 'college-erp-local-storage-dev')
    .digest('hex');
}
