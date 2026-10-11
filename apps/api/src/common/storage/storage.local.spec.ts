import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ForbiddenException } from '@nestjs/common';
import type { AppConfigService } from '../../config/app-config.service';
import { localSigningSecret, verifyLocalToken } from './local-storage';
import { StorageService } from './storage.service';

function localConfig(dir: string): { config: AppConfigService; read: (key: string) => unknown } {
  const values: Record<string, unknown> = {
    STORAGE_DRIVER: 'local',
    STORAGE_LOCAL_DIR: dir,
    STORAGE_LOCAL_URL_BASE: undefined,
    S3_BUCKET: 'test-bucket',
    PORT: 3000,
    JWT_PRIVATE_KEY: 'test-jwt-key',
  };
  const read = (key: string) => values[key];
  return { config: { get: read } as unknown as AppConfigService, read };
}

describe('StorageService local driver', () => {
  const tenantA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const tenantB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  let dir: string;
  let storage: StorageService;
  let read: (key: string) => unknown;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'college-erp-local-storage-'));
    const built = localConfig(dir);
    storage = new StorageService(built.config);
    read = built.read;
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips bytes through the local filesystem and reports real metadata', async () => {
    const key = storage.buildKey(tenantA, 'documents', 'note.txt');
    await storage.uploadBuffer(key, Buffer.from('hello world'), 'text/plain');

    await expect(storage.objectExists(tenantA, key)).resolves.toBe(true);
    const meta = await storage.getObjectMetadata(tenantA, key);
    expect(meta.sizeBytes).toBe(11);

    await expect(storage.downloadBuffer(tenantA, key)).resolves.toEqual(Buffer.from('hello world'));
    await expect(storage.computeObjectSha256(tenantA, key)).resolves.toBe(
      createHash('sha256').update('hello world').digest('hex'),
    );

    await storage.delete(tenantA, key);
    await expect(storage.objectExists(tenantA, key)).resolves.toBe(false);
  });

  it('mints a single-purpose signed upload URL and never touches S3', async () => {
    const key = storage.buildKey(tenantA, 'documents', 'x.pdf');
    const url = await storage.getUploadUrl(tenantA, key, 'application/pdf');
    expect(url.startsWith('http://localhost:3000/storage/local/')).toBe(true);

    const token = url.split('/storage/local/')[1]!;
    const payload = verifyLocalToken(token, localSigningSecret(read));
    expect(payload).toMatchObject({ k: key, m: 'put', ct: 'application/pdf' });
  });

  it('encodes the safe download content type / disposition into the signed URL token', async () => {
    const key = storage.buildKey(tenantA, 'documents', 'evil.html');
    const url = await storage.getDownloadUrl(tenantA, key, { filename: 'evil.html', contentType: 'text/html' });
    const token = url.split('/storage/local/')[1]!;
    const payload = verifyLocalToken(token, localSigningSecret(read));
    expect(payload.m).toBe('get');
    expect(payload.ct).toBe('application/octet-stream');
    expect(payload.cd).toContain('attachment');
  });

  it('rejects a token signed with a different secret, or the wrong method', async () => {
    const key = storage.buildKey(tenantA, 'documents', 'x.pdf');
    const url = await storage.getUploadUrl(tenantA, key, 'application/pdf');
    const token = url.split('/storage/local/')[1]!;

    expect(() => verifyLocalToken(token, 'a-different-secret')).toThrow();
    const payload = verifyLocalToken(token, localSigningSecret(read));
    expect(payload.m).toBe('put');
  });

  it("refuses to sign or delete another tenant's key", async () => {
    const other = storage.buildKey(tenantB, 'documents', 'secret.pdf');
    await expect(storage.getUploadUrl(tenantA, other, 'application/pdf')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(storage.getDownloadUrl(tenantA, other)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(storage.delete(tenantA, other)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
