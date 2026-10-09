import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Inject, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { TenantIsolationViolationError } from '@college-erp/database';
import { bumpWindow, recordHttpError, recordHttpRequest, routePathOf, WINDOW_COUNTERS } from '@college-erp/observability';
import type Redis from 'ioredis';
import { getCurrentRequestId } from '../context/request-context';
import { ErrorTrackerService } from '../observability/error-tracker.service';
import { OBSERVABILITY_RECORDED } from '../interceptors/api-logging.interceptor';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { buildErrorEnvelope } from './error-response.util';

/**
 * Normalizes EVERY thrown error to the platform's consistent error envelope (see
 * error-response.util.ts): a flat `{ statusCode, error, code, message, details?, requestId,
 * path, method, timestamp }` body on every failure, so clients can branch on `code`, correlate
 * with `requestId`, and render field errors from `details`.
 *
 * Registered via APP_FILTER in AppModule (not main.ts) so the same envelope applies in tests and
 * at bootstrap. Deliberately a catch-all, and deliberately opaque: unknown errors become a
 * generic 500 — no stack traces or internal details are ever sent to the client (they go to the
 * log, tagged with the requestId).
 *
 * Observability role: failures that never reached the logging interceptor (guard/middleware
 * rejections) are counted here, and every 5xx is reported to the error tracker exactly once.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  constructor(
    private readonly errorTracker: ErrorTrackerService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = getCurrentRequestId();
    const context = {
      requestId,
      path: request.originalUrl ?? request.url,
      method: request.method,
    };

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      this.log(status, exception);
      if (status >= 500) {
        this.trackServerError(exception, request, status, requestId);
      }
      this.recordFallbackMetrics(request, response, status);
      response.status(status).json(
        buildErrorEnvelope(status, typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : payload, context),
      );
      return;
    }

    if (exception instanceof TenantIsolationViolationError) {
      this.logger.warn(
        `[${requestId ?? '-'}] Cross-tenant isolation violation: ${exception.message} (${request.method} ${request.originalUrl ?? request.url})`,
      );
      this.recordFallbackMetrics(request, response, HttpStatus.FORBIDDEN);
      response.status(HttpStatus.FORBIDDEN).json(
        buildErrorEnvelope(HttpStatus.FORBIDDEN, 'Cross-tenant access is not permitted.', context),
      );
      return;
    }

    const stack = exception instanceof Error ? exception.stack : String(exception);
    this.logger.error(
      `[${requestId ?? '-'}] ${request.method} ${request.originalUrl ?? request.url} — unhandled error`,
      stack,
    );
    this.trackServerError(exception, request, HttpStatus.INTERNAL_SERVER_ERROR, requestId);
    this.recordFallbackMetrics(request, response, HttpStatus.INTERNAL_SERVER_ERROR);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json(
      buildErrorEnvelope(HttpStatus.INTERNAL_SERVER_ERROR, 'Internal server error', context),
    );
  }

  /** Reports 5xx failures to the error tracker with routing + identity context. */
  private trackServerError(exception: unknown, request: Request, status: number, requestId?: string): void {
    const tenant = (request as { resolvedTenant?: { id?: string; slug?: string } }).resolvedTenant;
    const user = request.user as { id?: string } | undefined;
    this.errorTracker.capture(exception, {
      source: 'api',
      route: routePathOf(request),
      method: request.method,
      path: request.originalUrl ?? request.url,
      statusCode: status,
      ...(requestId ? { requestId } : {}),
      ...(tenant?.id ? { tenantId: tenant.id } : {}),
      ...(user?.id ? { userId: user.id } : {}),
    });
  }

  /** Counts HTTP metrics for rejections the interceptor never saw (guards, middleware). */
  private recordFallbackMetrics(request: Request, response: Response, status: number): void {
    const recorded = (response as Response & Record<symbol, boolean | undefined>)[OBSERVABILITY_RECORDED];
    if (recorded) return;
    const route = routePathOf(request);
    recordHttpRequest({ method: request.method, route, status, durationMs: 0 });
    recordHttpError(status, route);
    void bumpWindow(this.redis, WINDOW_COUNTERS.httpRequests).catch(() => undefined);
    if (status >= 500) {
      void bumpWindow(this.redis, WINDOW_COUNTERS.http5xx).catch(() => undefined);
    }
  }

  private log(status: number, exception: HttpException): void {
    const requestId = getCurrentRequestId();
    const message = exception.message;
    if (status >= 500) {
      this.logger.error(`[${requestId ?? '-'}] ${status} ${message}`, exception.stack);
    } else if (status >= 400) {
      this.logger.warn(`[${requestId ?? '-'}] ${status} ${message}`);
    } else {
      this.logger.debug(`[${requestId ?? '-'}] ${status} ${message}`);
    }
  }
}
