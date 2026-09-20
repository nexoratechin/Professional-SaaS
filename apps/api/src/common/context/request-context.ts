import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContextStore {
  requestId: string;
}

/**
 * Carries the current request's correlation id to code that has no access to the Express
 * `Request` object — deep singleton services like AuditService, which are deliberately NOT
 * request-scoped (see PlatformPrismaService's doc comment on why the audit trail stays a plain
 * singleton). AsyncLocalStorage avoids the alternative of making AuditService request-scoped,
 * which would cascade request-scoping onto every one of the ~15 modules that inject it.
 * Populated once per request by RequestIdMiddleware, before anything else runs.
 */
export const requestContextStorage = new AsyncLocalStorage<RequestContextStore>();

export function getCurrentRequestId(): string | undefined {
  return requestContextStorage.getStore()?.requestId;
}
