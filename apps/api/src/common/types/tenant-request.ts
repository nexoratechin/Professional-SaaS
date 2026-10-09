import type { Request } from 'express';

export interface ResolvedTenant {
  id: string;
  slug: string;
  status: 'TRIAL' | 'ACTIVE' | 'SUSPENDED' | 'CANCELED';
  /** Physical isolation mode — drives routing to a dedicated store; defaults to SHARED. */
  dataIsolationMode: 'SHARED' | 'DEDICATED_SCHEMA' | 'DEDICATED_DATABASE';
}

export interface AuditContext {
  entityId?: string;
  before?: unknown;
  after?: unknown;
}

export interface RequestWithTenant extends Request {
  resolvedTenant?: ResolvedTenant;
  auditContext?: AuditContext;
  /** Set by RequestIdMiddleware before anything else runs — see also getCurrentRequestId(). */
  requestId?: string;
}
