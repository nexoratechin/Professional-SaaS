import { Injectable } from '@nestjs/common';
import { AUDIT_ACTIONS, AUDIT_MODULES } from '@college-erp/auth';
import type { TenantConfigurationDto } from '@college-erp/types';
import { PlatformPrismaService } from '../../common/prisma/platform-prisma.service';
import { AuditService } from '../audit/audit.service';
import type { UpdateTenantConfigurationDto } from './dto/update-tenant-configuration.dto';

/**
 * Tenant configuration engine — a single JSONB document per tenant (TenantConfiguration) holding
 * every configurable aspect of the institution: branding, academic calendar, grading scale,
 * attendance thresholds, fee heads/due dates/late-fee/concessions/refunds, admission fields and
 * document checklist, numbering formats, and certificate/notification templates.
 *
 * The document is created lazily (find-or-create) with an empty `{}` default, so a freshly
 * provisioned tenant needs no seed row. Writes are PATCH-style merges: only the sections present
 * in the DTO replace their current value; other sections survive untouched. Every write bumps the
 * version and records an audit entry.
 */
@Injectable()
export class TenantConfigurationService {
  constructor(
    private readonly platformPrisma: PlatformPrismaService,
    private readonly auditService: AuditService,
  ) {}

  private async findOrCreate(tenantId: string) {
    const existing = await this.platformPrisma.client.tenantConfiguration.findUnique({ where: { tenantId } });
    if (existing) {
      return existing;
    }
    return this.platformPrisma.client.tenantConfiguration.create({ data: { tenantId } });
  }

  async get(tenantId: string) {
    const row = await this.findOrCreate(tenantId);
    return this.toResponse(row.data as unknown as TenantConfigurationDto, row);
  }

  async update(tenantId: string, dto: UpdateTenantConfigurationDto, actorUserId: string) {
    const before = await this.findOrCreate(tenantId);
    const current = (before.data ?? {}) as Record<string, unknown>;

    const next: Record<string, unknown> = { ...current };
    for (const section of Object.keys(dto) as Array<keyof UpdateTenantConfigurationDto>) {
      const value = dto[section];
      if (value !== undefined) {
        next[section] = { ...((current[section] as Record<string, unknown>) ?? {}), ...(value as Record<string, unknown>) };
      }
    }

    const updated = await this.platformPrisma.client.tenantConfiguration.update({
      where: { id: before.id },
      data: {
        data: next as object,
        version: before.version + 1,
        updatedBy: actorUserId,
      },
    });

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.TENANT_CONFIGURATION_UPDATED,
      module: AUDIT_MODULES.TENANTS,
      entityType: 'TenantConfiguration',
      entityId: before.id,
      before: { version: before.version, sections: Object.keys(dto) },
      after: { version: updated.version, sections: Object.keys(dto) },
    });

    return this.toResponse(updated.data as unknown as TenantConfigurationDto, updated);
  }

  private toResponse(
    config: TenantConfigurationDto,
    row: { id: string; tenantId: string; version: number; updatedAt: Date },
  ) {
    return {
      id: row.id,
      tenantId: row.tenantId,
      version: row.version,
      config,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
