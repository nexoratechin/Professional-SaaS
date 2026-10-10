/**
 * Backup manifests — the durable, machine-readable record of every backup this platform takes.
 *
 * A manifest is written to object storage next to the archive it describes (same backup id). It is
 * what restore tooling and operators read to answer "which archive is this, is it verified, and when
 * was it taken" without downloading the archive itself. See docs/backup-recovery.md.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';

export const BACKUP_MANIFEST_VERSION = 1 as const;
export const DEFAULT_BACKUP_PREFIX = 'backups';

export type BackupKind = 'POSTGRES_FULL' | 'REDIS_SNAPSHOT';

export type BackupFormat = 'pg-custom' | 'redis-rdb' | 'redis-info';

/** One integrity probe result recorded by a restore verification run. */
export interface BackupProbeResult {
  name: string;
  value: number | null;
  /** Human-readable expectation (e.g. `= 250`, `>= 1`), copied for the record. */
  expected?: string;
  ok: boolean;
  error?: string;
}

/** Verification outcome: structure-only (`toc`) or full restore into a scratch database. */
export interface BackupVerification {
  verifiedAt: string;
  method: 'toc' | 'restore';
  ok: boolean;
  /** Tables found in the archive TOC (restore-verification only). */
  tableCount?: number;
  probes?: BackupProbeResult[];
  durationMs?: number;
  error?: string;
}

export interface BackupManifest {
  manifestVersion: typeof BACKUP_MANIFEST_VERSION;
  /** Unique id, also embedded in the object keys: `<compactUtc>-<8 hex>`. */
  id: string;
  kind: BackupKind;
  format: BackupFormat;
  /** ISO-8601 UTC; the RPO clock starts here. */
  createdAt: string;
  /** Environment the backup belongs to (production / staging / ...). */
  environment: string;
  databaseName?: string;
  /** Object-storage key of the archive (under the configured backup prefix). */
  objectKey: string;
  sizeBytes: number;
  /** SHA-256 of the archive bytes — verified before every restore. */
  sha256: string;
  /** `pg_dump --version` output where applicable. */
  toolVersion?: string;
  /** `server_version` reported by the database where applicable. */
  serverVersion?: string;
  verification?: BackupVerification;
  metadata?: Record<string, unknown>;
}

/**
 * Compact UTC timestamp `YYYYMMDDTHHMMSSZ` — lexicographically sortable, filesystem-safe, and the
 * first half of a backup id.
 */
export function compactUtc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/** `<compactUtc>-<8 hex>` — stable across storage backends and safe in object keys. */
export function buildBackupId(date: Date = new Date(), suffix: string = randomBytes(4).toString('hex')): string {
  return `${compactUtc(date)}-${suffix}`;
}

const BACKUP_ID_PATTERN = /^(\d{8}T\d{6}Z)-[0-9a-f]{2,}$/;

/** Extracts the creation timestamp encoded in a backup id; null when the id is unrecognised. */
export function parseBackupIdTimestamp(id: string): Date | null {
  const match = BACKUP_ID_PATTERN.exec(id);
  if (!match || !match[1]) return null;
  const raw = match[1];
  const iso = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(9, 11)}:${raw.slice(
    11,
    13,
  )}:${raw.slice(13, 15)}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Environment segment of an object key: lower-case, no path separators or stray characters. */
export function sanitizeEnvironmentName(name: string): string {
  const sanitized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!sanitized) {
    throw new Error(`Invalid environment name "${name}": must contain at least one [a-z0-9] character.`);
  }
  return sanitized;
}

function kindSegment(kind: BackupKind): string {
  return kind === 'POSTGRES_FULL' ? 'postgres' : 'redis';
}

export interface BackupObjectKeyInput {
  prefix?: string;
  environment: string;
  kind: BackupKind;
  id: string;
  /** Extension without the dot: `dump`, `rdb`, `json`. */
  extension: string;
}

/**
 * Object key for one backup archive:
 * `backups/<environment>/<postgres|redis>/<yyyy>/<mm>/<dd>/<id>.<ext>`
 *
 * Date-partitioned so retention listing and lifecycle rules can act on prefixes; the id keeps the
 * archive and its manifest adjacent.
 */
export function buildBackupObjectKey(input: BackupObjectKeyInput): string {
  const idDate = parseBackupIdTimestamp(input.id);
  const date = idDate ?? new Date();
  const parts = [
    input.prefix ?? DEFAULT_BACKUP_PREFIX,
    sanitizeEnvironmentName(input.environment),
    kindSegment(input.kind),
    String(date.getUTCFullYear()).padStart(4, '0'),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
    `${input.id}.${input.extension}`,
  ];
  return parts.join('/');
}

/** Manifest key: the archive key with `.manifest.json` replacing the format extension. */
export function buildManifestObjectKey(input: Omit<BackupObjectKeyInput, 'extension'>): string {
  return buildBackupObjectKey({ ...input, extension: 'manifest.json' });
}

/** Creates a manifest with the fields that are always computable locally. */
export function createBackupManifest(
  input: Omit<BackupManifest, 'manifestVersion' | 'createdAt'> & { createdAt?: string },
): BackupManifest {
  return {
    ...input,
    manifestVersion: BACKUP_MANIFEST_VERSION,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** Parses and validates a manifest document; throws with a precise reason when malformed. */
export function parseBackupManifest(json: string): BackupManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(`Backup manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Backup manifest must be a JSON object.');
  }
  const candidate = parsed as Record<string, unknown>;
  if (candidate.manifestVersion !== BACKUP_MANIFEST_VERSION) {
    throw new Error(
      `Unsupported backup manifest version ${String(candidate.manifestVersion)} (expected ${BACKUP_MANIFEST_VERSION}).`,
    );
  }
  const requiredStrings = ['id', 'kind', 'format', 'createdAt', 'environment', 'objectKey', 'sha256'] as const;
  for (const field of requiredStrings) {
    if (typeof candidate[field] !== 'string' || (candidate[field] as string).length === 0) {
      throw new Error(`Backup manifest is missing required string field "${field}".`);
    }
  }
  if (candidate.kind !== 'POSTGRES_FULL' && candidate.kind !== 'REDIS_SNAPSHOT') {
    throw new Error(`Unknown backup kind "${String(candidate.kind)}".`);
  }
  if (!SHA256_PATTERN.test(candidate.sha256 as string)) {
    throw new Error('Backup manifest "sha256" must be 64 lower-case hex characters.');
  }
  if (typeof candidate.sizeBytes !== 'number' || !Number.isFinite(candidate.sizeBytes) || candidate.sizeBytes < 0) {
    throw new Error('Backup manifest "sizeBytes" must be a non-negative number.');
  }
  if (Number.isNaN(new Date(candidate.createdAt as string).getTime())) {
    throw new Error('Backup manifest "createdAt" is not a valid date.');
  }
  return candidate as unknown as BackupManifest;
}

export function serializeBackupManifest(manifest: BackupManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function computeBufferSha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export function computeFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}
