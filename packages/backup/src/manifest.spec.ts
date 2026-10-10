import {
  BACKUP_MANIFEST_VERSION,
  buildBackupId,
  buildBackupObjectKey,
  buildManifestObjectKey,
  compactUtc,
  computeBufferSha256,
  createBackupManifest,
  parseBackupIdTimestamp,
  parseBackupManifest,
  sanitizeEnvironmentName,
  serializeBackupManifest,
} from './manifest';

describe('compactUtc / buildBackupId / parseBackupIdTimestamp', () => {
  it('formats a stable compact UTC timestamp', () => {
    expect(compactUtc(new Date('2026-10-09T02:15:30.123Z'))).toBe('20261009T021530Z');
  });

  it('round-trips the timestamp embedded in a backup id', () => {
    const date = new Date('2026-10-09T02:15:30.123Z');
    const id = buildBackupId(date, 'deadbeef');
    expect(id).toBe('20261009T021530Z-deadbeef');
    // Ids carry second precision (Date -> the id is lossy below one second by design).
    expect(parseBackupIdTimestamp(id)?.toISOString()).toBe('2026-10-09T02:15:30.000Z');
  });

  it('returns null for an unrecognised id', () => {
    expect(parseBackupIdTimestamp('not-a-backup-id')).toBeNull();
    expect(parseBackupIdTimestamp('20261009T021530Z')).toBeNull();
  });
});

describe('sanitizeEnvironmentName', () => {
  it('lower-cases and strips unsafe characters', () => {
    expect(sanitizeEnvironmentName(' Production EU/1 ')).toBe('production-eu-1');
  });

  it('rejects names with no usable characters', () => {
    expect(() => sanitizeEnvironmentName('///')).toThrow(/Invalid environment name/);
  });
});

describe('object keys', () => {
  const id = '20261009T021530Z-deadbeef';

  it('partitions archives by environment/kind/date and keeps the manifest adjacent', () => {
    const archive = buildBackupObjectKey({
      environment: 'production',
      kind: 'POSTGRES_FULL',
      id,
      extension: 'dump',
    });
    expect(archive).toBe('backups/production/postgres/2026/10/09/20261009T021530Z-deadbeef.dump');
    const manifest = buildManifestObjectKey({ environment: 'production', kind: 'POSTGRES_FULL', id });
    expect(manifest).toBe('backups/production/postgres/2026/10/09/20261009T021530Z-deadbeef.manifest.json');
  });

  it('respects a custom prefix and the redis kind segment', () => {
    const key = buildBackupObjectKey({
      prefix: 'ops-backups',
      environment: 'staging',
      kind: 'REDIS_SNAPSHOT',
      id,
      extension: 'rdb',
    });
    expect(key).toBe('ops-backups/staging/redis/2026/10/09/20261009T021530Z-deadbeef.rdb');
  });
});

describe('manifests', () => {
  const base = createBackupManifest({
    id: '20261009T021530Z-deadbeef',
    kind: 'POSTGRES_FULL',
    format: 'pg-custom',
    createdAt: '2026-10-09T02:15:30.000Z',
    environment: 'production',
    databaseName: 'college_erp',
    objectKey: 'backups/production/postgres/2026/10/09/20261009T021530Z-deadbeef.dump',
    sizeBytes: 1024,
    sha256: 'a'.repeat(64),
  });

  it('stamps the manifest version and round-trips through JSON', () => {
    expect(base.manifestVersion).toBe(BACKUP_MANIFEST_VERSION);
    expect(parseBackupManifest(serializeBackupManifest(base))).toEqual(base);
  });

  it('rejects malformed manifests with a precise reason', () => {
    expect(() => parseBackupManifest('not json')).toThrow(/not valid JSON/);
    expect(() => parseBackupManifest('{"manifestVersion":99}')).toThrow(/Unsupported backup manifest version/);
    expect(() => parseBackupManifest(JSON.stringify({ ...base, sha256: 'zz' }))).toThrow(/sha256/);
    expect(() => parseBackupManifest(JSON.stringify({ ...base, kind: 'SOMETHING' }))).toThrow(/Unknown backup kind/);
    expect(() => parseBackupManifest(JSON.stringify({ ...base, createdAt: 'nope' }))).toThrow(/createdAt/);
  });

  it('hashes buffers with the well-known SHA-256 of empty input', () => {
    expect(computeBufferSha256(Buffer.from(''))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(computeBufferSha256(Buffer.from('college-erp'))).toHaveLength(64);
  });
});
