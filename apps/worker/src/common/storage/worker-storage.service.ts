import { Injectable } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { AppConfigService } from '../../config/app-config.service';

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
 */
@Injectable()
export class WorkerStorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: AppConfigService) {
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

  /** Writes a backend-generated artifact (report export) under the tenant prefix. */
  async uploadBuffer(tenantId: string, key: string, body: Buffer, contentType: string): Promise<void> {
    this.assertKeyBelongsToTenant(tenantId, key);
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  /** Removes an object. Missing objects are NOT an error (already-deleted/quarantined files are
   *  naturally idempotent across retries). */
  async deleteObject(tenantId: string, key: string): Promise<void> {

    this.assertKeyBelongsToTenant(tenantId, key);
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch {
      // Ignore 404-style failures — nothing to delete is a successful delete.
    }
  }

  /** Streams the object's bytes — used by scanners that must inspect the payload (mock, clamav,
   *  http). Throws when the object does not exist. */
  async streamObject(tenantId: string, key: string): Promise<AsyncIterable<Uint8Array>> {
    this.assertKeyBelongsToTenant(tenantId, key);
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!result.Body) {
      throw new Error(`Object ${key} has no body.`);
    }
    return result.Body as unknown as AsyncIterable<Uint8Array>;
  }

  async objectExists(tenantId: string, key: string): Promise<boolean> {
    this.assertKeyBelongsToTenant(tenantId, key);
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async getObjectMetadata(tenantId: string, key: string): Promise<WorkerObjectMetadata> {
    this.assertKeyBelongsToTenant(tenantId, key);
    const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
    return {
      sizeBytes: result.ContentLength ?? 0,
      contentType: result.ContentType ?? null,
      etag: result.ETag ?? null,
      lastModified: result.LastModified ?? null,
    };
  }
}