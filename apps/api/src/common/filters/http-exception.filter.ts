import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { TenantIsolationViolationError } from '@college-erp/database';
import { getCurrentRequestId } from '../context/request-context';
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
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

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
      response.status(status).json(
        buildErrorEnvelope(status, typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : payload, context),
      );
      return;
    }

    if (exception instanceof TenantIsolationViolationError) {
      this.logger.warn(
        `[${requestId ?? '-'}] Cross-tenant isolation violation: ${exception.message} (${request.method} ${request.originalUrl ?? request.url})`,
      );
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
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json(
      buildErrorEnvelope(HttpStatus.INTERNAL_SERVER_ERROR, 'Internal server error', context),
    );
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