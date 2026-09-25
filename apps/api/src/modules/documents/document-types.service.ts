import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AUDIT_ACTIONS, AUDIT_MODULES } from '@college-erp/auth';
import type { Prisma } from '@college-erp/database';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { AuditService } from '../audit/audit.service';
import type { CreateDocumentTypeDto, UpdateDocumentTypeDto } from './dto/documents.dto';

/** Tenant-configurable document-type catalog (codes unique per tenant, soft-deletable). */
@Injectable()
export class DocumentTypesService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list() {
    return this.tenantPrisma.client.documentType.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
    });
  }

  async create(tenantId: string, actorUserId: string, dto: CreateDocumentTypeDto) {
    const code = dto.code.trim().toUpperCase();
    const existing = await this.tenantPrisma.client.documentType.findFirst({
      where: { code, deletedAt: null },
    });
    if (existing) {
      throw new BadRequestException(`A document type with code "${code}" already exists.`);
    }

    const type = await this.tenantPrisma.client.documentType.create({
      data: {
        tenantId,
        code,
        name: dto.name,
        description: dto.description,
        allowedMimeTypes: (dto.allowedMimeTypes ?? undefined) as Prisma.InputJsonValue | undefined,
        allowedExtensions: (dto.allowedExtensions ?? undefined) as Prisma.InputJsonValue | undefined,
        maxSizeBytes: dto.maxSizeBytes,
        isSensitive: dto.isSensitive ?? false,
        canExpire: dto.canExpire ?? false,
        retentionDays: dto.retentionDays,
        isActive: dto.isActive ?? true,
        createdBy: actorUserId,
      },
    });

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.DOCUMENT_TYPE_CREATED,
      module: AUDIT_MODULES.DOCUMENTS,
      entityType: 'DocumentType',
      entityId: type.id,
      after: { code: type.code, name: type.name, maxSizeBytes: type.maxSizeBytes, retentionDays: type.retentionDays },
    });

    return type;
  }

  async update(tenantId: string, actorUserId: string, id: string, dto: UpdateDocumentTypeDto) {
    const type = await this.tenantPrisma.client.documentType.findFirst({ where: { id, deletedAt: null } });
    if (!type) {
      throw new NotFoundException('Document type not found.');
    }

    const updated = await this.tenantPrisma.client.documentType.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        allowedMimeTypes: (dto.allowedMimeTypes ?? undefined) as Prisma.InputJsonValue | undefined,
        allowedExtensions: (dto.allowedExtensions ?? undefined) as Prisma.InputJsonValue | undefined,
        maxSizeBytes: dto.maxSizeBytes,
        isSensitive: dto.isSensitive,
        canExpire: dto.canExpire,
        retentionDays: dto.retentionDays,
        isActive: dto.isActive,
        updatedBy: actorUserId,
      },
    });

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.DOCUMENT_TYPE_UPDATED,
      module: AUDIT_MODULES.DOCUMENTS,
      entityType: 'DocumentType',
      entityId: updated.id,
      after: {
        name: updated.name,
        maxSizeBytes: updated.maxSizeBytes,
        retentionDays: updated.retentionDays,
        isActive: updated.isActive,
      },
    });

    return updated;
  }

  /** Soft delete — historical documents keep resolving their type. */
  async remove(tenantId: string, actorUserId: string, id: string) {
    const type = await this.tenantPrisma.client.documentType.findFirst({ where: { id, deletedAt: null } });
    if (!type) {
      throw new NotFoundException('Document type not found.');
    }

    const updated = await this.tenantPrisma.client.documentType.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false, updatedBy: actorUserId },
    });

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.DOCUMENT_TYPE_DELETED,
      module: AUDIT_MODULES.DOCUMENTS,
      entityType: 'DocumentType',
      entityId: id,
      before: { code: type.code },
    });

    return updated;
  }
}