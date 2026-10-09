import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { dirname, join } from 'node:path';
import {
  PrismaCliMigrationExecutor,
  TenantDatabaseProvisioner,
  TenantDatabaseSecretCipher,
  descriptorToTarget,
  seedGlobalCatalog,
  tenantConnectionRegistry,
  tenantPrismaClientPool,
  type Tenant,
  type TenantDataIsolationMode,
} from '@college-erp/database';
import { AUDIT_ACTIONS, AUDIT_MODULES } from '@college-erp/auth';
import type {
  TenantDataIsolationPlanDto,
  TenantDatabaseStatusDto,
} from '@college-erp/types';
import { AppConfigService } from '../../config/app-config.service';
import { PlatformPrismaService } from '../../common/prisma/platform-prisma.service';
import { TenantConnectionService } from '../../common/tenant/tenant-connection.service';
import { TenantLookupService } from '../../common/tenant/tenant-lookup.service';
import { AuditService } from '../audit/audit.service';
import type { SetTenantDataIsolationDto } from './dto/set-tenant-data-isolation.dto';

type TenantRow = Tenant;

/**
 * Orchestrates enterprise tenants' physical stores: provisioning, catalog seeding, schema
 * migrations and the read-only cutover plan. The heavy lifting (DDL, migration reconciliation,
 * encryption) lives in packages/database's tenant-database abstraction; this service adds the
 * control-plane persistence, audit trail and registry wiring.
 *
 * Existing tenants are never migrated automatically: `provisionForTenant` only acts on a tenant
 * already marked DEDICATED_*, and `setDataIsolation` refuses to flip a tenant that already holds
 * business data.
 */
@Injectable()
export class TenantDatabaseService {
  private readonly logger = new Logger(TenantDatabaseService.name);

  constructor(
    private readonly platformPrisma: PlatformPrismaService,
    private readonly config: AppConfigService,
    private readonly auditService: AuditService,
    private readonly connection: TenantConnectionService,
    private readonly tenantLookup: TenantLookupService,
  ) {}

  // --- Public operations -------------------------------------------------------------------

  /** GET /tenants/:id/database */
  async getStatus(tenantId: string): Promise<TenantDatabaseStatusDto> {
    const tenant = await this.platformPrisma.client.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, dataIsolationMode: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found.');

    const row = await this.platformPrisma.client.tenantDatabase.findUnique({ where: { tenantId } });
    return {
      tenantId,
      mode: tenant.dataIsolationMode,
      status: row?.status ?? (tenant.dataIsolationMode === 'SHARED' ? 'NOT_APPLICABLE' : 'PENDING'),
      schemaName: row?.schemaName ?? null,
      databaseName: row?.databaseName ?? null,
      appliedMigrationCount: row?.appliedMigrationCount ?? 0,
      lastAppliedMigration: row?.lastAppliedMigration ?? null,
      lastMigratedAt: row?.lastMigratedAt?.toISOString() ?? null,
      provisionedAt: row?.provisionedAt?.toISOString() ?? null,
      failureReason: row?.failureReason ?? null,
      routable: tenantConnectionRegistry.has(tenantId),
    };
  }

  /**
   * Provisions (or re-provisions) the tenant's dedicated store, seeds the global catalog, copies
   * the tenant row so foreign keys resolve, and registers the connection. Idempotent: safe to
   * re-run after a FAILED attempt.
   */
  async provisionForTenant(tenantId: string, actorPlatformUserId: string): Promise<TenantDatabaseStatusDto> {
    this.assertIsolationEnabled();
    const tenant = await this.platformPrisma.client.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    if (tenant.dataIsolationMode === 'SHARED') {
      throw new BadRequestException(
        'Tenant is on the shared database. Set an enterprise isolation mode before provisioning.',
      );
    }

    await this.platformPrisma.client.tenantDatabase.upsert({
      where: { tenantId },
      update: { mode: tenant.dataIsolationMode, status: 'PROVISIONING', failureReason: null, updatedBy: actorPlatformUserId },
      create: { tenantId, mode: tenant.dataIsolationMode, status: 'PROVISIONING', createdBy: actorPlatformUserId },
    });

    try {
      const provisioner = this.buildProvisioner();
      const result = await provisioner.provision({
        tenantId,
        slug: tenant.slug,
        mode: tenant.dataIsolationMode,
      });

      const target = provisioner.targetForDescriptor({
        tenantId,
        mode: result.mode,
        schemaName: result.schemaName,
        databaseName: result.databaseName,
        connectionUrl: result.connectionUrl,
      });

      const client = tenantPrismaClientPool.getClient(result.connectionUrl);
      await seedGlobalCatalog(client);
      await this.ensureTenantRow(client, tenant);

      const cipher = this.requireCipher();
      const updated = await this.platformPrisma.client.tenantDatabase.update({
        where: { tenantId },
        data: {
          status: 'READY',
          connectionUrlEncrypted: cipher.encrypt(result.connectionUrl),
          schemaName: result.schemaName,
          databaseName: result.databaseName,
          provisionedAt: new Date(),
          lastMigratedAt: result.migrationsApplied ? new Date() : null,
          appliedMigrationCount: result.migrationsApplied ? 1 : 0,
          lastAppliedMigration: result.lastAppliedMigration,
          failureReason: null,
          updatedBy: actorPlatformUserId,
        },
      });

      this.connection.register(target);

      await this.auditService.record({
        scope: 'PLATFORM',
        tenantId,
        actorType: 'PLATFORM_USER',
        actorPlatformUserId,
        action: AUDIT_ACTIONS.TENANT_DATABASE_PROVISIONED,
        module: AUDIT_MODULES.TENANTS,
        entityType: 'TenantDatabase',
        entityId: updated.id,
        after: {
          mode: result.mode,
          schemaName: result.schemaName,
          databaseName: result.databaseName,
          migrationsApplied: result.migrationsApplied,
        },
      });

      return this.getStatus(tenantId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Provisioning failed for tenant ${tenantId}: ${message}`);
      await this.platformPrisma.client.tenantDatabase.update({
        where: { tenantId },
        data: { status: 'FAILED', failureReason: message, updatedBy: actorPlatformUserId },
      });
      await this.auditService.record({
        scope: 'PLATFORM',
        tenantId,
        actorType: 'PLATFORM_USER',
        actorPlatformUserId,
        action: AUDIT_ACTIONS.TENANT_DATABASE_FAILED,
        module: AUDIT_MODULES.TENANTS,
        entityType: 'TenantDatabase',
        entityId: tenantId,
        after: { operation: 'provision', error: message },
      });
      throw error;
    }
  }

  /** Reconciles an enterprise tenant's store to the current Prisma schema. */
  async migrate(tenantId: string, actorPlatformUserId: string): Promise<TenantDatabaseStatusDto> {
    this.assertIsolationEnabled();
    const row = await this.platformPrisma.client.tenantDatabase.findUnique({ where: { tenantId } });
    if (!row || row.mode === 'SHARED') {
      throw new BadRequestException('Tenant has no dedicated store to migrate.');
    }
    const cipher = this.requireCipher();
    const target = descriptorToTarget(row, cipher);
    if (!target) {
      throw new BadRequestException('Tenant store is not READY; provision it first.');
    }

    await this.platformPrisma.client.tenantDatabase.update({
      where: { tenantId },
      data: { status: 'MIGRATING', updatedBy: actorPlatformUserId },
    });

    try {
      const provisioner = this.buildProvisioner();
      const result = await provisioner.migrate(target);
      const updated = await this.platformPrisma.client.tenantDatabase.update({
        where: { tenantId },
        data: {
          status: 'READY',
          appliedMigrationCount: row.appliedMigrationCount + (result.applied ? 1 : 0),
          lastAppliedMigration: result.lastAppliedMigration ?? row.lastAppliedMigration,
          lastMigratedAt: result.applied ? new Date() : row.lastMigratedAt,
          failureReason: null,
          updatedBy: actorPlatformUserId,
        },
      });
      this.connection.register(target);

      await this.auditService.record({
        scope: 'PLATFORM',
        tenantId,
        actorType: 'PLATFORM_USER',
        actorPlatformUserId,
        action: AUDIT_ACTIONS.TENANT_DATABASE_MIGRATED,
        module: AUDIT_MODULES.TENANTS,
        entityType: 'TenantDatabase',
        entityId: updated.id,
        after: { applied: result.applied, sqlLength: result.sqlLength },
      });

      return this.getStatus(tenantId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.platformPrisma.client.tenantDatabase.update({
        where: { tenantId },
        data: { status: 'FAILED', failureReason: message, updatedBy: actorPlatformUserId },
      });
      await this.auditService.record({
        scope: 'PLATFORM',
        tenantId,
        actorType: 'PLATFORM_USER',
        actorPlatformUserId,
        action: AUDIT_ACTIONS.TENANT_DATABASE_FAILED,
        module: AUDIT_MODULES.TENANTS,
        entityType: 'TenantDatabase',
        entityId: tenantId,
        after: { operation: 'migrate', error: message },
      });
      throw error;
    }
  }

  /** Read-only cutover plan for moving an existing tenant to an enterprise store. */
  async planIsolationChange(
    tenantId: string,
    targetMode: TenantDataIsolationMode,
  ): Promise<TenantDataIsolationPlanDto> {
    const tenant = await this.platformPrisma.client.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const businessDataCounts = await this.countBusinessData(tenantId);
    const hasBusinessData = Object.values(businessDataCounts).some((count) => count > 0);

    return {
      tenantId,
      currentMode: tenant.dataIsolationMode,
      targetMode,
      // A tenant that already holds business data is never moved automatically — an operator
      // provisions the store and copies the rows during a maintenance window.
      requiresManualCutover: hasBusinessData,
      steps: [
        `Choose a target store name (schema or database) for tenant "${tenant.slug}".`,
        'Run POST /tenants/:id/database/provision after setting the isolation mode (empty tenants only).',
        hasBusinessData
          ? 'This tenant already holds data: provision the store, then copy its rows with your Postgres tooling during a maintenance window (the API will not move them automatically).'
          : 'This tenant holds no business data: it can be provisioned directly.',
        'Re-run POST /tenants/:id/database/migrate after each release that changes schema.prisma.',
      ],
      businessDataCounts,
    };
  }

  /**
   * Explicitly changes a tenant's isolation mode. SHARED -> enterprise is only allowed for a
   * tenant that holds no business data (see planIsolationChange); existing tenants are never
   * auto-migrated. enterprise -> SHARED simply stops routing to the store (the physical store is
   * left in place for the operator to reclaim).
   */
  async setDataIsolation(
    tenantId: string,
    dto: SetTenantDataIsolationDto,
    actorPlatformUserId: string,
  ): Promise<TenantDatabaseStatusDto> {
    const tenant = await this.platformPrisma.client.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    if (tenant.dataIsolationMode === dto.mode) {
      return this.getStatus(tenantId);
    }

    if (dto.mode === 'SHARED') {
      await this.platformPrisma.client.tenant.update({
        where: { id: tenantId },
        data: { dataIsolationMode: 'SHARED', updatedBy: actorPlatformUserId },
      });
      this.connection.remove(tenantId);
      await this.platformPrisma.client.tenantDatabase.deleteMany({ where: { tenantId } });
      // Drop the cached slug->tenant lookup so the new mode takes effect immediately rather than
      // after its TTL — otherwise the next request could still route to the old store.
      await this.tenantLookup.invalidate(tenant.slug);
      await this.recordIsolationChange(tenantId, tenant.dataIsolationMode, 'SHARED', actorPlatformUserId);
      return this.getStatus(tenantId);
    }

    // SHARED -> enterprise.
    this.assertIsolationEnabled();
    const businessDataCounts = await this.countBusinessData(tenantId);
    const hasBusinessData = Object.values(businessDataCounts).some((count) => count > 0);
    if (hasBusinessData) {
      throw new ConflictException({
        message:
          'This tenant already holds business data and cannot be moved automatically. Provision a store and copy its data manually during a maintenance window.',
        businessDataCounts,
      });
    }

    await this.platformPrisma.client.tenant.update({
      where: { id: tenantId },
      data: { dataIsolationMode: dto.mode, updatedBy: actorPlatformUserId },
    });
    await this.tenantLookup.invalidate(tenant.slug);
    await this.recordIsolationChange(tenantId, tenant.dataIsolationMode, dto.mode, actorPlatformUserId);
    return this.provisionForTenant(tenantId, actorPlatformUserId);
  }

  // --- Internals ---------------------------------------------------------------------------

  private async ensureTenantRow(
    client: ReturnType<typeof tenantPrismaClientPool.getClient>,
    tenant: TenantRow,
  ): Promise<void> {
    await client.tenant.upsert({
      where: { id: tenant.id },
      update: {
        slug: tenant.slug,
        name: tenant.name,
        status: tenant.status,
        billingEmail: tenant.billingEmail,
        timezone: tenant.timezone,
        dataIsolationMode: tenant.dataIsolationMode,
      },
      create: {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        status: tenant.status,
        billingEmail: tenant.billingEmail,
        timezone: tenant.timezone,
        dataIsolationMode: tenant.dataIsolationMode,
        createdBy: tenant.createdBy ?? undefined,
        createdAt: tenant.createdAt,
      },
    });
  }

  private async countBusinessData(tenantId: string): Promise<Record<string, number>> {
    const client = this.platformPrisma.client;
    const [users, roles, campuses, departments, programs, students, documents, notifications, integrations] =
      await Promise.all([
        client.user.count({ where: { tenantId } }),
        client.role.count({ where: { tenantId } }),
        client.campus.count({ where: { tenantId } }),
        client.department.count({ where: { tenantId } }),
        client.program.count({ where: { tenantId } }),
        client.student.count({ where: { tenantId } }),
        client.document.count({ where: { tenantId } }),
        client.notification.count({ where: { tenantId } }),
        client.integration.count({ where: { tenantId } }),
      ]);
    return { users, roles, campuses, departments, programs, students, documents, notifications, integrations };
  }

  private async recordIsolationChange(
    tenantId: string,
    from: TenantDataIsolationMode,
    to: TenantDataIsolationMode,
    actorPlatformUserId: string,
  ): Promise<void> {
    await this.auditService.record({
      scope: 'PLATFORM',
      tenantId,
      actorType: 'PLATFORM_USER',
      actorPlatformUserId,
      action: AUDIT_ACTIONS.TENANT_DATA_ISOLATION_CHANGED,
      module: AUDIT_MODULES.TENANTS,
      entityType: 'Tenant',
      entityId: tenantId,
      before: { dataIsolationMode: from },
      after: { dataIsolationMode: to },
    });
  }

  private assertIsolationEnabled(): void {
    if (!this.config.get('TENANT_DB_ISOLATION_ENABLED')) {
      throw new BadRequestException(
        'Enterprise database isolation is disabled (set TENANT_DB_ISOLATION_ENABLED=true).',
      );
    }
    if (!this.config.get('TENANT_DB_SECRET_KEY')) {
      throw new BadRequestException('TENANT_DB_SECRET_KEY is required for enterprise isolation.');
    }
  }

  private requireCipher(): TenantDatabaseSecretCipher {
    const key = this.config.get('TENANT_DB_SECRET_KEY');
    if (!key) throw new BadRequestException('TENANT_DB_SECRET_KEY is required for enterprise isolation.');
    return new TenantDatabaseSecretCipher(key);
  }

  private buildProvisioner(): TenantDatabaseProvisioner {
    return new TenantDatabaseProvisioner({
      sharedUrl: this.config.get('DATABASE_URL'),
      adminUrl: this.config.get('TENANT_DB_ADMIN_URL'),
      schemaPrefix: this.config.get('TENANT_DB_SCHEMA_PREFIX'),
      databasePrefix: this.config.get('TENANT_DB_DATABASE_PREFIX'),
      migrationMode: this.config.get('TENANT_DB_MIGRATION_MODE'),
      migrationExecutor: new PrismaCliMigrationExecutor({ schemaPath: this.resolveSchemaPath() }),
    });
  }

  private resolveSchemaPath(): string {
    const override = this.config.get('TENANT_DB_PRISMA_SCHEMA_PATH');
    if (override) return override;
    try {
      const pkgJson = require.resolve('@college-erp/database/package.json');
      return join(dirname(pkgJson), 'prisma', 'schema.prisma');
    } catch {
      return join(process.cwd(), 'packages', 'database', 'prisma', 'schema.prisma');
    }
  }
}
