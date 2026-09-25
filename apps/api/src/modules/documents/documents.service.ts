import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { AUDIT_ACTIONS, AUDIT_MODULES, PERMISSION_KEYS } from '@college-erp/auth';
import type { Prisma } from '@college-erp/database';
import type { DocumentVirusScanJobData } from '@college-erp/types';
import { QUEUE_NAMES } from '@college-erp/types';
import { AppConfigService } from '../../config/app-config.service';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { PermissionsService } from '../rbac/permissions.service';
import type {
  GrantDocumentAccessDto,
  ListDocumentsQueryDto,
  RejectDocumentDto,
  RequestUploadUrlDto,
  UpdateDocumentDto,
  UploadVersionDto,
  VerifyDocumentDto,
} from './dto/documents.dto';
import type { ConfirmUploadDto } from './dto/confirm-upload.dto';

/** Lifecycle states that make a document's bytes unavailable for download or replacement. */
const BLOCKED_STATUSES = ['EXPIRED', 'QUARANTINED', 'REJECTED'] as const;
const REPLACE_BLOCKED_STATUSES = ['PENDING_UPLOAD', 'EXPIRED', 'QUARANTINED', 'REPLACED'] as const;

/** Shared relation loading for document reads (list / getOne / post-mutation responses). */
const documentIncludes = {
  documentType: { select: { id: true, code: true, name: true, isSensitive: true, canExpire: true } },
  currentVersion: { include: { documentCurrent: false } },
  versions: { orderBy: { versionNumber: 'desc' as const }, where: { deletedAt: null } },
} as const;

type ScopedDocument = Prisma.DocumentGetPayload<{ include: typeof documentIncludes }>;

/** Adds the access-grant ledger — only the download gate loads it, so list views stay lean. */
const downloadIncludes = {
  ...documentIncludes,
  accessGrants: { orderBy: { createdAt: 'desc' as const } },
} as const;

type ScopedDocumentWithGrants = Prisma.DocumentGetPayload<{ include: typeof downloadIncludes }>;

/** A signed download URL issued with its grant context — internal to the access checks. */
interface DownloadGrantContext {
  /** True when the caller may download (uploader, manager, or granted user/role). */
  allowed: boolean;
  reason?: string;
}

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly storage: StorageService,
    private readonly auditService: AuditService,
    private readonly permissionsService: PermissionsService,
    private readonly appConfig: AppConfigService,
    @InjectQueue(QUEUE_NAMES.DOCUMENT_VIRUS_SCAN)
    private readonly virusScanQueue: Queue<DocumentVirusScanJobData>,
  ) {}

  // ── Upload (new logical document) ──────────────────────────────────────────

  async requestUpload(tenantId: string, dto: RequestUploadUrlDto, actorUserId: string) {
    const documentType = dto.documentTypeId ? await this.resolveActiveType(dto.documentTypeId) : null;

    if (dto.expiresAt && documentType && !documentType.canExpire) {
      throw new BadRequestException(`Document type "${documentType.code}" does not allow expiry dates.`);
    }

    const category = dto.category?.trim() || documentType?.code || 'documents';
    this.assertMimeAllowed(documentType, dto.mimeType);
    this.assertExtensionAllowed(documentType, dto.filename);

    const storageKey = this.storage.buildKey(tenantId, category, dto.filename);
    const uploadUrl = await this.storage.getUploadUrl(tenantId, storageKey, dto.mimeType);

    const document = await this.tenantPrisma.client.document.create({
      data: {
        tenantId,
        documentTypeId: documentType?.id ?? null,
        category,
        title: dto.title?.trim() || dto.filename,
        description: dto.description,
        metadata: (dto.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        tags: dto.tags ?? [],
        storageKey,
        originalFilename: dto.filename,
        mimeType: dto.mimeType,
        uploadedBy: actorUserId,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        status: 'PENDING_UPLOAD',
      },
    });

    await this.createVersion(document.id, document.tenantId, actorUserId, {
      versionNumber: 1,
      storageKey,
      originalFilename: dto.filename,
      mimeType: dto.mimeType,
    });

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.DOCUMENT_UPLOAD_REQUESTED,
      module: AUDIT_MODULES.DOCUMENTS,
      entityType: 'Document',
      entityId: document.id,
      after: {
        category,
        originalFilename: document.originalFilename,
        mimeType: document.mimeType,
        documentTypeId: documentType?.id ?? null,
      },
    });

    // Keep the original `{ document: { id }, uploadUrl }` shape (helpdesk) plus the extended id.
    return { document: { id: document.id }, uploadUrl, documentId: document.id };
  }

  /** Validates the uploaded bytes against storage (HEAD) + the type's size/MIME policy, computes
   *  SHA-256, confirms the version, and enqueues the virus scan. */
  async confirmUpload(tenantId: string, id: string, _dto: ConfirmUploadDto, actorUserId: string) {
    const document = await this.findOwnedOrThrow(id);

    if (document.status !== 'PENDING_UPLOAD') {
      throw new ConflictException('This document has already been confirmed.');
    }

    const version = await this.tenantPrisma.client.documentVersion.findFirst({
      where: { documentId: id, deletedAt: null },
      orderBy: { versionNumber: 'desc' },
    });
    if (!version) {
      throw new NotFoundException('Pending upload not found for this document.');
    }

    const validation = await this.validateStoredObject(tenantId, document, version);
    const scanQueued = await this.queueScan(tenantId, document.id, version.id);

    await this.tenantPrisma.client.document.update({
      where: { id: document.id },
      data: {
        status: scanQueued ? 'AWAITING_SCAN' : 'UPLOADED',
        currentVersionId: version.id,
        storageKey: version.storageKey,
        originalFilename: version.originalFilename,
        mimeType: version.mimeType,
        sizeBytes: validation.sizeBytes,
        uploadedBy: actorUserId,
      },
    });

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.DOCUMENT_UPLOAD_CONFIRMED,
      module: AUDIT_MODULES.DOCUMENTS,
      entityType: 'Document',
      entityId: document.id,
      after: {
        sizeBytes: validation.sizeBytes,
        sha256: validation.sha256,
        versionId: version.id,
        scanQueued,
      },
    });

    return this.getOne(tenantId, document.id);
  }

  // ── Version replacement ────────────────────────────────────────────────────

  /** Issues a fresh, empty version slot for uploading a replacement file. The new version only
   *  becomes the document's currentVersion when its confirm-upload passes validation + scan. */
  async requestVersionUpload(tenantId: string, id: string, dto: UploadVersionDto, actorUserId: string) {
    const document = await this.findOwnedOrThrow(id);
    if (REPLACE_BLOCKED_STATUSES.includes(document.status as (typeof REPLACE_BLOCKED_STATUSES)[number])) {
      throw new BadRequestException(
        `A document in status "${document.status}" cannot be replaced.`,
      );
    }

    const documentType = document.documentTypeId ? await this.resolveActiveType(document.documentTypeId) : null;
    this.assertMimeAllowed(documentType, dto.mimeType);
    this.assertExtensionAllowed(documentType, dto.filename);

    const latest = await this.tenantPrisma.client.documentVersion.findFirst({
      where: { documentId: id, deletedAt: null },
      orderBy: { versionNumber: 'desc' },
    });
    const versionNumber = (latest?.versionNumber ?? 0) + 1;
    const storageKey = this.storage.buildKey(tenantId, document.category, dto.filename);

    const version = await this.createVersion(document.id, tenantId, actorUserId, {
      versionNumber,
      storageKey,
      originalFilename: dto.filename,
      mimeType: dto.mimeType,
    });

    const uploadUrl = await this.storage.getUploadUrl(tenantId, storageKey, dto.mimeType);

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.DOCUMENT_UPLOAD_REQUESTED,
      module: AUDIT_MODULES.DOCUMENTS,
      entityType: 'DocumentVersion',
      entityId: version.id,
      after: { documentId: document.id, versionNumber, originalFilename: dto.filename },
    });

    return { documentId: document.id, versionId: version.id, uploadUrl };
  }

  async confirmVersionUpload(tenantId: string, id: string, versionId: string, _dto: unknown, actorUserId: string) {
    const document = await this.findOwnedOrThrow(id);
    if (REPLACE_BLOCKED_STATUSES.includes(document.status as (typeof REPLACE_BLOCKED_STATUSES)[number])) {
      throw new BadRequestException(`A document in status "${document.status}" cannot be replaced.`);
    }

    const version = await this.tenantPrisma.client.documentVersion.findFirst({
      where: { id: versionId, documentId: id, deletedAt: null },
    });
    if (!version) throw new NotFoundException('Version not found for this document.');

    const latest = await this.tenantPrisma.client.documentVersion.findFirst({
      where: { documentId: id, deletedAt: null },
      orderBy: { versionNumber: 'desc' },
    });
    if (!latest || latest.id !== version.id) {
      throw new BadRequestException('Only the latest pending version can be confirmed.');
    }
    if (version.confirmedAt) {
      throw new ConflictException('This version has already been confirmed.');
    }

    const validation = await this.validateStoredObject(tenantId, document, version);
    const scanQueued = await this.queueScan(tenantId, document.id, version.id);

    await this.tenantPrisma.client.$transaction([
      // Supersede every previous version (kept for history).
      this.tenantPrisma.client.documentVersion.updateMany({
        where: { documentId: id, versionNumber: { lt: version.versionNumber } },
        data: { replacedByVersionId: version.id },
      }),
      this.tenantPrisma.client.documentVersion.update({
        where: { id: version.id },
        data: { sha256: validation.sha256, sizeBytes: validation.sizeBytes, confirmedAt: new Date() },
      }),
      this.tenantPrisma.client.document.update({
        where: { id: document.id },
        data: {
          status: scanQueued ? 'AWAITING_SCAN' : 'UPLOADED',
          currentVersionId: version.id,
          storageKey: version.storageKey,
          originalFilename: version.originalFilename,
          mimeType: version.mimeType,
          sizeBytes: validation.sizeBytes,
          uploadedBy: actorUserId,
          // A replacement invalidates any prior verification — reviewer must re-verify.
          verifiedBy: null,
          verifiedAt: null,
          verificationNote: null,
        },
      }),
    ]);

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.DOCUMENT_VERSION_UPLOADED,
      module: AUDIT_MODULES.DOCUMENTS,
      entityType: 'DocumentVersion',
      entityId: version.id,
      after: {
        documentId: document.id,
        versionNumber: version.versionNumber,
        sizeBytes: validation.sizeBytes,
        sha256: validation.sha256,
        scanQueued,
      },
    });

    return this.getOne(tenantId, document.id);
  }

  // ── Query ──────────────────────────────────────────────────────────────────

  async list(query: ListDocumentsQueryDto) {
    const where: Prisma.DocumentWhereInput = {
      deletedAt: null,
      ...(query.category ? { category: query.category } : {}),
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.documentTypeId ? { documentTypeId: query.documentTypeId } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' as const } },
              { originalFilename: { contains: query.search, mode: 'insensitive' as const } },
              ...(query.search.trim().length ? [{ description: { contains: query.search, mode: 'insensitive' as const } }] : []),
            ],
          }
        : {}),
    };
    const skip = query.skip ?? 0;
    const take = query.take ?? 50;

    const [data, total] = await this.tenantPrisma.client.$transaction([
      this.tenantPrisma.client.document.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: documentIncludes,
      }),
      this.tenantPrisma.client.document.count({ where }),
    ]);

    return { data, total };
  }

  async getOne(tenantId: string, id: string) {
    return this.findOwnedOrThrow(id, documentIncludes);
  }

  // ── Review / lifecycle ─────────────────────────────────────────────────────

  async verify(tenantId: string, id: string, dto: VerifyDocumentDto, actorUserId: string) {
    const document = await this.findOwnedOrThrow(id);
    if (document.status !== 'READY') {
      throw new BadRequestException('Only a scanned-clean (READY) document can be verified.');
    }

    const updated = await this.tenantPrisma.client.document.update({
      where: { id: document.id },
      data: {
        status: 'VERIFIED',
        verifiedBy: actorUserId,
        verifiedAt: new Date(),
        verificationNote: dto.note ?? null,
        rejectedBy: null,
        rejectedAt: null,
        rejectionReason: null,
      },
    });

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.DOCUMENT_VERIFIED,
      module: AUDIT_MODULES.DOCUMENTS,
      entityType: 'Document',
      entityId: document.id,
      after: { note: dto.note ?? null, title: document.title },
    });

    return this.findOwnedOrThrow(updated.id, documentIncludes);
  }

  async reject(tenantId: string, id: string, dto: RejectDocumentDto, actorUserId: string) {
    const document = await this.findOwnedOrThrow(id);
    if (BLOCKED_STATUSES.includes(document.status as (typeof BLOCKED_STATUSES)[number])) {
      throw new BadRequestException(`A document in status "${document.status}" cannot be rejected again.`);
    }
    if (document.status === 'PENDING_UPLOAD') {
      throw new BadRequestException('Nothing has been uploaded yet — nothing to reject.');
    }

    const updated = await this.tenantPrisma.client.document.update({
      where: { id: document.id },
      data: {
        status: 'REJECTED',
        rejectedBy: actorUserId,
        rejectedAt: new Date(),
        rejectionReason: dto.reason,
        verifiedBy: null,
        verifiedAt: null,
        verificationNote: null,
      },
    });

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.DOCUMENT_REJECTED,
      module: AUDIT_MODULES.DOCUMENTS,
      entityType: 'Document',
      entityId: document.id,
      after: { reason: dto.reason, title: document.title },
    });

    return this.findOwnedOrThrow(updated.id, documentIncludes);
  }

  /** Explicit expiry (the retention sweep does the same thing in the background). Removes the
   *  current version's object from storage and flips the document to EXPIRED. */
  async expire(tenantId: string, id: string, actorUserId: string) {
    const document = await this.findOwnedOrThrow(id);
    if (document.status === 'EXPIRED') {
      throw new BadRequestException('This document is already expired.');
    }

    const currentVersion = document.currentVersionId
      ? await this.tenantPrisma.client.documentVersion.findFirst({ where: { id: document.currentVersionId } })
      : null;
    if (currentVersion?.storageKey) {
      await this.storage.delete(tenantId, currentVersion.storageKey);
    }

    const updated = await this.tenantPrisma.client.document.update({
      where: { id: document.id },
      data: { status: 'EXPIRED', expiredAt: new Date() },
    });

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.DOCUMENT_EXPIRED,
      module: AUDIT_MODULES.DOCUMENTS,
      entityType: 'Document',
      entityId: document.id,
      after: { title: document.title, removedObjectKey: currentVersion?.storageKey ?? null },
    });

    return this.findOwnedOrThrow(updated.id, documentIncludes);
  }

  async update(tenantId: string, id: string, dto: UpdateDocumentDto, actorUserId: string) {
    const document = await this.findOwnedOrThrow(id);
    if (dto.expiresAt && !dto.expiresAtCleared) {
      const documentType = document.documentTypeId ? await this.resolveActiveType(document.documentTypeId) : null;
      if (documentType && !documentType.canExpire) {
        throw new BadRequestException(`Document type "${documentType.code}" does not allow expiry dates.`);
      }
    }

    const updated = await this.tenantPrisma.client.document.update({
      where: { id: document.id },
      data: {
        title: dto.title,
        description: dto.description,
        metadata: (dto.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        tags: dto.tags,
        expiresAt: dto.expiresAtCleared ? null : dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      },
    });

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.DOCUMENT_UPDATED,
      module: AUDIT_MODULES.DOCUMENTS,
      entityType: 'Document',
      entityId: document.id,
      after: {
        title: updated.title,
        description: updated.description,
        tags: updated.tags,
        expiresAt: updated.expiresAt,
      },
    });

    return this.findOwnedOrThrow(updated.id, documentIncludes);
  }

  // ── Access grants ──────────────────────────────────────────────────────────

  async grantAccess(tenantId: string, id: string, actorUserId: string, dto: GrantDocumentAccessDto) {
    const document = await this.findOwnedOrThrow(id);

    if (dto.granteeType === 'USER') {
      if (!dto.granteeUserId) throw new BadRequestException('granteeUserId is required for a USER grant.');
      const user = await this.tenantPrisma.client.user.findFirst({ where: { id: dto.granteeUserId } });
      if (!user) throw new NotFoundException('User not found in this tenant.');
    } else {
      if (!dto.granteeRoleId) throw new BadRequestException('granteeRoleId is required for a ROLE grant.');
      const role = await this.tenantPrisma.client.role.findFirst({ where: { id: dto.granteeRoleId, deletedAt: null } });
      if (!role) throw new NotFoundException('Role not found in this tenant.');
    }

    // The compound unique key requires both grantee ids — match via find-then-write so a
    // USER/ROLE grant with a null peer id still hits the existing row (the PG unique
    // constraint treats NULLs as distinct, so upsert-where on it can never match).
    const existing = await (dto.granteeType === 'USER'
      ? this.tenantPrisma.client.documentAccessGrant.findFirst({
          where: { documentId: id, granteeType: 'USER', granteeUserId: dto.granteeUserId as string },
        })
      : this.tenantPrisma.client.documentAccessGrant.findFirst({
          where: { documentId: id, granteeType: 'ROLE', granteeRoleId: dto.granteeRoleId as string },
        }));

    const grant = existing
      ? await this.tenantPrisma.client.documentAccessGrant.update({
          where: { id: existing.id },
          data: { canView: dto.canView ?? true, canDownload: dto.canDownload ?? true, grantedBy: actorUserId },
        })
      : await this.tenantPrisma.client.documentAccessGrant.create({
          data: {
            tenantId,
            documentId: id,
            granteeType: dto.granteeType,
            granteeUserId: dto.granteeUserId ?? null,
            granteeRoleId: dto.granteeRoleId ?? null,
            canView: dto.canView ?? true,
            canDownload: dto.canDownload ?? true,
            grantedBy: actorUserId,
          },
        });

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.DOCUMENT_ACCESS_GRANTED,
      module: AUDIT_MODULES.DOCUMENTS,
      entityType: 'Document',
      entityId: document.id,
      after: {
        grantId: grant.id,
        granteeType: grant.granteeType,
        granteeUserId: grant.granteeUserId,
        granteeRoleId: grant.granteeRoleId,
        canView: grant.canView,
        canDownload: grant.canDownload,
      },
    });

    return grant;
  }

  async revokeAccess(tenantId: string, id: string, grantId: string, actorUserId: string) {
    const document = await this.findOwnedOrThrow(id);
    const grant = await this.tenantPrisma.client.documentAccessGrant.findFirst({
      where: { id: grantId, documentId: id },
    });
    if (!grant) throw new NotFoundException('Access grant not found for this document.');

    await this.tenantPrisma.client.documentAccessGrant.delete({ where: { id: grant.id } });

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.DOCUMENT_ACCESS_REVOKED,
      module: AUDIT_MODULES.DOCUMENTS,
      entityType: 'Document',
      entityId: document.id,
      after: { grantId: grant.id, granteeType: grant.granteeType, granteeUserId: grant.granteeUserId, granteeRoleId: grant.granteeRoleId },
    });
  }

  async listAccessGrants(tenantId: string, id: string) {
    const document = await this.findOwnedOrThrow(id);
    return this.tenantPrisma.client.documentAccessGrant.findMany({
      where: { documentId: document.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── Download history ───────────────────────────────────────────────────────

  async listDownloadHistory(tenantId: string, id: string, skip = 0, take = 50) {
    const document = await this.findOwnedOrThrow(id);
    const [data, total] = await this.tenantPrisma.client.$transaction([
      this.tenantPrisma.client.documentDownloadLog.findMany({
        where: { documentId: document.id },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.tenantPrisma.client.documentDownloadLog.count({ where: { documentId: document.id } }),
    ]);
    return { data, total };
  }

  // ── Download ───────────────────────────────────────────────────────────────

  /** Gates + signs a download URL. Recorded in DocumentDownloadLog + the immutable audit trail.
   *  Access rules: uploader, a DOCUMENTS_MANAGE holder, or an explicit grant (user or one of the
   *  caller's roles). Downloads are blocked for EXPIRED/QUARANTINED/REJECTED documents and for
   *  versions whose scan found an infection. */
  async getDownloadUrl(
    tenantId: string,
    id: string,
    actorUserId: string,
    meta: { ipAddress?: string; userAgent?: string },
  ) {
    const document = await this.findOwnedOrThrow(id, downloadIncludes);

    if (BLOCKED_STATUSES.includes(document.status as (typeof BLOCKED_STATUSES)[number])) {
      throw new ForbiddenException(`This document is ${document.status.toLowerCase() } and no longer downloadable.`);
    }

    const currentVersion = document.currentVersion;
    if (currentVersion?.scanStatus === 'INFECTED') {
      throw new ForbiddenException('This document was quarantined after a virus scan and is not downloadable.');
    }

    const permitted = await this.resolveDownloadAccess(tenantId, document, actorUserId);
    if (!permitted.allowed) {
      throw new ForbiddenException(permitted.reason ?? 'You do not have access to download this document.');
    }

    const versionForKey = currentVersion ?? (document.versions && document.versions[0]);
    if (!versionForKey?.storageKey) {
      throw new NotFoundException('This document has no uploaded file yet.');
    }

    const downloadUrl = await this.storage.getDownloadUrl(tenantId, versionForKey.storageKey, {
      filename: versionForKey.originalFilename,
      contentType: versionForKey.mimeType ?? undefined,
    });

    await this.tenantPrisma.client.documentDownloadLog.create({
      data: {
        tenantId,
        documentId: document.id,
        versionId: versionForKey.id,
        downloadedBy: actorUserId,
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent ?? null,
      },
    });

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.DOCUMENT_DOWNLOADED,
      module: AUDIT_MODULES.DOCUMENTS,
      entityType: 'Document',
      entityId: document.id,
      after: {
        title: document.title,
        versionId: versionForKey.id,
        versionNumber: versionForKey.versionNumber,
        originalFilename: versionForKey.originalFilename,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { document: { id: document.id, title: document.title }, downloadUrl };
  }

  /** Legacy delete: soft-deletes the row and removes the current object from storage. New
   *  centralized flows prefer REJECTED/EXPIRED lifecycle states, which keep an audit trail. */
  async remove(tenantId: string, id: string, actorUserId: string) {
    const document = await this.findOwnedOrThrow(id);
    const currentVersion = document.currentVersionId
      ? await this.tenantPrisma.client.documentVersion.findFirst({ where: { id: document.currentVersionId } })
      : null;

    await this.tenantPrisma.client.document.update({ where: { id }, data: { deletedAt: new Date() } });
    if (currentVersion?.storageKey) {
      await this.storage.delete(tenantId, currentVersion.storageKey);
    }

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.DOCUMENT_DELETED,
      module: AUDIT_MODULES.DOCUMENTS,
      entityType: 'Document',
      entityId: document.id,
      after: { title: document.title },
    });
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async createVersion(
    documentId: string,
    tenantId: string,
    actorUserId: string,
    data: { versionNumber: number; storageKey: string; originalFilename: string; mimeType: string },
  ) {
    return this.tenantPrisma.client.documentVersion.create({
      data: {
        tenantId,
        documentId,
        ...data,
        scanStatus: 'PENDING',
        uploadedBy: actorUserId,
      },
    });
  }

  /** HEAD the stored object, enforce the type/global size + MIME policy, and fingerprint the
   *  bytes. On a policy violation the object is removed and the version is marked for rescan. */
  private async validateStoredObject(
    tenantId: string,
    document: { id: string; tenantId: string; documentTypeId: string | null },
    version: { id: string; storageKey: string; mimeType: string; originalFilename: string },
  ) {
    if (!(await this.storage.objectExists(tenantId, version.storageKey))) {
      throw new BadRequestException('File was not uploaded — PUT the file to the signed upload URL before confirming.');
    }

    const meta = await this.storage.getObjectMetadata(tenantId, version.storageKey);
    const documentType = document.documentTypeId ? await this.resolveActiveType(document.documentTypeId) : null;

    const maxSize =
      documentType?.maxSizeBytes ?? this.appConfig.get('DOCUMENT_MAX_UPLOAD_SIZE_BYTES');
    if (meta.sizeBytes > maxSize) {
      await this.storage.delete(tenantId, version.storageKey);
      throw new BadRequestException(
        `File is ${meta.sizeBytes} bytes — exceeds the maximum allowed size of ${maxSize} bytes for this document type.`,
      );
    }

    this.assertMimeAllowed(documentType, meta.contentType ?? version.mimeType);

    const sha256 = await this.storage.computeObjectSha256(tenantId, version.storageKey);
    return { sizeBytes: meta.sizeBytes, sha256 };
  }

  /** New uploads enqueue a document-virus-scan job; the worker flips the version CLEAN and the
   *  document READY (or QUARANTINED on a hit). Enqueue failures are non-fatal — the document
   *  stays UPLOADED, still downloadable, and visible as not-yet-scanned. */
  private async queueScan(tenantId: string, documentId: string, versionId: string): Promise<boolean> {
    try {
      await this.virusScanQueue.add(
        'scan',
        { tenantId, documentId, versionId },
        { attempts: 3, backoff: { type: 'exponential', delay: 2_000 }, removeOnComplete: 1_000, removeOnFail: 5_000 },
      );
      return true;
    } catch (err) {
      this.logger.error(`Failed to enqueue virus scan for document ${documentId} version ${versionId}: ${String(err)}`);
      return false;
    }
  }

  private async resolveActiveType(id: string) {
    const documentType = await this.tenantPrisma.client.documentType.findFirst({
      where: { id, deletedAt: null, isActive: true },
    });
    if (!documentType) {
      throw new BadRequestException('Document type not found or inactive.');
    }
    return documentType;
  }

  private assertMimeAllowed(documentType: { allowedMimeTypes: Prisma.JsonValue } | null, mimeType: string) {
    if (!documentType?.allowedMimeTypes || !Array.isArray(documentType.allowedMimeTypes)) return;
    const allowed = documentType.allowedMimeTypes as string[];
    const normalized = (mimeType.split(';')[0] ?? mimeType).trim().toLowerCase();
    if (!allowed.some((entry) => entry.toLowerCase() === normalized)) {
      throw new BadRequestException(`MIME type "${mimeType}" is not allowed for this document type.`);
    }
  }

  private assertExtensionAllowed(documentType: { allowedExtensions: Prisma.JsonValue } | null, filename: string) {
    if (!documentType?.allowedExtensions || !Array.isArray(documentType.allowedExtensions)) return;
    const allowed = documentType.allowedExtensions as string[];
    const dot = filename.lastIndexOf('.');
    const ext = dot >= 0 ? filename.slice(dot + 1).toLowerCase() : '';
    if (!allowed.some((entry) => entry.toLowerCase() === ext)) {
      throw new BadRequestException(`File extension ".${ext}" is not allowed for this document type.`);
    }
  }

  /** Uploader, DOCUMENTS_MANAGE holders, and explicit grants (user or caller's roles) may
   *  download. Everything else is denied — documents are private by default. */
  private async resolveDownloadAccess(
    tenantId: string,
    document: {
      uploadedBy: string | null;
      accessGrants: Array<{
        granteeType: 'USER' | 'ROLE';
        granteeUserId: string | null;
        granteeRoleId: string | null;
        canDownload: boolean;
      }>;
    },
    actorUserId: string,
  ): Promise<DownloadGrantContext> {
    if (document.uploadedBy === actorUserId) return { allowed: true };

    const effective = await this.permissionsService.getEffectivePermissions(tenantId, actorUserId);
    if (effective.includes(PERMISSION_KEYS.DOCUMENTS_MANAGE)) return { allowed: true };

    // Explicit grants: a direct USER grant targeting the caller, or a ROLE grant for a role the
    // caller holds (only grants that actually permit downloading count).
    const roleIds = await this.tenantPrisma.client.userRole
      .findMany({
        where: { userId: actorUserId, role: { deletedAt: null } },
        select: { roleId: true },
      })
      .then((rows) => rows.map((r) => r.roleId));

    for (const grant of document.accessGrants) {
      if (!grant.canDownload) continue;
      if (grant.granteeType === 'USER' && grant.granteeUserId === actorUserId) return { allowed: true };
      if (grant.granteeType === 'ROLE' && grant.granteeRoleId && roleIds.includes(grant.granteeRoleId)) {
        return { allowed: true };
      }
    }

    return {
      allowed: false,
      reason: 'You do not have permission to download this document. Ask the document owner to grant you access.',
    };
  }

  /** Tenant-scoped lookup — a document id belonging to another tenant simply isn't found here
   *  (the tenant-guard Prisma extension already scoped this query), so cross-tenant reads,
   *  confirms, and deletes all fail the same safe way: 404, not a data leak. The overloads
   *  pin the include (and therefore the returned relation shape) per call site. */
  private findOwnedOrThrow(id: string, include: typeof downloadIncludes): Promise<ScopedDocumentWithGrants>;
  private findOwnedOrThrow(id: string, include?: typeof documentIncludes): Promise<ScopedDocument>;
  private async findOwnedOrThrow(id: string, include?: typeof documentIncludes | typeof downloadIncludes) {
    const document = await this.tenantPrisma.client.document.findFirst({
      where: { id, deletedAt: null },
      include,
    });
    if (!document) {
      throw new NotFoundException('Document not found.');
    }
    return document;
  }
}