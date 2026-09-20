import { randomUUID } from 'node:crypto';
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import { requestContextStorage } from '../context/request-context';
import type { RequestWithTenant } from '../types/tenant-request';

export const REQUEST_ID_HEADER = 'X-Request-Id';

/**
 * Assigns every inbound request a correlation id — reused from the client's own X-Request-Id
 * header when present (e.g. forwarded by a reverse proxy or support-ticket tooling), otherwise
 * generated fresh — and echoes it back on the response so a client can quote it in a support
 * ticket. Registered before every other middleware (see main.ts) so it's available for the
 * entire request lifecycle, including TenantResolutionMiddleware's own audit-relevant failures.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: RequestWithTenant, res: Response, next: NextFunction): void {
    const requestId = req.header(REQUEST_ID_HEADER) || randomUUID();
    req.requestId = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);
    requestContextStorage.run({ requestId }, next);
  }
}
