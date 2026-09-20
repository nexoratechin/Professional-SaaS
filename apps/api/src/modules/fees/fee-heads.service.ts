/**
 * Fee heads — the tenant's fee catalog. Codes are tenant-unique (including archived rows, so a
 * code can't be silently re-purposed). Amounts here are the catalog default; structures override
 * per-line. Snapshots (code/name) are dropped onto StudentFee lines at generation time so history
 * survives catalog edits. Deletion is a soft archive (deletedAt + isActive=false) to keep
 * generated structure/snapshots intact.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@college-erp/database';
import { AUDIT_MODULES } from '@college-erp/auth';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { AuditService } from '../audit/audit.service';
import { FEE_EVENTS } from './fees.constants';
import { CreateFeeHeadDto, ListFeeHeadQueryDto, UpdateFeeHeadDto } from './fees.dto';

type Client = PrismaClient;

@Injectable()
export class FeeHeadsService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditService: AuditService,
  ) {}

  private get client(): Client {
    return this.tenantPrisma.client as Client;
  }

  async list(tenantId: string, query: ListFeeHeadQueryDto) {
    const where = { tenantId, deletedAt: query.includeArchived ? undefined : null };
    const [rows, total] = await Promise.all([
      this.client.feeHead.findMany({
        where,
        include: { _count: { select: { structureLines: true } } },
        orderBy: [{ createdAt: 'asc' }],
        skip: query.skip ?? 0,
        take: query.take ?? 50,
      }),
      this.client.feeHead.count({ where }),
    ]);
    return { data: rows, total };
  }

  async get(tenantId: string, id: string) {
    const row = await this.client.feeHead.findFirst({ where: { id, tenantId, deletedAt: null } });
    if (!row) throw new NotFoundException('Fee head not found.');
    return row;
  }

  async create(tenantId: string, userId: string, dto: CreateFeeHeadDto) {
    const dup = await this.client.feeHead.findFirst({ where: { tenantId, code: dto.code } });
    if (dup) throw new BadRequestException(`A fee head with code '${dto.code}' already exists.`);

    const row = await this.client.feeHead.create({
      data: {
        tenantId,
        code: dto.code,
        name: dto.name,
        frequency: dto.frequency,
        defaultAmountCents: dto.defaultAmountCents,
        isOptional: dto.isOptional ?? false,
        isRefundable: dto.isRefundable ?? true,
        description: dto.description ?? null,
        createdBy: userId,
        updatedBy: userId,
      },
    });

    await this.auditService.record({
      scope: 'TENANT', tenantId, actorType: 'USER', actorUserId: userId,
      action: FEE_EVENTS.HEAD_CREATED, module: AUDIT_MODULES.FEES,
      entityType: 'FeeHead', entityId: row.id,
      after: { code: row.code, name: row.name, frequency: row.frequency, defaultAmountCents: row.defaultAmountCents },
    });
    return row;
  }

  async update(tenantId: string, userId: string, id: string, dto: UpdateFeeHeadDto) {
    const existing = await this.get(tenantId, id);
    if (dto.code && dto.code !== existing.code) {
      const dup = await this.client.feeHead.findFirst({ where: { tenantId, code: dto.code } });
      if (dup && dup.id !== id) throw new BadRequestException(`A fee head with code '${dto.code}' already exists.`);
    }
    const row = await this.client.feeHead.update({
      where: { id },
      data: { ...dto, updatedBy: userId },
    });
    await this.auditService.record({
      scope: 'TENANT', tenantId, actorType: 'USER', actorUserId: userId,
      action: FEE_EVENTS.HEAD_UPDATED, module: AUDIT_MODULES.FEES,
      entityType: 'FeeHead', entityId: id,
      before: { code: existing.code, name: existing.name, defaultAmountCents: existing.defaultAmountCents },
      after: dto as unknown as Record<string, unknown>,
    });
    return row;
  }

  async archive(tenantId: string, userId: string, id: string) {
    const existing = await this.get(tenantId, id);
    const row = await this.client.feeHead.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false, updatedBy: userId },
    });
    await this.auditService.record({
      scope: 'TENANT', tenantId, actorType: 'USER', actorUserId: userId,
      action: FEE_EVENTS.HEAD_ARCHIVED, module: AUDIT_MODULES.FEES,
      entityType: 'FeeHead', entityId: id,
      before: { isActive: existing.isActive },
      after: { isActive: row.isActive, deletedAt: row.deletedAt },
    });
    return { id, archived: true };
  }
}