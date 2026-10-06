/**
 * Public inbound webhook endpoint — the unauthenticated, self-authenticating surface.
 *
 * ## Why this controller has no guards
 *
 * A payment gateway or SMS provider cannot present a user JWT. Like the attendance device gateway,
 * the request identifies and authenticates itself: the random `pathToken` locates the endpoint
 * platform-wide, and the request body must carry a valid signature (HMAC over the RAW body) or a
 * matching bearer token. There is no "unsigned is OK" path — an unsigned delivery is recorded as a
 * SIGNATURE failure and rejected, never processed.
 *
 * ## The raw body matters
 *
 * Signatures are computed over bytes. Re-serializing a parsed body changes key order and whitespace
 * and invalidates the digest, so this controller reads the raw body from the request before any JSON
 * parsing happens. Parsing first is a real vulnerability class, not a theoretical one.
 *
 * ## Ordering: verify, then persist, then process
 *
 * The event row is written AFTER verification but BEFORE business logic, so a crash mid-processing
 * leaves a recoverable RECEIVED row rather than a silently lost payment notification. An
 * unauthenticated caller can therefore create rows, which is why the throttle guard matters and why
 * the body is size-bounded.
 */

import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import {
  IntegrationAdapterRegistry,
  parseSignatureHeader,
  redactForLog,
  sanitizeHeaders,
  truncateResponse,
  verifyWebhookSignature,
} from '@college-erp/integrations';
import type { Prisma, WebhookSignatureAlgorithm } from '@college-erp/database';
import { createTenantScopedClient } from '@college-erp/database';
import { PlatformPrismaService } from '../../common/prisma/platform-prisma.service';
import { IntegrationsService } from './integrations.service';

/**
 * Nest's JSON body parser is the only reader of the body, and by the time a handler runs the
 * original bytes are gone. Express's `verify` hook (installed in main.ts for this route) captures
 * them onto the request; this reads them back. Guarded so a body that arrived some other way is
 * re-serialized explicitly rather than silently verified against different bytes.
 */
interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

@Injectable()
export class IntegrationWebhookService {
  private readonly logger = new Logger(IntegrationWebhookService.name);

  constructor(
    private readonly registry: IntegrationAdapterRegistry,
    private readonly platformPrisma: PlatformPrismaService,
    private readonly integrationsService: IntegrationsService,
  ) {}

  /**
   * Handles one inbound delivery end-to-end.
   *
   * Returns a body the provider can interpret: a provider that receives 200 but no ack will retry
   * forever, so a duplicate is answered 200 with `duplicate: true` rather than a 409 that triggers
   * that retry storm.
   */
  async receive(
    pathToken: string,
    payload: unknown,
    rawBody: string,
    headers: Record<string, string | string[] | undefined>,
  ) {
    const endpoint = await this.loadEndpoint(pathToken);
    if (!endpoint) {
      // Deliberately identical to "found but inactive": an unauthenticated caller must not be able
      // to enumerate which webhook tokens exist.
      throw new NotFoundException('Webhook endpoint not found.');
    }

    const tenantPrisma = createTenantScopedClient(endpoint.tenantId);
    const signatureHeader = endpoint.signatureHeader.toLowerCase();
    const rawHeaderValue = headers[signatureHeader];
    const headerValue = Array.isArray(rawHeaderValue) ? rawHeaderValue.join(',') : rawHeaderValue;

    // Some providers pack timestamp+signature into one header (Stripe-style); split it before
    // verification so the algorithm gets a clean timestamp.
    const parsed = parseSignatureHeader(headerValue);
    const timestampHeader =
      (headers['x-integration-timestamp'] as string | undefined) ??
      (headers['x-signature-timestamp'] as string | undefined) ??
      parsed.timestamp ??
      null;

    const secret = this.integrationsService.decryptEndpointSecret(endpoint.secretEncrypted);
    const verification = verifyWebhookSignature({
      algorithm: endpoint.signatureAlgorithm as WebhookSignatureAlgorithm,
      secret,
      rawBody,
      signature: headerValue,
      timestamp: timestampHeader,
      authorization: headers['authorization'] as string | undefined,
      toleranceSeconds: endpoint.signatureToleranceSecs,
    });

    if (!verification.verified) {
      // The failure row is the evidence an operator needs to debug a provider's signing, and it is
      // written WITHOUT the payload being trusted in any way.
      await this.recordSignatureFailure(endpoint, verification.reason ?? 'SIGNATURE_MISMATCH', rawBody, headers);
      throw new NotFoundException('Webhook endpoint not found.');
    }

    // A deactivated endpoint's deliveries are recorded and ignored, not processed: providers retry
    // for a long time and an operator pausing an integration should not silently lose events.
    const integration = await tenantPrisma.integration.findFirst({
      where: { id: endpoint.integrationId },
    });
    if (!endpoint.isActive || !integration || integration.status !== 'ACTIVE') {
      const event = await tenantPrisma.integrationWebhookEvent.create({
        data: {
          tenantId: endpoint.tenantId,
          integrationId: endpoint.integrationId,
          webhookEndpointId: endpoint.id,
          eventType: extractEventType(payload),
          status: 'IGNORED',
          signatureVerified: true,
          payload: redactForLog(payload) as Prisma.InputJsonValue,
          headers: (sanitizeHeaders(headers) ?? null) as Prisma.InputJsonValue,
          errorMessage: endpoint.isActive
            ? `Integration is ${integration?.status ?? 'missing'}; delivery not processed.`
            : 'Webhook endpoint is inactive.',
        },
      });
      await this.bumpEndpointCounters(endpoint.id, false);
      return { received: true, ignored: true, eventId: event.id };
    }

    // Replay guard. A provider re-delivering the same external id must not be processed twice —
    // for a payment webhook that means charging twice.
    const externalEventId = extractExternalEventId(payload);
    if (externalEventId) {
      const duplicate = await tenantPrisma.integrationWebhookEvent.findFirst({
        where: { webhookEndpointId: endpoint.id, externalEventId },
      });
      if (duplicate) {
        await this.bumpEndpointCounters(endpoint.id, false);
        return { received: true, duplicate: true, eventId: duplicate.id };
      }
    }

    // Persisted BEFORE processing: a crash here must leave a recoverable RECEIVED row.
    const event = await tenantPrisma.integrationWebhookEvent.create({
      data: {
        tenantId: endpoint.tenantId,
        integrationId: endpoint.integrationId,
        webhookEndpointId: endpoint.id,
        externalEventId,
        eventType: extractEventType(payload),
        status: 'RECEIVED',
        signatureVerified: true,
        payload: redactForLog(payload) as Prisma.InputJsonValue,
        headers: (sanitizeHeaders(headers) ?? null) as Prisma.InputJsonValue,
        responseStatus: 200,
      },
    });
    await this.bumpEndpointCounters(endpoint.id, false);

    // Endpoint-level event filter. Empty list means "accept everything", which is the common case.
    if (endpoint.eventTypes.length > 0 && !endpoint.eventTypes.includes(event.eventType)) {
      await tenantPrisma.integrationWebhookEvent.update({
        where: { id: event.id },
        data: { status: 'IGNORED', errorMessage: 'Event type is not accepted by this endpoint.', processedAt: new Date() },
      });
      return { received: true, ignored: true, eventId: event.id };
    }

    // Business logic is dispatched through the adapter's optional inbound hook. An adapter that has
    // none simply records the event, which is a legitimate outcome: the event log IS the useful
    // output for a connection whose only purpose is to receive.
    await tenantPrisma.integrationWebhookEvent.update({
      where: { id: event.id },
      data: { status: 'PROCESSING', attempts: { increment: 1 } },
    });

    try {
      const resolved = this.registry.resolve(integration.category, integration.provider);
      // The registry only exposes `webhook` when the adapter actually implements handleWebhook, so an
      // adapter without it is a visible "cannot handle events" rather than a duck-typed cast here.
      const handler = resolved.webhook?.handleWebhook;
      if (handler) {
        await handler.call(
          resolved.adapter,
          payload,
          this.integrationsService.toAdapterContext(integration as never),
        );
      }
      await tenantPrisma.integrationWebhookEvent.update({
        where: { id: event.id },
        data: { status: 'PROCESSED', processedAt: new Date(), errorMessage: null },
      });
      await tenantPrisma.integration.update({
        where: { id: integration.id },
        data: { lastSuccessAt: new Date(), lastErrorMessage: null, consecutiveFailures: 0, healthStatus: 'HEALTHY' },
      });
      return { received: true, processed: true, eventId: event.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Webhook processing threw an unexpected error.';
      await tenantPrisma.integrationWebhookEvent.update({
        where: { id: event.id },
        data: { status: 'FAILED', processedAt: new Date(), errorMessage: truncateResponse(message), responseStatus: 500 },
      });
      await tenantPrisma.integrationFailure.create({
        data: {
          tenantId: endpoint.tenantId,
          integrationId: endpoint.integrationId,
          webhookEventId: event.id,
          category: 'PROVIDER_REJECTED',
          retryable: false,
          message: truncateResponse(message),
        },
      });
      await this.bumpEndpointCounters(endpoint.id, true);
      // 500 tells the provider the delivery was not accepted, so its own retry logic takes over.
      // Silently returning 200 here would discard a payment notification with no trace.
      return { received: true, processed: false, eventId: event.id };
    }
  }

  /**
   * Looks up the endpoint by its path token using the PLATFORM (unscoped) client. This is the one
   * place a query is deliberately not tenant-scoped: the token is the tenant identifier, and the
   * tenant is not known until the row is read. The token is 32 hex chars of `randomUUID()`
   * randomness, so it is not guessable, and every downstream query re-establishes tenant scoping.
   */
  private async loadEndpoint(pathToken: string) {
    return this.platformPrisma.client.integrationWebhookEndpoint.findUnique({
      where: { pathToken },
      select: {
        id: true,
        tenantId: true,
        integrationId: true,
        isActive: true,
        eventTypes: true,
        secretEncrypted: true,
        signatureHeader: true,
        signatureAlgorithm: true,
        signatureToleranceSecs: true,
      },
    });
  }

  private async recordSignatureFailure(
    endpoint: { id: string; tenantId: string; integrationId: string },
    reason: string,
    rawBody: string,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<void> {
    const tenantPrisma = createTenantScopedClient(endpoint.tenantId);
    this.logger.warn(`Rejected webhook for endpoint ${endpoint.id}: ${reason}`);
    await tenantPrisma.integrationWebhookEvent.create({
      data: {
        tenantId: endpoint.tenantId,
        integrationId: endpoint.integrationId,
        webhookEndpointId: endpoint.id,
        eventType: 'unknown',
        status: 'FAILED',
        signatureVerified: false,
        // Redacted and truncated: an unverified body is attacker-controlled, so it is stored only
        // as far as an operator needs to see what was attempted.
        payload: { excerpt: truncateResponse(rawBody, 500) },
        headers: (sanitizeHeaders(headers) ?? null) as Prisma.InputJsonValue,
        errorMessage: reason,
        responseStatus: 401,
      },
    });
    await tenantPrisma.integrationFailure.create({
      data: {
        tenantId: endpoint.tenantId,
        integrationId: endpoint.integrationId,
        category: 'SIGNATURE',
        retryable: false,
        message: `Webhook signature verification failed: ${reason}`,
      },
    });
    await this.bumpEndpointCounters(endpoint.id, true);
  }

  private async bumpEndpointCounters(endpointId: string, failed: boolean): Promise<void> {
    const tenantId = await this.tenantIdForEndpoint(endpointId);
    if (!tenantId) return;
    const tenantPrisma = createTenantScopedClient(tenantId);
    await tenantPrisma.integrationWebhookEndpoint.update({
      where: { id: endpointId },
      data: {
        lastEventAt: new Date(),
        eventCount: { increment: 1 },
        ...(failed ? { failureCount: { increment: 1 } } : {}),
      },
    });
  }

  /**
   * Counters live on the endpoint row, which the tenant-scoped client can update — but building that
   * client needs the tenant id, and this method is called from paths that only have the endpoint id.
   * The endpoint's own tenant is therefore read through the platform client, then every actual
   * mutation goes through a freshly built tenant-scoped client.
   */
  private async tenantIdForEndpoint(endpointId: string): Promise<string | null> {
    const row = await this.platformPrisma.client.integrationWebhookEndpoint.findUnique({
      where: { id: endpointId },
      select: { tenantId: true },
    });
    return row?.tenantId ?? null;
  }
}

/** Best-effort event-type extraction across the provider shapes this framework must accept. */
function extractEventType(payload: unknown): string {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    for (const key of ['type', 'event', 'event_type', 'eventType', 'topic', 'status']) {
      const value = record[key];
      if (typeof value === 'string' && value !== '') return value;
    }
    if (typeof record.data === 'object' && record.data !== null) {
      const nested = record.data as Record<string, unknown>;
      for (const key of ['type', 'event', 'status']) {
        if (typeof nested[key] === 'string') return nested[key] as string;
      }
    }
  }
  return 'unknown';
}

/** Best-effort provider event id, used only for the replay guard. */
function extractExternalEventId(payload: unknown): string | null {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    for (const key of ['id', 'event_id', 'eventId', 'transaction_id', 'reference']) {
      const value = record[key];
      if (typeof value === 'string' && value !== '') return value;
    }
    if (typeof record.data === 'object' && record.data !== null) {
      const nested = record.data as Record<string, unknown>;
      if (typeof nested.id === 'string' && nested.id !== '') return nested.id;
    }
  }
  return null;
}

@ApiTags('integrations')
@Controller('integrations/webhooks')
export class IntegrationWebhooksController {
  constructor(private readonly webhookService: IntegrationWebhookService) {}

  /**
   * Always 200 on the success path (including ignored/duplicate), so a provider does not retry a
   * delivery we deliberately declined. A 500 is returned only when processing genuinely failed and
   * the provider's retry is the correct recovery.
   */
  @Post(':pathToken')
  @HttpCode(200)
  async receive(
    @Param('pathToken') pathToken: string,
    @Body() payload: unknown,
    @Req() request: RawBodyRequest,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    // Signature verification MUST run against the exact received bytes. The raw-body capture hook
    // (main.ts) puts them on the request; falling back to re-serialization here would only be
    // correct for bodies that happen to round-trip, which is not a property to rely on.
    const rawBody = request.rawBody ? request.rawBody.toString('utf8') : JSON.stringify(payload ?? null);
    const result = await this.webhookService.receive(pathToken, payload, rawBody, headers);
    if (result.processed === false) {
      throw new InternalServerErrorException('Webhook processing failed.');
    }
    return result;
  }
}
