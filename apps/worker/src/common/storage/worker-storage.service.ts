import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
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
