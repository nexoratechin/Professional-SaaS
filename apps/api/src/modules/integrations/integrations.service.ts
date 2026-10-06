/**
 * Integrations service — CRUD, connection testing and the read side of every log.
 *
 * This service owns configuration and observation. It deliberately does NOT perform outbound calls:
 * those go through IntegrationsDispatchService (queued) or IntegrationsSyncService (runs), so that
 * a slow or hanging provider can never hold an HTTP request open, and so the API and the worker
 * share one implementation of "how do we call a provider".
 *
 * ## Credential handling
 *
 * Secrets are encrypted on write (AES-256-GCM via INTEGRATION_SECRET_KEY) and are NEVER included in
 * any response. Responses expose `credentialKeys` — the key names a tenant has already supplied —
 * so a settings form can render "•••• configured" without the API ever decrypting a secret in
 * order to display it. Every audit entry for a credential change records the KEYS only.
 */

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { AUDIT_ACTIONS, AUDIT_MODULES } from '@college-erp/auth';
import { randomUUID } from 'crypto';
import {
  INTEGRATION_CATEGORIES,
  IntegrationAdapterRegistry,
  IntegrationConfigError,
  IntegrationSecretCipher,
  assertValidIntegrationConfig,
  categorySupports,
  configFieldsFor,
  credentialKeys,
  redactForLog,
  resolveRetryPolicy,
  truncateResponse,
  type AuthStyle,
  type FailureCategory,
  type IntegrationAdapterContext,
  type SyncMode,
} from '@college-erp/integrations';
import { QUEUE_NAMES, type IntegrationOperationJobData } from '@college-erp/types';
import type {
  IntegrationCategory,
  IntegrationOperationStatus,
  IntegrationStatus,
  IntegrationWebhookEventStatus,
  IntegrationSyncRunStatus,
  Prisma,
  WebhookSignatureAlgorithm,
} from '@college-erp/database';
import { AppConfigService } from '../../config/app-config.service';
import { TenantContextService } from '../../common/prisma/tenant-context.service';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { AuditService } from '../audit/audit.service';
import { IntegrationsDispatchService } from './integrations-dispatch.service';
import { IntegrationsSyncService } from './integrations-sync.service';
import type {
  CreateIntegrationDto,
  CreateWebhookEndpointDto,
  FailureFilterDto,
  IntegrationFilterDto,
  OperationFilterDto,
  SyncRunFilterDto,
  UpdateIntegrationDto,
  UpdateWebhookEndpointDto,
  WebhookEventFilterDto,
} from './dto/integrations.dto';

/** Shape returned by the API. Never includes a decrypted credential. */
export interface IntegrationView {
  id: string;
  key: string;
  name: string;
  category: IntegrationCategory;
  provider: string;
  direction: string;
  description: string | null;
  config: Prisma.JsonValue;
  credentialKeys: string[];
  retryPolicy: Prisma.JsonValue;
  status: IntegrationStatus;
  isDefault: boolean;
  healthStatus: string;
  lastTestedAt: Date | null;
  lastTestSucceededAt: Date | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  consecutiveFailures: number;
  lastErrorMessage: string | null;
  lastLatencyMs: number | null;
  syncCursor: string | null;
  capabilities: string[];
  createdAt: Date;
  updatedAt: Date;
}

type IntegrationRow = {
  id: string;
  key: string;
  name: string;
  category: IntegrationCategory;
  provider: string;
  direction: string;
  description: string | null;
  config: Prisma.JsonValue;
  credentialsEncrypted: string | null;
  retryPolicy: Prisma.JsonValue;
  status: IntegrationStatus;
  isDefault: boolean;
  healthStatus: string;
  lastTestedAt: Date | null;
  lastTestSucceededAt: Date | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  consecutiveFailures: number;
  lastErrorMessage: string | null;
  lastLatencyMs: number | null;
  syncCursor: string | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class IntegrationsService {
  private readonly cipher: IntegrationSecretCipher;

  /**
   * The tenant-scoped Prisma client, exposed to the sibling services in this module.
   *
   * They run inside the same request (or the same worker tick) as this service, so the client is
   * already memoized for the tenant by TenantMatchGuard; handing it out avoids each service
   * re-injecting TenantScopedPrismaService just to reach the same object.
   */
  get tenantClient() {
    return this.tenantPrisma.client;
  }

  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly auditService: AuditService,
    private readonly dispatchService: IntegrationsDispatchService,
    private readonly syncService: IntegrationsSyncService,
    private readonly appConfig: AppConfigService,
    private readonly registry: IntegrationAdapterRegistry,
    @InjectQueue(QUEUE_NAMES.INTEGRATION_OPERATIONS)
    private readonly operationsQueue: Queue<IntegrationOperationJobData>,
  ) {
    this.cipher = new IntegrationSecretCipher(this.appConfig.get('INTEGRATION_SECRET_KEY'));
  }

  // ── Catalog (no tenant data; drives the settings form) ──────────────────────

  /**
   * The self-describing catalog: which categories exist, what each one can do, and which config and
   * credential fields it needs. The UI renders its form from this rather than hard-coding per-vendor
   * fields — which is what lets a new provider work with no frontend change.
   */
  catalog() {
    return {
      categories: INTEGRATION_CATEGORIES.map((category) => ({
        category,
        providers: this.registry.providersFor(category),
      })),
      fields: {
        base: configFieldsFor('ACCOUNTING', 'http_json'),
        http_json: configFieldsFor('ACCOUNTING', 'http_json'),
        webhook: configFieldsFor('ACCOUNTING', 'webhook'),
        mock: configFieldsFor('ACCOUNTING', 'mock'),
      },
    };
  }

  // ── Integration CRUD ────────────────────────────────────────────────────────

  async list(query: IntegrationFilterDto) {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const where: Prisma.IntegrationWhereInput = {
      ...(query.category ? { category: query.category } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { key: { contains: query.search, mode: 'insensitive' } },
              { provider: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.tenantPrisma.client.integration.findMany({
        where,
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
        take: limit,
        skip: offset,
      }),
      this.tenantPrisma.client.integration.count({ where }),
    ]);

    return { total, limit, offset, items: rows.map((row) => this.toView(row)) };
  }

  async get(id: string): Promise<IntegrationView> {
    return this.toView(await this.requireIntegration(id));
  }

  async create(dto: CreateIntegrationDto, actorUserId: string): Promise<IntegrationView> {
    const tenantId = this.requireTenantId();
    const config = dto.config ?? {};
    const credentials = dto.credentials ?? {};

    // Validate BEFORE persisting so an integration that could never work never reaches the DB.
    this.assertConfigValid(dto.category, dto.provider, config, credentials);

    const existing = await this.tenantPrisma.client.integration.findFirst({
      where: { key: dto.key },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(`An integration with key "${dto.key}" already exists.`);
    }

    // Only one default per category: an unset default on the new row when it becomes the default,
    // otherwise "the default payment gateway" is ambiguous.
    const created = await this.tenantPrisma.client.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.integration.updateMany({
          where: { category: dto.category, isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.integration.create({
        data: {
          tenantId,
          key: dto.key,
          name: dto.name,
          category: dto.category,
          provider: dto.provider,
          direction: dto.direction ?? 'OUTBOUND',
          description: dto.description ?? null,
          config: config as Prisma.InputJsonValue,
          // Nullable on purpose: a DRAFT may legitimately have no secrets yet, and the endpoint's
          // own generated secret is separate from the provider's credentials.
          credentialsEncrypted: Object.keys(credentials).length > 0 ? this.cipher.encryptBag(credentials) : null,
          retryPolicy: (dto.retryPolicy ?? null) as Prisma.InputJsonValue,
          // A new integration is always created DRAFT, whatever the caller asks for. Activating is a
          // separate, audited act, and validation runs again at activation time.
          status: 'DRAFT',
          isDefault: dto.isDefault ?? false,
          createdBy: actorUserId,
          updatedBy: actorUserId,
        },
      });
    });

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.INTEGRATION_CREATED,
      module: AUDIT_MODULES.INTEGRATIONS,
      entityType: 'Integration',
      entityId: created.id,
      after: this.auditPayload(created),
    });
    if (Object.keys(credentials).length > 0) {
      // Separate action because it is the security-relevant one: names of what was stored, never values.
      await this.auditService.record({
        scope: 'TENANT',
        tenantId,
        actorType: 'USER',
        actorUserId,
        action: AUDIT_ACTIONS.INTEGRATION_CREDENTIALS_UPDATED,
        module: AUDIT_MODULES.INTEGRATIONS,
        entityType: 'Integration',
        entityId: created.id,
        after: { credentialKeys: credentialKeys(credentials) },
      });
    }

    return this.toView(created);
  }

  async update(id: string, dto: UpdateIntegrationDto, actorUserId: string): Promise<IntegrationView> {
    const tenantId = this.requireTenantId();
    const before = await this.requireIntegration(id);

    const nextConfig = dto.config ?? (before.config as Record<string, unknown>) ?? {};
    // Absent `credentials` means "leave the stored secrets alone". Blanking a tenant's gateway API
    // key because someone edited a timeout would be a serious data-loss bug, so this distinction is
    // load-bearing rather than cosmetic.
    const existingCredentials = this.cipher.decryptBag(before.credentialsEncrypted);
    const nextCredentials = dto.credentials ?? existingCredentials;

    this.assertConfigValid(before.category, before.provider, nextConfig, nextCredentials);

    const updated = await this.tenantPrisma.client.$transaction(async (tx) => {
      if (dto.isDefault === true && !before.isDefault) {
        await tx.integration.updateMany({
          where: { category: before.category, isDefault: true, NOT: { id } },
          data: { isDefault: false },
        });
      }
      return tx.integration.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.config !== undefined ? { config: dto.config as Prisma.InputJsonValue } : {}),
          ...(dto.retryPolicy !== undefined
            ? { retryPolicy: dto.retryPolicy as Prisma.InputJsonValue }
            : {}),
          ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
          ...(dto.credentials !== undefined ? { credentialsEncrypted: this.cipher.encryptBag(dto.credentials) } : {}),
          updatedBy: actorUserId,
        },
      });
    });

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.INTEGRATION_UPDATED,
      module: AUDIT_MODULES.INTEGRATIONS,
      entityType: 'Integration',
      entityId: id,
      before: this.auditPayload(before),
      after: this.auditPayload(updated),
    });
    if (dto.credentials !== undefined) {
      await this.auditService.record({
        scope: 'TENANT',
        tenantId,
        actorType: 'USER',
        actorUserId,
        action: AUDIT_ACTIONS.INTEGRATION_CREDENTIALS_UPDATED,
        module: AUDIT_MODULES.INTEGRATIONS,
        entityType: 'Integration',
        entityId: id,
        after: { credentialKeys: credentialKeys(dto.credentials) },
      });
    }

    return this.toView(updated);
  }

  /**
   * Activation / deactivation. Validates configuration again here rather than trusting the create
   * path: credentials may have been invalidated at the provider since the row was written, and a
   * DRAFT → ACTIVE transition is the last point at which we can refuse.
   */
  async changeStatus(id: string, status: IntegrationStatus, actorUserId: string): Promise<IntegrationView> {
    const tenantId = this.requireTenantId();
    const before = await this.requireIntegration(id);

    if (status === 'ACTIVE') {
      const config = (before.config as Record<string, unknown>) ?? {};
      const credentials = this.cipher.decryptBag(before.credentialsEncrypted);
      this.assertConfigValid(before.category, before.provider, config, credentials);
    }

    const updated = await this.tenantPrisma.client.integration.update({
      where: { id },
      data: {
        status,
        updatedBy: actorUserId,
        // Activating a never-tested integration must not report HEALTHY: UNKNOWN is honest, and the
        // operator is prompted to test before trusting it.
        ...(status === 'ACTIVE' && before.healthStatus === 'UNHEALTHY'
          ? { healthStatus: 'DEGRADED' }
          : {}),
      },
    });

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.INTEGRATION_STATUS_CHANGED,
      module: AUDIT_MODULES.INTEGRATIONS,
      entityType: 'Integration',
      entityId: id,
      before: { status: before.status },
      after: { status },
    });

    return this.toView(updated);
  }

  async remove(id: string, actorUserId: string): Promise<{ deleted: boolean; id: string }> {
    const tenantId = this.requireTenantId();
    const before = await this.requireIntegration(id);
    await this.tenantPrisma.client.integration.delete({ where: { id } });
    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.INTEGRATION_DELETED,
      module: AUDIT_MODULES.INTEGRATIONS,
      entityType: 'Integration',
      entityId: id,
      before: this.auditPayload(before),
    });
    return { deleted: true, id };
  }

  // ── Connection testing ──────────────────────────────────────────────────────

  /**
   * Probes the provider for real. This is the only place credentials are decrypted in the API's
   * request path, and the plaintext never leaves this method.
   *
   * Always records `lastTestedAt` and audits the attempt whether it passes or fails: a failed test
   * is exactly the thing an operator needs a record of, and a test that silently threw would leave
   * no trace at all.
   */
  async testConnection(id: string, actorUserId: string) {
    const tenantId = this.requireTenantId();
    const row = await this.requireIntegration(id);

    const startedAt = Date.now();
    let result: { ok: boolean; message: string; latencyMs: number; status?: number | null; responseExcerpt?: unknown };
    try {
      const resolved = this.registry.resolve(row.category, row.provider);
      const tester = resolved.connectionTest;
      if (!tester) {
        result = {
          ok: false,
          message: `Provider "${row.provider}" does not support connection testing.`,
          latencyMs: 0,
          status: null,
        };
      } else {
        result = await tester.testConnection(this.toAdapterContext(row));
      }
    } catch (error) {
      result = {
        ok: false,
        message: error instanceof Error ? error.message : 'Connection test threw an unexpected error.',
        latencyMs: Date.now() - startedAt,
        status: null,
      };
    }

    const now = new Date();
    await this.tenantPrisma.client.integration.update({
      where: { id },
      data: {
        lastTestedAt: now,
        lastTestSucceededAt: result.ok ? now : null,
        lastLatencyMs: result.latencyMs,
        healthStatus: result.ok ? 'HEALTHY' : 'UNHEALTHY',
        lastErrorMessage: result.ok ? null : truncateResponse(result.message),
        updatedBy: actorUserId,
      },
    });

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.INTEGRATION_CONNECTION_TESTED,
      module: AUDIT_MODULES.INTEGRATIONS,
      entityType: 'Integration',
      entityId: id,
      after: { ok: result.ok, status: result.status ?? null, latencyMs: result.latencyMs },
    });

    return result;
  }

  // ── Webhook endpoints ───────────────────────────────────────────────────────

  async listWebhookEndpoints(integrationId: string) {
    const tenantId = this.requireTenantId();
    // Resolve the parent through the tenant-scoped client first so a foreign id 404s rather than
    // leaking the existence of another tenant's integration.
    await this.requireIntegration(integrationId);
    const rows = await this.tenantPrisma.client.integrationWebhookEndpoint.findMany({
      where: { integrationId },
      orderBy: { name: 'asc' },
    });
    return rows.map((row) => this.toEndpointView(row, tenantId));
  }

  /**
   * Creates the endpoint and its signing secret. The secret is generated here, encrypted, and shown
   * exactly once — the same "copy it now" contract the notification provider configs use. It cannot
   * be recovered later by design.
   */
  async createWebhookEndpoint(
    integrationId: string,
    dto: CreateWebhookEndpointDto,
    actorUserId: string,
  ) {
    const tenantId = this.requireTenantId();
    const integration = await this.requireIntegration(integrationId);

    if (!categorySupports(integration.category, 'INBOUND_WEBHOOK')) {
      throw new BadRequestException(
        `Integrations of category ${integration.category} cannot receive inbound webhooks.`,
      );
    }

    const secret = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
    const created = await this.tenantPrisma.client.integrationWebhookEndpoint.create({
      data: {
        tenantId,
        integrationId,
        name: dto.name,
        pathToken: randomUUID().replace(/-/g, ''),
        eventTypes: dto.eventTypes ?? [],
        secretEncrypted: this.cipher.encrypt(secret),
        signatureHeader: dto.signatureHeader ?? 'x-integration-signature',
        signatureAlgorithm: (dto.signatureAlgorithm ?? 'HMAC_SHA256') as WebhookSignatureAlgorithm,
        signatureToleranceSecs: dto.signatureToleranceSecs ?? 300,
        createdBy: actorUserId,
        updatedBy: actorUserId,
      },
    });

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.INTEGRATION_WEBHOOK_ENDPOINT_CREATED,
      module: AUDIT_MODULES.INTEGRATIONS,
      entityType: 'IntegrationWebhookEndpoint',
      entityId: created.id,
      after: {
        integrationId,
        name: created.name,
        signatureAlgorithm: created.signatureAlgorithm,
        signatureHeader: created.signatureHeader,
      },
    });

    // The only time the signing secret is ever returned.
    return { ...this.toEndpointView(created, tenantId), signingSecret: secret };
  }

  async updateWebhookEndpoint(
    integrationId: string,
    endpointId: string,
    dto: UpdateWebhookEndpointDto,
    actorUserId: string,
  ) {
    const tenantId = this.requireTenantId();
    await this.requireIntegration(integrationId);
    const before = await this.requireEndpoint(integrationId, endpointId);

    const updated = await this.tenantPrisma.client.integrationWebhookEndpoint.update({
      where: { id: endpointId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.eventTypes !== undefined ? { eventTypes: dto.eventTypes } : {}),
        ...(dto.signatureHeader !== undefined ? { signatureHeader: dto.signatureHeader } : {}),
        ...(dto.signatureAlgorithm !== undefined
          ? { signatureAlgorithm: dto.signatureAlgorithm as WebhookSignatureAlgorithm }
          : {}),
        ...(dto.signatureToleranceSecs !== undefined
          ? { signatureToleranceSecs: dto.signatureToleranceSecs }
          : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        updatedBy: actorUserId,
      },
    });

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.INTEGRATION_WEBHOOK_ENDPOINT_UPDATED,
      module: AUDIT_MODULES.INTEGRATIONS,
      entityType: 'IntegrationWebhookEndpoint',
      entityId: endpointId,
      before: { name: before.name, isActive: before.isActive, eventTypes: before.eventTypes },
      after: { name: updated.name, isActive: updated.isActive, eventTypes: updated.eventTypes },
    });

    return this.toEndpointView(updated, tenantId);
  }

  async removeWebhookEndpoint(integrationId: string, endpointId: string, actorUserId: string) {
    const tenantId = this.requireTenantId();
    await this.requireIntegration(integrationId);
    const before = await this.requireEndpoint(integrationId, endpointId);
    await this.tenantPrisma.client.integrationWebhookEndpoint.delete({ where: { id: endpointId } });
    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.INTEGRATION_WEBHOOK_ENDPOINT_DELETED,
      module: AUDIT_MODULES.INTEGRATIONS,
      entityType: 'IntegrationWebhookEndpoint',
      entityId: endpointId,
      before: { integrationId, name: before.name },
    });
    return { deleted: true, id: endpointId };
  }

  /**
   * Rotates an endpoint's path token, which revokes the previously public URL. The right response to
   * a leaked webhook URL: a provider that has the old token stops being able to deliver, and the
   * operator re-configures it without losing this endpoint's event history.
   */
  async rotateWebhookEndpointSecret(
    integrationId: string,
    endpointId: string,
    actorUserId: string,
  ) {
    const tenantId = this.requireTenantId();
    await this.requireIntegration(integrationId);
    await this.requireEndpoint(integrationId, endpointId);

    const secret = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
    const updated = await this.tenantPrisma.client.integrationWebhookEndpoint.update({
      where: { id: endpointId },
      data: {
        pathToken: randomUUID().replace(/-/g, ''),
        secretEncrypted: this.cipher.encrypt(secret),
        updatedBy: actorUserId,
      },
    });

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.INTEGRATION_WEBHOOK_ENDPOINT_ROTATED,
      module: AUDIT_MODULES.INTEGRATIONS,
      entityType: 'IntegrationWebhookEndpoint',
      entityId: endpointId,
      after: { integrationId },
    });

    return { ...this.toEndpointView(updated, tenantId), signingSecret: secret };
  }

  // ── Read side of the logs ───────────────────────────────────────────────────

  async listWebhookEvents(query: WebhookEventFilterDto) {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const where: Prisma.IntegrationWebhookEventWhereInput = {
      // Cast to the generated enum rather than validating with a duplicated @IsEnum: the enum is
      // already the schema's contract, and an unknown value would be a 500 at the DB rather than a
      // 400, so the filter is constrained to the known set here.
      ...(query.status ? { status: query.status as IntegrationWebhookEventStatus } : {}),
      ...(query.eventType ? { eventType: query.eventType } : {}),
      ...(query.integrationId ? { integrationId: query.integrationId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.tenantPrisma.client.integrationWebhookEvent.findMany({
        where,
        orderBy: { receivedAt: 'desc' },
        take: limit,
        skip: offset,
        include: { integration: { select: { key: true, name: true } } },
      }),
      this.tenantPrisma.client.integrationWebhookEvent.count({ where }),
    ]);
    return { total, limit, offset, items: rows };
  }

  async listOperations(query: OperationFilterDto) {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    // An absent integrationId means "every integration this tenant owns", which is the useful default
    // for a tenant-level operations log. The tenant guard still scopes the read — there is no way to
    // widen it beyond the caller's own tenant.
    const where: Prisma.IntegrationOperationWhereInput = {
      ...(query.integrationId ? { integrationId: query.integrationId } : {}),
      ...(query.status ? { status: query.status as IntegrationOperationStatus } : {}),
    };
    const [rows, total] = await Promise.all([
      this.tenantPrisma.client.integrationOperation.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.tenantPrisma.client.integrationOperation.count({ where }),
    ]);
    return { total, limit, offset, items: rows };
  }

  async retryOperation(id: string, actorUserId: string) {
    const tenantId = this.requireTenantId();
    const operation = await this.tenantPrisma.client.integrationOperation.findFirst({
      where: { id },
    });
    if (!operation) {
      throw new NotFoundException('Integration operation not found.');
    }
    const requeued = await this.dispatchService.requeueOperation(operation.id, {
      tenantId,
      isManualRetry: true,
    });
    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.INTEGRATION_OPERATION_RETRIED,
      module: AUDIT_MODULES.INTEGRATIONS,
      entityType: 'IntegrationOperation',
      entityId: id,
      after: { integrationId: operation.integrationId, operation: operation.operation },
    });
    return requeued;
  }

  async listFailures(query: FailureFilterDto) {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const where: Prisma.IntegrationFailureWhereInput = {
      ...(query.category ? { category: query.category as FailureCategory } : {}),
      ...(query.integrationId ? { integrationId: query.integrationId } : {}),
      ...(query.resolved === 'true'
        ? { resolvedAt: { not: null } }
        : query.resolved === 'false'
          ? { resolvedAt: null }
          : {}),
    };
    const [rows, total] = await Promise.all([
      this.tenantPrisma.client.integrationFailure.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: { integration: { select: { key: true, name: true, category: true } } },
      }),
      this.tenantPrisma.client.integrationFailure.count({ where }),
    ]);
    return { total, limit, offset, items: rows };
  }

  async resolveFailure(id: string, resolved: boolean, note: string | undefined, actorUserId: string) {
    const tenantId = this.requireTenantId();
    const failure = await this.tenantPrisma.client.integrationFailure.findFirst({ where: { id } });
    if (!failure) {
      throw new NotFoundException('Integration failure not found.');
    }
    const updated = await this.tenantPrisma.client.integrationFailure.update({
      where: { id },
      data: {
        resolvedAt: resolved ? new Date() : null,
        resolvedBy: resolved ? actorUserId : null,
        resolutionNote: note ?? null,
      },
    });
    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.INTEGRATION_FAILURE_RESOLVED,
      module: AUDIT_MODULES.INTEGRATIONS,
      entityType: 'IntegrationFailure',
      entityId: id,
      before: { resolvedAt: failure.resolvedAt?.toISOString() ?? null },
      after: { resolvedAt: updated.resolvedAt?.toISOString() ?? null, note: note ?? null },
    });
    return updated;
  }

  async listSyncRuns(query: SyncRunFilterDto) {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const where: Prisma.IntegrationSyncRunWhereInput = {
      ...(query.integrationId ? { integrationId: query.integrationId } : {}),
      ...(query.status ? { status: query.status as IntegrationSyncRunStatus } : {}),
    };
    const [rows, total] = await Promise.all([
      this.tenantPrisma.client.integrationSyncRun.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: { integration: { select: { key: true, name: true } } },
      }),
      this.tenantPrisma.client.integrationSyncRun.count({ where }),
    ]);
    return { total, limit, offset, items: rows };
  }

  async getSyncRun(id: string) {
    const run = await this.tenantPrisma.client.integrationSyncRun.findFirst({
      where: { id },
      include: {
        integration: { select: { key: true, name: true } },
        records: { orderBy: { createdAt: 'asc' }, take: 200 },
      },
    });
    if (!run) {
      throw new NotFoundException('Sync run not found.');
    }
    return run;
  }

  async startSync(
    integrationId: string,
    entityType: string,
    mode: SyncMode,
    scope: Record<string, unknown> | undefined,
    pageSize: number | undefined,
    actorUserId: string,
  ) {
    const tenantId = this.requireTenantId();
    const run = await this.syncService.createRun({
      tenantId,
      integrationId,
      entityType,
      mode,
      scope,
      pageSize,
      trigger: 'MANUAL',
      requestedBy: actorUserId,
    });
    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.INTEGRATION_SYNC_STARTED,
      module: AUDIT_MODULES.INTEGRATIONS,
      entityType: 'IntegrationSyncRun',
      entityId: run.id,
      after: { integrationId, entityType, mode },
    });
    return run;
  }

  async cancelSyncRun(id: string, actorUserId: string) {
    const tenantId = this.requireTenantId();
    const result = await this.syncService.cancelRun(id);
    if (result.canceled) {
      await this.auditService.record({
        scope: 'TENANT',
        tenantId,
        actorType: 'USER',
        actorUserId,
        action: AUDIT_ACTIONS.INTEGRATION_SYNC_CANCELED,
        module: AUDIT_MODULES.INTEGRATIONS,
        entityType: 'IntegrationSyncRun',
        entityId: id,
        before: { status: result.previousStatus },
        after: { status: 'CANCELED' },
      });
    }
    // A run that was already terminal is returned untouched rather than reported as canceled — see
    // IntegrationsSyncService.cancelRun for why rewriting a SUCCEEDED/FAILED run would destroy the
    // record an operator is triaging.
    return result;
  }

  /** Cross-category health roll-up for the dashboard header. */
  async summary() {
    const [byCategory, unhealthy, failuresOpen] = await Promise.all([
      this.tenantPrisma.client.integration.groupBy({
        by: ['category', 'healthStatus'],
        _count: { _all: true },
      }),
      this.tenantPrisma.client.integration.count({ where: { healthStatus: 'UNHEALTHY' } }),
      this.tenantPrisma.client.integrationFailure.count({ where: { resolvedAt: null } }),
    ]);
    return {
      byCategory: byCategory.map((row) => ({
        category: row.category,
        healthStatus: row.healthStatus,
        count: row._count._all,
      })),
      unhealthy,
      openFailures: failuresOpen,
    };
  }

  // ── Shared helpers (also used by dispatch/sync) ─────────────────────────────

  /** Loads an integration through the tenant-scoped client; 404 rather than a cross-tenant leak. */
  async requireIntegration(id: string): Promise<IntegrationRow> {
    const row = await this.tenantPrisma.client.integration.findFirst({
      where: { id },
    });
    if (!row) {
      throw new NotFoundException('Integration not found.');
    }
    return row as unknown as IntegrationRow;
  }

  /**
   * Builds the adapter context: config + decrypted credentials + resolved timeout. Shared with the
   * dispatch and sync services so there is exactly one definition of "how a provider is called".
   */
  toAdapterContext(row: IntegrationRow, idempotencyKey?: string | null): IntegrationAdapterContext {
    const policy = resolveRetryPolicy(row.retryPolicy as Record<string, unknown> | null);
    const config = (row.config as Record<string, unknown>) ?? {};
    const timeoutSec = config.timeoutSec;
    return {
      integrationKey: row.key,
      config,
      credentials: this.cipher.decryptBag(row.credentialsEncrypted),
      timeoutMs:
        typeof timeoutSec === 'number' && Number.isFinite(timeoutSec) && timeoutSec > 0
          ? Math.floor(timeoutSec * 1000)
          : policy.timeoutMs,
      idempotencyKey: idempotencyKey ?? null,
    };
  }

  /** Decrypts an endpoint's signing secret. Used by the public webhook controller only. */
  decryptEndpointSecret(secretEncrypted: string): string {
    return this.cipher.decrypt(secretEncrypted);
  }

  /** Auth style declared by a stored config, for callers that need to reason about it. */
  authStyleFor(row: IntegrationRow): AuthStyle {
    const config = (row.config as Record<string, unknown>) ?? {};
    const style = config.authStyle;
    return (typeof style === 'string' ? style : 'bearer') as AuthStyle;
  }

  private async requireEndpoint(integrationId: string, endpointId: string) {
    const endpoint = await this.tenantPrisma.client.integrationWebhookEndpoint.findFirst({
      where: { id: endpointId, integrationId },
    });
    if (!endpoint) {
      throw new NotFoundException('Webhook endpoint not found.');
    }
    return endpoint;
  }

  private requireTenantId(): string {
    const tenantId = this.tenantContext.tenantId;
    if (!tenantId) {
      throw new BadRequestException('No tenant context on this request.');
    }
    return tenantId;
  }

  /** Converts a package-level validation error into a 400 rather than a 500. */
  private assertConfigValid(
    category: string,
    provider: string,
    config: Record<string, unknown>,
    credentials: Record<string, unknown>,
  ): void {
    try {
      assertValidIntegrationConfig({
        category,
        provider,
        config,
        credentials,
        isProviderRegistered: this.registry.has(provider),
      });
    } catch (error) {
      if (error instanceof IntegrationConfigError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  private toView(row: IntegrationRow): IntegrationView {
    const resolved = this.registry.resolve(row.category, row.provider);
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      category: row.category,
      provider: row.provider,
      direction: row.direction,
      description: row.description,
      // redactForLog returns `unknown` because it walks arbitrary values; it only ever produces
      // JSON-compatible output, so the cast is safe and keeps the package framework-free of Prisma.
      config: redactForLog(row.config) as Prisma.JsonValue,
      credentialKeys: credentialKeys(this.cipher.decryptBag(row.credentialsEncrypted)),
      retryPolicy: row.retryPolicy,
      status: row.status,
      isDefault: row.isDefault,
      healthStatus: row.healthStatus,
      lastTestedAt: row.lastTestedAt,
      lastTestSucceededAt: row.lastTestSucceededAt,
      lastSuccessAt: row.lastSuccessAt,
      lastFailureAt: row.lastFailureAt,
      consecutiveFailures: row.consecutiveFailures,
      lastErrorMessage: row.lastErrorMessage,
      lastLatencyMs: row.lastLatencyMs,
      syncCursor: row.syncCursor,
      capabilities: Object.keys(resolved.capabilities),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toEndpointView(
    row: {
      id: string;
      integrationId: string;
      name: string;
      pathToken: string;
      eventTypes: string[];
      signatureHeader: string;
      signatureAlgorithm: string;
      signatureToleranceSecs: number;
      isActive: boolean;
      lastEventAt: Date | null;
      eventCount: number;
      failureCount: number;
      createdAt: Date;
    },
    tenantId: string,
  ) {
    return {
      id: row.id,
      integrationId: row.integrationId,
      name: row.name,
      // The full public URL an operator pastes into the provider's dashboard. pathToken is random,
      // so publishing it is the intended disclosure — the signing secret is what protects it.
      pathToken: row.pathToken,
      eventTypes: row.eventTypes,
      signatureHeader: row.signatureHeader,
      signatureAlgorithm: row.signatureAlgorithm,
      signatureToleranceSecs: row.signatureToleranceSecs,
      isActive: row.isActive,
      lastEventAt: row.lastEventAt,
      eventCount: row.eventCount,
      failureCount: row.failureCount,
      url: `/api/integrations/webhooks/${row.pathToken}`,
      tenantSlug: tenantId,
      createdAt: row.createdAt,
    };
  }

  /** Audit payload: redacted config plus credential KEY names, never values. */
  private auditPayload(row: IntegrationRow): Prisma.InputJsonValue {
    return {
      key: row.key,
      name: row.name,
      category: row.category,
      provider: row.provider,
      status: row.status,
      isDefault: row.isDefault,
      config: redactForLog(row.config) as Prisma.InputJsonValue,
      credentialKeys: credentialKeys(this.cipher.decryptBag(row.credentialsEncrypted)),
    };
  }
}
