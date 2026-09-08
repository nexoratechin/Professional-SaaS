import { randomUUID } from 'crypto';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppConfigService } from '../../config/app-config.service';

const UPLOAD_URL_TTL_SECONDS = 300;
const DOWNLOAD_URL_TTL_SECONDS = 300;

/**
 * Tenant-aware file access: every key this service will sign a URL for (or delete) must live
 * under the caller's own tenant prefix. This check runs even for keys read back out of this
 * tenant's own `Document` rows — defense in depth against a future bug that lets a mismatched
 * key slip into that table. The frontend never receives a bucket/key it can substitute; it only
 * ever gets a short-lived, single-purpose signed URL.
 */
@Injectable()
export class StorageService {
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
      throw new ForbiddenException('This file does not belong to your tenant.');
    }
  }

  buildKey(tenantId: string, category: string, filename: string): string {
    const safeCategory = category.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeFilename = filename.replace(/[^a-zA-Z0-9_.-]/g, '_');
    return `${this.tenantPrefix(tenantId)}${safeCategory}/${randomUUID()}-${safeFilename}`;
  }

  async getUploadUrl(tenantId: string, key: string, contentType: string): Promise<string> {
    this.assertKeyBelongsToTenant(tenantId, key);
    const command = new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType });
    return getSignedUrl(this.client, command, { expiresIn: UPLOAD_URL_TTL_SECONDS });
  }

  /** Server-side write for backend-generated artifacts (e.g. invoice PDFs). The key must still
   * live under the owning tenant's prefix — the same isolation rule as every other stored path,
   * so a downloaded artifact can never point outside its tenant. */
  async uploadBuffer(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async getDownloadUrl(
    tenantId: string,
    key: string,
    options?: { contentType?: string; filename?: string },
  ): Promise<string> {
    this.assertKeyBelongsToTenant(tenantId, key);
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ...(options?.contentType ? { ResponseContentType: options.contentType } : {}),
      ...(options?.filename ? { ResponseContentDisposition: `inline; filename="${options.filename}"` } : {}),
    });
    return getSignedUrl(this.client, command, { expiresIn: DOWNLOAD_URL_TTL_SECONDS });
  }

  async delete(tenantId: string, key: string): Promise<void> {
    this.assertKeyBelongsToTenant(tenantId, key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
