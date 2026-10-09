import { getLogger } from '../logging/logger';
import type { TrackedErrorEvent } from './types';
import type { ErrorSink } from './error-tracker';

/** Always-on sink: the tracked event is already logged by ErrorTracker, this is a no-op marker
 * used when callers want an explicit sink list. Kept for API symmetry. */
export function createNoopSink(): ErrorSink {
  return () => undefined;
}

/**
 * Ship errors to an external tracker over HTTP. Works with any endpoint accepting a JSON body —
 * including a Slack incoming webhook (the `text` field), a custom collector, or an alert relay.
 * Deliberately fire-and-forget with a timeout: tracking must never slow down or break the caller.
 */
export function createWebhookSink(options: { url: string; timeoutMs?: number }): ErrorSink {
  const timeoutMs = options.timeoutMs ?? 5_000;
  return (event: TrackedErrorEvent) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    void fetch(options.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: `[${event.source}] ${event.name}: ${event.message}`,
        source: 'college-erp',
        event,
      }),
      signal: controller.signal,
    })
      .then(() => undefined)
      .catch((error: unknown) => {
        getLogger().emit('warn', 'Error tracker webhook delivery failed', {
          reason: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => clearTimeout(timer));
  };
}
