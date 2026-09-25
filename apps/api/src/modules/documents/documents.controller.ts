import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSION_KEYS, type AuthenticatedUser } from '@college-erp/auth';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { TenantMatchGuard } from '../../common/guards/tenant-match.guard';
import { TenantContextService } from '../../common/prisma/tenant-context.service';
import {
  CreateDocumentTypeDto,
  GrantDocumentAccessDto,
  ListDocumentsQueryDto,
  RejectDocumentDto,
  UpdateDocumentDto,
  UpdateDocumentTypeDto,
  UploadVersionDto,
  VerifyDocumentDto,
} from './dto/documents.dto';
import { ConfirmUploadDto } from './dto/confirm-upload.dto';
import { RequestUploadUrlDto } from './dto/request-upload-url.dto';
import { DocumentTypesService } from './document-types.service';
import { DocumentsService } from './documents.service';

/** Best-effort client IP from the raw request — Express populates `req.ip` from the socket or
 *  the nearest untrusted proxy. Behind our own reverse proxy, x-forwarded-for is appended by
 *  infra; recorded for the download ledger only, never trusted for access decisions. */
function clientMeta(req: Request): { ipAddress?: string; userAgent?: string } {
  const forwarded = Array.isArray(req.headers['x-forwarded-for'])
    ? req.headers['x-forwarded-for'][0]
    : req.headers['x-forwarded-for'];
  const ip = forwarded?.split(',')[0]?.trim() || req.ip;
  const userAgent = req.headers['user-agent'];
  return {
    ipAddress: ip || undefined,
    userAgent: typeof userAgent === 'string' ? userAgent : undefined,
  };
}

@ApiTags('documents')
@Controller('documents')
@UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard)
export class DocumentsController {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly tenantContext: TenantContextService,
  ) {}

  // ── Upload (new logical document) ─────────────────────────────────────────

  @Post('upload-url')
  @RequirePermission(PERMISSION_KEYS.DOCUMENTS_MANAGE)
  requestUpload(@Body() dto: RequestUploadUrlDto, @CurrentUser() user: AuthenticatedUser) {
    return this.documentsService.requestUpload(this.tenantContext.tenantId as string, dto, user.id);
  }

  @Post(':id/confirm-upload')
  @RequirePermission(PERMISSION_KEYS.DOCUMENTS_MANAGE)
  confirmUpload(@Param('id') id: string, @Body() dto: ConfirmUploadDto, @CurrentUser() user: AuthenticatedUser) {
    return this.documentsService.confirmUpload(this.tenantContext.tenantId as string, id, dto, user.id);
  }

  // ── Version replacement ────────────────────────────────────────────────────

  @Post(':id/versions/upload-url')
  @RequirePermission(PERMISSION_KEYS.DOCUMENTS_MANAGE)
  requestVersionUpload(
    @Param('id') id: string,
    @Body() dto: UploadVersionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documentsService.requestVersionUpload(this.tenantContext.tenantId as string, id, dto, user.id);
  }

  @Post(':id/versions/:versionId/confirm-upload')
  @RequirePermission(PERMISSION_KEYS.DOCUMENTS_MANAGE)
  confirmVersionUpload(
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Body() dto: ConfirmUploadDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documentsService.confirmVersionUpload(this.tenantContext.tenantId as string, id, versionId, dto, user.id);
  }

  // ── Query ──────────────────────────────────────────────────────────────────

  @Get()
  @RequirePermission(PERMISSION_KEYS.DOCUMENTS_VIEW)
  list(@Query() query: ListDocumentsQueryDto) {
    return this.documentsService.list(query);
  }

  @Get(':id')
  @RequirePermission(PERMISSION_KEYS.DOCUMENTS_VIEW)
  getOne(@Param('id') id: string) {
    return this.documentsService.getOne(this.tenantContext.tenantId as string, id);
  }

  // ── Review / lifecycle ─────────────────────────────────────────────────────

  @Post(':id/verify')
  @RequirePermission(PERMISSION_KEYS.DOCUMENTS_APPROVE)
  verify(@Param('id') id: string, @Body() dto: VerifyDocumentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.documentsService.verify(this.tenantContext.tenantId as string, id, dto, user.id);
  }

  @Post(':id/reject')
  @RequirePermission(PERMISSION_KEYS.DOCUMENTS_APPROVE)
  reject(@Param('id') id: string, @Body() dto: RejectDocumentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.documentsService.reject(this.tenantContext.tenantId as string, id, dto, user.id);
  }

  @Post(':id/expire')
  @RequirePermission(PERMISSION_KEYS.DOCUMENTS_MANAGE)
  expire(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.documentsService.expire(this.tenantContext.tenantId as string, id, user.id);
  }

  @Patch(':id')
  @RequirePermission(PERMISSION_KEYS.DOCUMENTS_MANAGE)
  update(@Param('id') id: string, @Body() dto: UpdateDocumentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.documentsService.update(this.tenantContext.tenantId as string, id, dto, user.id);
  }

  // ── Access grants ──────────────────────────────────────────────────────────

  @Post(':id/grants')
  @RequirePermission(PERMISSION_KEYS.DOCUMENTS_MANAGE)
  grantAccess(@Param('id') id: string, @Body() dto: GrantDocumentAccessDto, @CurrentUser() user: AuthenticatedUser) {
    return this.documentsService.grantAccess(this.tenantContext.tenantId as string, id, user.id, dto);
  }

  @Delete(':id/grants/:grantId')
  @RequirePermission(PERMISSION_KEYS.DOCUMENTS_MANAGE)
  revokeAccess(
    @Param('id') id: string,
    @Param('grantId') grantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documentsService.revokeAccess(this.tenantContext.tenantId as string, id, grantId, user.id);
  }

  @Get(':id/grants')
  @RequirePermission(PERMISSION_KEYS.DOCUMENTS_MANAGE)
  listAccessGrants(@Param('id') id: string) {
    return this.documentsService.listAccessGrants(this.tenantContext.tenantId as string, id);
  }

  // ── Download history ───────────────────────────────────────────────────────

  @Get(':id/download-history')
  @RequirePermission(PERMISSION_KEYS.DOCUMENTS_MANAGE)
  listDownloadHistory(
    @Param('id') id: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.documentsService.listDownloadHistory(
      this.tenantContext.tenantId as string,
      id,
      skip ? Number(skip) : 0,
      take ? Math.min(Number(take), 200) : 50,
    );
  }

  // ── Download ───────────────────────────────────────────────────────────────

  @Get(':id/download-url')
  @RequirePermission(PERMISSION_KEYS.DOCUMENTS_VIEW)
  getDownloadUrl(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.documentsService.getDownloadUrl(this.tenantContext.tenantId as string, id, user.id, clientMeta(req));
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  @Delete(':id')
  @RequirePermission(PERMISSION_KEYS.DOCUMENTS_MANAGE)
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.documentsService.remove(this.tenantContext.tenantId as string, id, user.id);
  }
}

/** Tenant-configurable document-type catalog — a separate resource so the UI can default its
 *  "Document type" pickers without one. Lives in the same module/guards as documents. */
@ApiTags('document-types')
@Controller('document-types')
@UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard)
export class DocumentTypesController {
  constructor(
    private readonly documentTypesService: DocumentTypesService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get()
  @RequirePermission(PERMISSION_KEYS.DOCUMENTS_VIEW)
  list() {
    return this.documentTypesService.list();
  }

  @Post()
  @RequirePermission(PERMISSION_KEYS.DOCUMENTS_MANAGE)
  create(@Body() dto: CreateDocumentTypeDto, @CurrentUser() user: AuthenticatedUser) {
    return this.documentTypesService.create(this.tenantContext.tenantId as string, user.id, dto);
  }

  @Patch(':id')
  @RequirePermission(PERMISSION_KEYS.DOCUMENTS_MANAGE)
  update(@Param('id') id: string, @Body() dto: UpdateDocumentTypeDto, @CurrentUser() user: AuthenticatedUser) {
    return this.documentTypesService.update(this.tenantContext.tenantId as string, user.id, id, dto);
  }

  @Delete(':id')
  @RequirePermission(PERMISSION_KEYS.DOCUMENTS_MANAGE)
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.documentTypesService.remove(this.tenantContext.tenantId as string, user.id, id);
  }
}