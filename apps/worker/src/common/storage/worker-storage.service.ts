import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { bumpWindow, recordStorageOperation, WINDOW_COUNTERS } from '@college-erp/observability';
import type Redis from 'ioredis';
import { AppConfigService } from '../../config/app-config.service';
import { WORKER_REDIS_CLIENT } from '../observability/redis.constants';

/** Server-side HEAD of a stored object (see WorkerStorageService.getObjectMetadata). */
export interface WorkerObjectMetadata {
  sizeBytes: number;
  contentType: string | null;
  etag: string | null;
  lastModified: Date | null;
}

/**
 * Minimal object-storage client for the worker's document processors (virus-scan deletes
 * infected payloads; the retention sweep deletes expired payloads). Same tenant-prefix rule as
 * the API's StorageService: every key this service touches must live under the owning tenant's
 * prefix — cheap defense in depth against a future bug letting a mismatched key slip through.
 *
 * Every S3 round-trip is timed into the metrics registry and failures bump the cross-process
 * storage_failures alert window (a 404 on the explicit existence check is an answer, not a
 * failure). Redis is optional so processors that construct the service outside DI keep working.
 */
@Injectable()
export class WorkerStorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(
    private readonly config: AppConfigService,
    @Optional() @Inject(WORKER_REDIS_CLIENT) private readonly redis?: Redis,
  ) {
    this.bucket = config.get('S3_BUCKET');
    this.client = new S3Client({
      endpoint: config.get('S3_ENDPOINT'),
      region: config.get('S3_REGION'),
      forcePathStyle: config.get('S3_FORCE_PATH_STYLE'),
      credentials: {
        accessKeyId: config.get('S3_ACCESS_KEY'),
        secretAccessKey: config.get('S3_SECRET_KEY'),
      },
    });
  }

  tenantPrefix(tenantId: string): string {
    return `tenants/${tenantId}/`;
  }

  assertKeyBelongsToTenant(tenantId: string, key: string): void {
    if (!key.startsWith(this.tenantPrefix(tenantId))) {
      throw new Error(`Object key does not belong to tenant ${tenantId}.`);
    }
  }

  // ── System objects (backups and other platform maintenance artifacts) ──────────────────────
  // The tenant namespace is `tenants/<id>/`; system objects live everywhere else (by convention
  // under the configured backup prefix). The two guards are disjoint, so a backup key can never be
  // read through a tenant method and a tenant object can never be deleted through a system method.

  private assertSystemKey(key: string): void {
    if (key.startsWith('tenants/')) {
      throw new Error('System object keys must not use the tenant namespace (tenants/<tenantId>/).');
    }
  }

  /** Streams a system object to storage from a local file (backup archives are multi-GB). */
  async uploadSystemFile(key: string, filePath: string, contentType: string): Promise<void> {
    this.assertSystemKey(key);
    const fileStat = await stat(filePath);
    await this.send('putSystemObject', () =>
      this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: createReadStream(filePath),
          ContentLength: fileStat.size,
          ContentType: contentType,
        }),
      ),
    );
  }

  async uploadSystemBuffer(key: string, body: Buffer, contentType: string): Promise<void> {
    this.assertSystemKey(key);
    await this.send('putSystemObject', () =>
      this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType })),
    );
  }

  /** Streams a system object back to a local file (restore-verification downloads). */
  async downloadSystemToFile(key: string, filePath: string): Promise<void> {
    this.assertSystemKey(key);
    const result = await this.send('getSystemObject', () =>
      this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key })),
    );
    if (!result.Body) throw new Error(`System object ${key} has no body.`);
    await pipeline(result.Body as Readable, createWriteStream(filePath));
  }

  async deleteSystemObject(key: string): Promise<void> {
    this.assertSystemKey(key);
    try {
      await this.send('deleteSystemObject', () =>
        this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })),
      );
    } catch {
      // Missing objects are a successful delete.
    }
  }

  /** Lists every system object under a prefix (paginated; backs retention planning). */
  async listSystemObjects(
    prefix: string,
  ): Promise<Array<{ key: string; sizeBytes: number; lastModified: Date | null }>> {
    let continuationToken: string | undefined;
    const objects: Array<{ key: string; sizeBytes: number; lastModified: Date | null }> = [];
    do {
      const result = await this.send('listSystemObjects', async () => {
        // The SDK type for ContinuationToken is `string | undefined`; capture it for the loop.
        return this.client.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
          }),
        );
      });
      for (const item of result.Contents ?? []) {
        if (!item.Key) continue;
        objects.push({
          key: item.Key,
          sizeBytes: item.Size ?? 0,
          lastModified: item.LastModified ?? null,
        });
      }
      continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
    } while (continuationToken);
    return objects;
  }

  /** Readiness probe — verifies the configured bucket is reachable. */
  async checkConnectivity(): Promise<void> {
    await this.send('headBucket', () => this.client.send(new HeadBucketCommand({ Bucket: this.bucket })));
  }

  /** Writes a backend-generated artifact (report export) under the tenant prefix. */
  async uploadBuffer(tenantId: string, key: string, body: Buffer, contentType: string): Promise<void> {
    this.assertKeyBelongsToTenant(tenantId, key);
    await this.send('putObject', () =>
      this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType })),
    );
  }

  /** Removes an object. Missing objects are NOT an error (already-deleted/quarantined files are
   *  naturally idempotent across retries). */
  async deleteObject(tenantId: string, key: string): Promise<void> {
    this.assertKeyBelongsToTenant(tenantId, key);
    try {
      await this.send('deleteObject', () =>
        this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })),
      );
    } catch {
      // Ignore 404-style failures — nothing to delete is a successful delete.
    }
  }

  /** Reads the whole object into memory (uploaded import files are size-bounded). */
  async downloadBuffer(tenantId: string, key: string): Promise<Buffer> {
    this.assertKeyBelongsToTenant(tenantId, key);
    const result = await this.send('getObject', () =>
      this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key })),
    );
    const chunks: Uint8Array[] = [];
    if (result.Body) {
      for await (const chunk of result.Body as unknown as AsyncIterable<Uint8Array>) {
        chunks.push(chunk);
      }
    }
    return Buffer.concat(chunks);
  }

  /** Streams the object's bytes — used by scanners that must inspect the payload (mock, clamav,
   * http). Throws when the object does not exist. */
  async streamObject(tenantId: string, key: string): Promise<AsyncIterable<Uint8Array>> {
    this.assertKeyBelongsToTenant(tenantId, key);
    const result = await this.send('getObject', () =>
      this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key })),
    );
    if (!result.Body) {
      throw new Error(`Object ${key} has no body.`);
    }
    return result.Body as unknown as AsyncIterable<Uint8Array>;
  }

  async objectExists(tenantId: string, key: string): Promise<boolean> {
    this.assertKeyBelongsToTenant(tenantId, key);
    try {
      await this.send(
        'headObject',
        () => this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key })),
        { count404AsError: false },
      );
      return true;
    } catch {
      return false;
    }
  }

  async getObjectMetadata(tenantId: string, key: string): Promise<WorkerObjectMetadata> {
    this.assertKeyBelongsToTenant(tenantId, key);
    const result = await this.send('headObject', () =>
      this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key })),
    );
    return {
      sizeBytes: result.ContentLength ?? 0,
      contentType: result.ContentType ?? null,
      etag: result.ETag ?? null,
      lastModified: result.LastModified ?? null,
    };
  }

  /** Single choke point for S3 calls: timing + metrics + failure window (see class doc). */
  private async send<T>(
    operation: string,
    execute: () => Promise<T>,
    options: { count404AsError?: boolean } = { count404AsError: true },
  ): Promise<T> {
    const startedAt = process.hrtime.bigint();
    try {
      const result = await execute();
      recordStorageOperation(operation, true, elapsedMs(startedAt));
      return result;
    } catch (error) {
      const is404 = isNotFound(error);
      recordStorageOperation(operation, false, elapsedMs(startedAt));
      if (this.redis && (!is404 || options.count404AsError)) {
        void bumpWindow(this.redis, WINDOW_COUNTERS.storageFailures).catch(() => undefined);
      }
      throw error;
    }
  }
}

function elapsedMs(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1e6;
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return candidate.name === 'NotFound' || candidate.name === 'NoSuchKey' || candidate.$metadata?.httpStatusCode === 404;
}
