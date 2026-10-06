/**
 * `webhook` — the inbound-only adapter.
 *
 * Some connections have no outbound surface at all: a WhatsApp Business API account that only ever
 * calls us about delivery receipts, an identity provider that pushes SCIM lifecycle events, a bank
 * that notifies settled payments. Modelling those with `http_json` would force an operator to
 * invent a fake `baseUrl` just to satisfy validation.
 *
 * So this adapter deliberately implements **only** `ConnectionTester`, and its "test" validates the
 * inbound side instead of making an outbound call: it confirms the integration is ACTIVE and that at
 * least one enabled webhook endpoint exists to receive events. Reporting "configured, N endpoints"
 * is the honest answer for a receive-only integration — it does not pretend to have verified
 * connectivity it never attempts.
 *
 * It implements no `execute` beyond throwing a permanent CONFIGURATION error, so a caller that
 * mistakenly dispatches an outbound operation gets a precise message instead of a TypeError.
 */

import { IntegrationAdapterError } from '../types';
import { configString, type ConnectionTester, type IntegrationAdapter, type IntegrationAdapterContext, type IntegrationAdapterResult, type IntegrationTestResult } from '../types';

export class WebhookOnlyAdapter implements IntegrationAdapter, ConnectionTester {
  readonly name = 'webhook';

  async execute(_operation: string, _payload: unknown, _ctx: IntegrationAdapterContext): Promise<IntegrationAdapterResult> {
    throw new IntegrationAdapterError(
      'This integration is inbound-only ("webhook" provider) and cannot make outbound calls. ' +
        'Change its provider to one that supports OUTBOUND_CALL if you need to send requests.',
      { category: 'CONFIGURATION', retryable: false },
    );
  }

  /**
   * Inbound-side readiness check. `endpoints` is supplied by the caller (the API/worker knows how
   * many enabled endpoints exist); the adapter itself has no database access.
   */
  async testConnection(ctx: IntegrationAdapterContext): Promise<IntegrationTestResult> {
    const startedAt = Date.now();
    const endpointCount = Number(ctx.config.endpointCount ?? 0);

    if (!Number.isFinite(endpointCount) || endpointCount <= 0) {
      return {
        ok: false,
        message:
          'No webhook endpoint is registered for this integration. Create one and give it to your ' +
          'provider — an inbound-only integration with no endpoint will never receive anything.',
        latencyMs: Date.now() - startedAt,
        status: null,
      };
    }

    const path = configString(ctx.config, 'testPath', '');
    return {
      ok: true,
      message:
        `Configured for inbound delivery — ${endpointCount} active webhook endpoint(s)` +
        (path ? `. Expected at ${path}.` : '. Test deliveries cannot be simulated; verify with a real provider event.'),
      latencyMs: Date.now() - startedAt,
      status: null,
      responseExcerpt: { endpointCount },
    };
  }
}
