import { SetMetadata } from '@nestjs/common';

export const AUDIT_ACTION_KEY = 'college_erp:audit_action';

/**
 * Marks a route for automatic post-response audit logging by AuditInterceptor. Covers the
 * common "CRUD on a sensitive entity" case with no per-service boilerplate; the entity id and
 * before/after diff (if any) come from `req.auditContext`, optionally set by the handling
 * service via AuditContextService. For mutations that must be atomic with the audit write
 * (role/permission changes, tenant provisioning, cross-tenant rejections), call
 * AuditService.record() explicitly inside the same transaction instead.
 */
export const Audit = (action: string, entityType: string) => SetMetadata(AUDIT_ACTION_KEY, { action, entityType });
