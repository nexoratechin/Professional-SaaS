/**
 * Normalized tracked-error event — the contract between the ErrorTracker core and its sinks.
 * The apps add sinks for persistence (SystemErrorEvent) and webhook fan-out; the package itself
 * only ships a log sink, keeping it free of database/HTTP dependencies.
 */
export interface TrackedErrorEvent {
  /** Stable hash grouping occurrences of the same bug. */
  fingerprint: string;
  name: string;
  message: string;
  stack?: string;
  /** `api` | `worker` | any custom label. */
  source: string;
  level: 'error' | 'warn';
  timestamp: string;
  route?: string;
  method?: string;
  path?: string;
  requestId?: string;
  tenantId?: string;
  userId?: string;
  statusCode?: number;
  jobId?: string;
  queue?: string;
  context?: Record<string, unknown>;
}
