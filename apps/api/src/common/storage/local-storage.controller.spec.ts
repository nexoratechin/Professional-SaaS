import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppConfigService } from '../../config/app-config.service';
import { LocalStorageController } from './local-storage.controller';
import { localSigningSecret, signLocalToken } from './local-storage';

/**
 * Exercises the real HTTP transfer path for the local driver: a signed PUT URL streams bytes to
 * disk and a signed GET URL streams them back with the security headers intact. Runs without any
 * external service (no PostgreSQL/Redis/S3) because the endpoint only touches the filesystem.
 */
describe('LocalStorageController (HTTP transfer)', () => {
  const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const key = `tenants/${tenant}/documents/sample.bin`;
  const values: Record<string, unknown> = {
    STORAGE_DRIVER: 'local',
    STORAGE_LOCAL_DIR: '',
    S3_BUCKET: 'test-bucket',
    PORT: 3000,
    JWT_PRIVATE_KEY: 'test-jwt-key',
  };
  const read = (k: string) => values[k];
  const secret = localSigningSecret(read);
  let app: INestApplication;
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'college-erp-local-http-'));
    values.STORAGE_LOCAL_DIR = dir;
    const moduleRef = await Test.createTestingModule({
      controllers: [LocalStorageController],
      providers: [{ provide: AppConfigService, useValue: { get: read } }],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('uploads via a signed PUT then serves the bytes back via a signed GET', async () => {
    const putToken = signLocalToken(
      { k: key, m: 'put', ct: 'application/octet-stream', e: Math.floor(Date.now() / 1000) + 300 },
      secret,
    );
    const payload = Buffer.from('binary-document-bytes');

    await request(app.getHttpServer())
      .put(`/storage/local/${putToken}`)
      .set('Content-Type', 'application/octet-stream')
      .send(payload)
      .expect(200);

    const getToken = signLocalToken(
      {
        k: key,
        m: 'get',
        ct: 'application/octet-stream',
        cd: 'attachment; filename="sample.bin"',
        e: Math.floor(Date.now() / 1000) + 300,
      },
      secret,
    );

    const response = await request(app.getHttpServer())
      .get(`/storage/local/${getToken}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(response.headers['content-disposition']).toContain('attachment');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect((response.body as Buffer).equals(payload)).toBe(true);
  });

  it('rejects an unsigned / tampered token', async () => {
    await request(app.getHttpServer()).get('/storage/local/not-a-real-token').expect(400);
  });

  it('404s a valid token for a missing object', async () => {
    const token = signLocalToken(
      { k: `tenants/${tenant}/documents/missing.bin`, m: 'get', e: Math.floor(Date.now() / 1000) + 300 },
      secret,
    );
    await request(app.getHttpServer()).get(`/storage/local/${token}`).expect(404);
  });
});
