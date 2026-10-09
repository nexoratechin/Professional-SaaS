import { CallHandler, ExecutionContext, Inject, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import {
  bumpWindow,
  recordHttpError,
  recordHttpRequest,
  recordTenantRequest,
  routePathOf,
  WINDOW_COUNTERS,
} from '@college-erp/observability';
import type Redis from 'ioredis';
import { AppConfigService } from '../../config/app-config.service';
import { REDIS_CLIENT } from '../redis/redis.constants';
import type { RequestWithTenant } from '../types/tenant-request';

const SKIP_PATHS = ['/health', '/metrics', '/api/docs', '/favicon.ico'];

/** Marks responses the interceptor is already accounting for, so the exception filter's fallback
 *  (guard/middleware failures that never reach an interceptor) does not double-count. */
export const OBSERVABILITY_RECORDED = Symbol('observability.recorded');

interface LogFields {
  requestId?: string;
  tenantId?: string;
  tenantSlug?: string;
  userId?: string;
}

/** Structured request/response logging for the whole HTTP surface (registered as a global
 *  APP_INTERCEPTOR): every request is logged exactly once with method, path, status, latency,
 *  requestId (the same X-Request-Id echoed on the response), the resolved tenant and acting user
 *  (when auth has run), plus the client IP. 4xx → warn, 5xx → error, everything else → debug.
 *  /health, /metrics and the Swagger UI are skipped to keep the noise floor low.
 *
 *  It is also the HTTP metrics choke point: every accounted request feeds the latency histogram,
 *  the request/error counters and the Redis window buckets the alert engine reads. Failures that
 *  never reach an interceptor (guards, middleware) are counted by HttpExceptionFilter instead. */
@Injectable()
export class ApiLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('API');
  private readonly includeTenantLabels: boolean;

  constructor(
    private readonly config: AppConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.includeTenantLabels = config.get('METRICS_INCLUDE_TENANT_LABELS');
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<RequestWithTenant>();
    const response = http.getResponse<Response>();

    const url = request.originalUrl ?? request.url;
    if (SKIP_PATHS.some((path) => path === url || url.startsWith(`${path}/`))) {
      return next.handle();
    }

    // Tell the exception filter this request's HTTP metrics are handled here.
    (response as Response & Record<symbol, boolean>)[OBSERVABILITY_RECORDED] = true;

    const startedAt = process.hrtime.bigint();
    const fields: LogFields = {
      requestId: request.requestId ?? request.header('x-request-id'),
      tenantId: request.resolvedTenant?.id,
      tenantSlug: request.resolvedTenant?.slug,
      userId: (request.user as { id?: string } | undefined)?.id,
    };

    return next.handle().pipe(
      tap({
        next: () => {
          this.recordMetrics(request, response.statusCode, startedAt);
          this.log(request, response.statusCode, fields, startedAt, url);
        },
        error: (err: unknown) => {
          const status =
            typeof err === 'object' && err !== null && 'getStatus' in err
              ? Number((err as { getStatus(): number }).getStatus())
              : 500;
          this.recordMetrics(request, status, startedAt);
          // Errors still propagate to the global filter; only the log level differs here.
          if (status >= 500) {
            this.logger.error(this.format(request, status, fields, startedAt, url));
          } else {
            this.log(request, status, fields, startedAt, url);
          }
        },
      }),
    );
  }

  private recordMetrics(request: RequestWithTenant, status: number, startedAt: bigint): void {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const route = routePathOf(request);
    recordHttpRequest({ method: request.method, route, status, durationMs });
    if (status >= 400) {
      recordHttpError(status, route);
    }
    if (this.includeTenantLabels && request.resolvedTenant?.slug) {
      recordTenantRequest(request.resolvedTenant.slug);
    }

    // Fire-and-forget Redis window bumps — never let metrics add latency to the response path.
    void bumpWindow(this.redis, WINDOW_COUNTERS.httpRequests).catch(() => undefined);
    if (status >= 500) {
      void bumpWindow(this.redis, WINDOW_COUNTERS.http5xx).catch(() => undefined);
    }
  }

  private log(
    request: Request,
    status: number,
    fields: LogFields,
    startedAt: bigint,
    url: string,
  ): void {
    const message = this.format(request, status, fields, startedAt, url);
    if (status >= 500) {
      this.logger.error(message);
    } else if (status >= 400) {
      this.logger.warn(message);
    } else {
      this.logger.debug(message);
    }
  }

  private format(request: Request, status: number, fields: LogFields, startedAt: bigint, url: string): string {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const parts = [
      `${request.method} ${url}`,
      `status=${status}`,
      `duration=${durationMs.toFixed(2)}ms`,
      `ip=${request.ip ?? '-'}`,
    ];
    if (fields.requestId) parts.push(`requestId=${fields.requestId}`);
    if (fields.tenantId) parts.push(`tenant=${fields.tenantSlug ?? fields.tenantId}`);
    if (fields.userId) parts.push(`userId=${fields.userId}`);
    return parts.join(' ');
  }
}
