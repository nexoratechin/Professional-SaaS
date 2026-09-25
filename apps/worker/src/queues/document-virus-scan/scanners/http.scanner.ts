import { Logger } from '@nestjs/common';
import { WorkerStorageService } from '../../../common/storage/worker-storage.service';
import type { ScanResult, ScanTarget, VirusScanner } from './scanner.interface';

const HTTP_TIMEOUT_MS = 60_000;

/**
 * Generic file-scanning API adapter (VIRUS_SCAN_PROVIDER=http): streams the object's bytes to
 * `VIRUS_SCAN_API_URL` as a multipart form upload (field "file") with an optional `Authorization:
 * Bearer <VIRUS_SCAN_API_KEY>` header. The endpoint must return JSON `{ clean: boolean,
 * threatName?: string }` (HTTP 200). Any non-2xx status or unexpected body shape throws so the
 * processor marks the version ERROR and BullMQ retries.
 */
export class HttpScanner implements VirusScanner {
  private readonly logger = new Logger(HttpScanner.name);

  constructor(
    private readonly storage: WorkerStorageService,
    private readonly apiUrl: string,
    private readonly apiKey?: string,
  ) {}

  async scan(tenantId: string, target: ScanTarget): Promise<ScanResult> {
    const chunks: Buffer[] = [];
    const stream = await this.storage.streamObject(tenantId, target.storageKey);
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const fileBuffer = Buffer.concat(chunks);

    const boundary = `----college-erp-${Date.now()}`;
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="file"; filename="${target.originalFilename.replace(/"/g, '')}"\r\n` +
          `Content-Type: ${target.mimeType}\r\n\r\n`,
      ),
      fileBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: body as unknown as NonNullable<Parameters<typeof fetch>[1]>['body'],
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Scan API ${this.apiUrl} returned HTTP ${response.status}.`);
      }

      const json = (await response.json()) as { clean?: unknown; threatName?: unknown };
      if (typeof json.clean !== 'boolean') {
        throw new Error(`Scan API ${this.apiUrl} returned an unexpected body (expected { clean: boolean }).`);
      }

      return {
        clean: json.clean,
        threatName: typeof json.threatName === 'string' ? json.threatName : undefined,
        engine: 'http',
      };
    } finally {
      clearTimeout(timer);
    }
  }
}