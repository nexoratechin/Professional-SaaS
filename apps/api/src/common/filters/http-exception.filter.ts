import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { TenantIsolationViolationError } from '@college-erp/database';

/** Normalizes all thrown errors to a consistent JSON shape and turns an unexpected
 * TenantIsolationViolationError into a 403 rather than leaking a 500 with a stack trace. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      response.status(status).json({ statusCode: status, message: exception.getResponse() });
      return;
    }

    if (exception instanceof TenantIsolationViolationError) {
      this.logger.warn(exception.message);
      response.status(HttpStatus.FORBIDDEN).json({
        statusCode: HttpStatus.FORBIDDEN,
        message: 'Cross-tenant access is not permitted.',
      });
      return;
    }

    this.logger.error(exception instanceof Error ? exception.stack : exception);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    });
  }
}
