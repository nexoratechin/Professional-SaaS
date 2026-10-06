import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import Redis from 'ioredis';
import { from, Observable } from 'rxjs';
import { mergeMap, tap } from 'rxjs/operators';
import { AppConfigService } from '../../config/app-config.service';
import { REDIS_CLIENT } from '../redis/redis.constants';
import {
  buildIdempotencyKey,
  IDEMPOTENCY_HEADER,
  IDEMPOTENCY_INFLIGHT_TTL_SECONDS,
  IDEMPOTENCY_REPLAYED_HEADER,
  isIdempotencyCandidate,
} from './idempotency.util';

interface CachedIdempotencyResponse {
  status: number;
  body: unknown;
}

const INFLIGHT = 'inflight';

/**
 * Redis-backed Idempotency-Key support, registered as a global APP_INTERCEPTOR. Activates only
 * for mutating requests that carry an `Idempotency-Key` header (see idempotency.util.ts):
 *
 *  1. If the key was already resolved, the ORIGINAL response (status + JSON body) is replayed
 *     verbatim with `Idempotency-Replayed: true` and the handler is never invoked.
 *  2. Otherwise the key is claimed atomically (SET NX) so concurrent duplicates get a 409 rather
 *     than double-executing a payment/creation; the claim is released on any error so a corrected
 *     retry with the same key runs again.
 *  3. Successful 2xx JSON responses are cached for IDEMPOTENCY_TTL_SECONDS (default 24h).
 *
 * Degrades to a no-op when Redis is unavailable (logs a warning, passes the request through) so
 * a Redis blip never 500s the whole API. Non-JSON bodies (StreamableFile/Buffer) and 204s are
 * not cached.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: AppConfigService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    if (!isIdempotencyCandidate(request)) {
      return next.handle();
    }

    const keyHeader = request.header(IDEMPOTENCY_HEADER) as string;
    const cacheKey = buildIdempotencyKey(request, keyHeader);
    const ttlSeconds = this.config.get('IDEMPOTENCY_TTL_SECONDS');

    return from(this.readCached(cacheKey)).pipe(
      mergeMap((cached) => {
        if (cached) {
          response.status(cached.status);
          response.setHeader(IDEMPOTENCY_REPLAYED_HEADER, 'true');
          return from(Promise.resolve(cached.body));
        }

        // Claim the key so a concurrent duplicate can't run the same mutation twice.
        return from(this.claim(cacheKey)).pipe(
          mergeMap((claimed) => {
            if (!claimed) {
              throw new ConflictException(
                `A request with this ${IDEMPOTENCY_HEADER} is already in progress.`,
              );
            }

            response.setHeader(IDEMPOTENCY_HEADER, keyHeader);

            return next.handle().pipe(
              tap({
                next: (data: unknown) => {
                  void this.commit(cacheKey, response.statusCode, data, ttlSeconds);
                },
                error: () => {
                  void this.release(cacheKey);
                },
              }),
            );
          }),
        );
      }),
    );
  }

  private async readCached(key: string): Promise<CachedIdempotencyResponse | null> {
    try {
      const raw = await this.redis.get(key);
      if (!raw || raw === INFLIGHT) return null;
      return JSON.parse(raw) as CachedIdempotencyResponse;
    } catch (error) {
      this.degraded(error);
      return null;
    }
  }

  private async claim(key: string): Promise<boolean> {
    try {
      const result = await this.redis.set(key, INFLIGHT, 'EX', IDEMPOTENCY_INFLIGHT_TTL_SECONDS, 'NX');
      return result === 'OK';
    } catch (error) {
      this.degraded(error);
      // Redis down → let the request through rather than failing the mutation.
      return true;
    }
  }

  private async commit(key: string, status: number, data: unknown, ttlSeconds: number): Promise<void> {
    if (status < 200 || status >= 300) {
      await this.release(key);
      return;
    }
    if (data === undefined || data === null) {
      // No body to replay (e.g. 204) — the action already happened; nothing safe to cache.
      await this.release(key);
      return;
    }
    if (Buffer.isBuffer(data) || data instanceof StreamableFile || typeof data === 'string') {
      await this.release(key);
      return;
    }
    try {
      JSON.stringify(data); // throws for BigInt / circular structures
    } catch {
      await this.release(key);
      return;
    }
    try {
      await this.redis.set(key, JSON.stringify({ status, body: data }), 'EX', ttlSeconds);
    } catch (error) {
      this.degraded(error);
    }
  }

  private async release(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (error) {
      this.degraded(error);
    }
  }

  private degraded(error: unknown): void {
    const first = error instanceof Error ? error.message : 'Redis error';
    this.logger.warn(`Idempotency skipped (Redis unavailable): ${first}`);
  }
}