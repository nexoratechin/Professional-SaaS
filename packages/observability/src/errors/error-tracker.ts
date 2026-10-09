import { getLogger } from '../logging/logger';
import { recordErrorTracked } from '../metrics/instrumentation';
import { fingerprintError } from './fingerprint';
import type { TrackedErrorEvent } from './types';

/**
 * Error tracking core: turns unknown exceptions into normalized, fingerprinted events and fans them
 * out to sinks (structured log, optional webhook, optional DB persistence supplied by the apps).
 *
 * - Deduped: the same fingerprint within `dedupeMs` is counted (metric) but not re-sent to sinks,
 *   so a tight failure loop cannot flood a webhook or hammer the database.
 * - Never throws: an error tracker that breaks the request path is worse than no error tracker.
 * - Sinks run fire-and-forget with per-sink try/catch; slow sink implementations cannot add
 *   latency to the caller.
 */

export type ErrorSink = (event: TrackedErrorEvent) => void | Promise<void>;

export interface CaptureContext {
  source?: string;
  level?: 'error' | 'warn';
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

export interface ErrorTrackerOptions {
  source: string;
  enabled?: boolean;
  dedupeMs?: number;
  /** Max number of fingerprints remembered for dedupe (bounded memory). */
  maxFingerprints?: number;
}

const MAX_MESSAGE_CHARS = 2_000;
const MAX_STACK_CHARS = 16_000;

export class ErrorTracker {
  private readonly sinks: ErrorSink[] = [];
  private readonly lastCapturedAt = new Map<string, number>();
  private readonly enabled: boolean;
  private readonly dedupeMs: number;
  private readonly maxFingerprints: number;
  private readonly source: string;

  constructor(options: ErrorTrackerOptions) {
    this.source = options.source;
    this.enabled = options.enabled ?? true;
    this.dedupeMs = options.dedupeMs ?? 60_000;
    this.maxFingerprints = options.maxFingerprints ?? 1_000;
  }

  addSink(sink: ErrorSink): this {
    this.sinks.push(sink);
    return this;
  }

  /** Returns the tracked event when it was emitted, or null when disabled/deduped. */
  capture(error: unknown, captureContext: CaptureContext = {}): TrackedErrorEvent | null {
    if (!this.enabled) return null;
    try {
      const event = this.buildEvent(error, captureContext);
      const now = Date.now();
      const previous = this.lastCapturedAt.get(event.fingerprint);
      this.remember(event.fingerprint, now);

      recordErrorTracked(event.source, event.name);

      if (previous !== undefined && now - previous < this.dedupeMs) {
        return null; // suppressed duplicate
      }

      getLogger().emit(event.level, `Tracked error: ${event.name}: ${event.message}`, {
        fingerprint: event.fingerprint,
        source: event.source,
        ...(event.route ? { route: event.route } : {}),
        ...(event.method ? { method: event.method } : {}),
        ...(event.requestId ? { requestId: event.requestId } : {}),
        ...(event.tenantId ? { tenantId: event.tenantId } : {}),
        ...(event.jobId ? { jobId: event.jobId } : {}),
        ...(event.queue ? { queue: event.queue } : {}),
        ...(event.context ? { context: event.context } : {}),
        ...(event.stack ? { error: { name: event.name, message: event.message, stack: event.stack } } : {}),
      });

      for (const sink of this.sinks) {
        try {
          const result = sink(event);
          if (result && typeof (result as Promise<void>).catch === 'function') {
            (result as Promise<void>).catch(() => undefined);
          }
        } catch {
          // A broken sink must never break capturing.
        }
      }
      return event;
    } catch {
      return null;
    }
  }

  private buildEvent(error: unknown, captureContext: CaptureContext): TrackedErrorEvent {
    const { source: contextSource, level, context, ...rest } = captureContext;
    const isError = error instanceof Error;
    const name = isError ? error.name : typeof error;
    const message = truncate(isError ? error.message : String(error), MAX_MESSAGE_CHARS);
    const stack = isError && error.stack ? truncate(error.stack, MAX_STACK_CHARS) : undefined;

    const fingerprint = fingerprintError(error, [contextSource ?? this.source, rest.route ?? ''].join('|'));

    return {
      fingerprint,
      name,
      message,
      ...(stack ? { stack } : {}),
      source: contextSource ?? this.source,
      level: level ?? 'error',
      timestamp: new Date().toISOString(),
      ...rest,
      ...(context ? { context } : {}),
    };
  }

  private remember(fingerprint: string, at: number): void {
    if (this.lastCapturedAt.size >= this.maxFingerprints) {
      // Bounded memory: drop the oldest insertion (Map preserves insertion order).
      const oldest = this.lastCapturedAt.keys().next().value;
      if (oldest !== undefined) this.lastCapturedAt.delete(oldest);
    }
    this.lastCapturedAt.set(fingerprint, at);
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
