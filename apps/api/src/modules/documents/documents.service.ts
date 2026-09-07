import { Injectable, NotFoundException } from '@nestjs/common';
import { StorageService } from '../../common/storage/storage.service';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { AuditService } from '../audit/audit.service';
import type { ConfirmUploadDto } from './dto/confirm-upload.dto';
import type { RequestUploadUrlDto } from './dto/request-upload-url.dto';

@Injectable()
export class DocumentsService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly storage: StorageService,
    private readonly auditService: AuditService,
  ) {}

  async requestUpload(tenantId: string, dto: RequestUploadUrlDto, actorUserId: string) {
    const storageKey = this.storage.buildKey(tenantId, dto.category, dto.filename);

    const document = await this.tenantPrisma.client.document.create({
      data: {
        tenantId,
        category: dto.category,
        storageKey,
        originalFilename: dto.filename,
        mimeType: dto.mimeType,
        uploadedBy: actorUserId,
      },
    });

    const uploadUrl = await this.storage.getUploadUrl(tenantId, storageKey, dto.mimeType);

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: 'DOCUMENT_UPLOAD_REQUESTED',
      entityType: 'Document',
      entityId: document.id,
      after: { category: document.category, originalFilename: document.originalFilename },
    });

    return { document, uploadUrl };
  }

  async confirmUpload(tenantId: string, id: string, dto: ConfirmUploadDto, actorUserId: string) {
    const document = await this.findOwnedOrThrow(id);

    const updated = await this.tenantPrisma.client.document.update({
      where: { id },
      data: { status: 'UPLOADED', sizeBytes: dto.sizeBytes },
    });

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: 'DOCUMENT_UPLOAD_CONFIRMED',
      entityType: 'Document',
      entityId: document.id,
      after: { sizeBytes: dto.sizeBytes },
    });

    return updated;
  }

  async list() {
    return this.tenantPrisma.client.document.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getDownloadUrl(tenantId: string, id: string) {
    const document = await this.findOwnedOrThrow(id);
    const downloadUrl = await this.storage.getDownloadUrl(tenantId, document.storageKey);
    return { document, downloadUrl };
  }

  async remove(tenantId: string, id: string, actorUserId: string) {
    const document = await this.findOwnedOrThrow(id);

    await this.tenantPrisma.client.document.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.storage.delete(tenantId, document.storageKey);

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: 'DOCUMENT_DELETED',
      entityType: 'Document',
      entityId: document.id,
    });
  }

  /** Tenant-scoped lookup — a document id belonging to another tenant simply isn't found here
   * (the tenant-guard Prisma extension already scoped this query), so cross-tenant reads,
   * confirms, and deletes all fail the same safe way: 404, not a data leak. */
  private async findOwnedOrThrow(id: string) {
    const document = await this.tenantPrisma.client.document.findFirst({ where: { id, deletedAt: null } });
    if (!document) {
      throw new NotFoundException('Document not found.');
    }
    return document;
  }
}
