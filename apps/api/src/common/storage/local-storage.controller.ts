import { BadRequestException, Controller, Get, NotFoundException, Param, Put, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { AppConfigService } from '../../config/app-config.service';
import { LocalObjectStore, localSigningSecret, verifyLocalToken } from './local-storage';

/**
 * Transfer endpoint for the local storage driver (STORAGE_DRIVER=local). The API hands the browser
 * a signed, single-purpose, short-lived URL just as it would an S3 presigned URL; this controller
 * verifies that signature and moves the bytes to/from disk. It is intentionally unauthenticated in
 * the JWT sense — possession of a valid signed token IS the authorisation, exactly like presigning —
 * and it is excluded from tenant resolution (see AppModule.configure) because the token carries the
 * key rather than the request carrying a tenant.
 *
 * It is not registered at all when the S3 driver is active in the sense that it simply never gets a
 * request; the route only ever receives URLs this API minted.
 */
@ApiExcludeController()
@Controller('storage/local')
export class LocalStorageController {
  private readonly store: LocalObjectStore;
  private readonly secret: string;

  constructor(config: AppConfigService) {
    this.store = new LocalObjectStore(config.get('STORAGE_LOCAL_DIR'), config.get('S3_BUCKET'));
    this.secret = localSigningSecret((key) => (config as unknown as { get(k: string): unknown }).get(key));
  }

  @Put(':token')
  async put(@Param('token') token: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    const payload = this.verify(token, 'put');
    await this.store.ensureReady();
    const buffered = readBufferedBody(req);
    if (buffered) {
      await this.store.putBuffer(payload.k, buffered);
    } else {
      await this.store.putStream(payload.k, req as unknown as Readable);
    }
    res.status(200).send();
  }

  @Get(':token')
  async get(@Param('token') token: string, @Res() res: Response): Promise<void> {
    const payload = this.verify(token, 'get');
    if (!(await this.store.exists(payload.k))) {
      throw new NotFoundException('File not found.');
    }
    const meta = await this.store.metadata(payload.k);
    res.setHeader('Content-Type', payload.ct ?? 'application/octet-stream');
    res.setHeader('Content-Length', String(meta.sizeBytes));
    if (payload.cd) res.setHeader('Content-Disposition', payload.cd);
    // Never let the browser sniff a stored file into an active document.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Allow the SPA (a different origin in development) to embed stored images inline, exactly as
    // an S3/MinIO host would. Helmet's default same-origin policy would otherwise block <img>
    // loads of branding logos/photos from the API origin. Safe here: the URL is signed, single
    // purpose and short-lived.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    await pipeline(this.store.readStream(payload.k), res as unknown as NodeJS.WritableStream);
  }

  private verify(token: string, expected: 'put' | 'get') {
    let payload;
    try {
      payload = verifyLocalToken(token, this.secret);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Invalid storage token.');
    }
    if (payload.m !== expected) {
      throw new BadRequestException('Storage token method mismatch.');
    }
    return payload;
  }
}

/** Recovers an already-buffered body (a JSON/text parser consumed the stream) so both buffered and
 *  streaming uploads work through one endpoint. Binary content types are not touched by the global
 *  parsers and take the streaming path. */
function readBufferedBody(req: Request): Buffer | null {
  const candidate = req as Request & { rawBody?: Buffer; body?: unknown };
  if (Buffer.isBuffer(candidate.rawBody)) return candidate.rawBody;
  if (Buffer.isBuffer(candidate.body)) return candidate.body;
  if (typeof candidate.body === 'string') return Buffer.from(candidate.body);
  return null;
}
