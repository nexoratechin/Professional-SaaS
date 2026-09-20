import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { AuditService } from '../../modules/audit/audit.service';
import { AUDIT_ACTION_KEY } from '../decorators/audit.decorator';
import type { RequestWithTenant } from '../types/tenant-request';

interface AuditMetadata {
  action: string;
  entityType: string;
  module: string;
}

const PLATFORM_ROLES = new Set(['PLATFORM_ADMIN', 'PLATFORM_SUPPORT']);

/** Automatic post-response audit logging for routes decorated with @Audit(). Reads the entity
 * id / before-after diff from req.auditContext if the handling service populated it. For
 * mutations that must be atomic with the audit write, call AuditService.record() explicitly in
 * the service instead — this interceptor only covers the common CRUD case. */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const metadata = this.reflector.getAllAndOverride<AuditMetadata | undefined>(AUDIT_ACTION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!metadata) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<RequestWithTenant>();

    return next.handle().pipe(
      tap(() => {
        const isPlatformActor = !!request.user?.role && PLATFORM_ROLES.has(request.user.role);
        void this.auditService.record({
          scope: request.resolvedTenant ? 'TENANT' : 'PLATFORM',
          tenantId: request.resolvedTenant?.id ?? null,
          actorType: isPlatformActor ? 'PLATFORM_USER' : 'USER',
          actorUserId: isPlatformActor ? undefined : request.user?.id,
          actorPlatformUserId: isPlatformActor ? request.user?.id : undefined,
          action: metadata.action,
          module: metadata.module,
          entityType: metadata.entityType,
          entityId: request.auditContext?.entityId,
          before: request.auditContext?.before,
          after: request.auditContext?.after,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        });
      }),
    );
  }
}
