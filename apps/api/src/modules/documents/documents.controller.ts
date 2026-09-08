import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSION_KEYS } from '@college-erp/auth';
import type { AuthenticatedUser } from '@college-erp/auth';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { TenantMatchGuard } from '../../common/guards/tenant-match.guard';
import { TenantContextService } from '../../common/prisma/tenant-context.service';
import { ConfirmUploadDto } from './dto/confirm-upload.dto';
import { RequestUploadUrlDto } from './dto/request-upload-url.dto';
import { DocumentsService } from './documents.service';

@ApiTags('documents')
@Controller('documents')
@UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard)
export class DocumentsController {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly tenantContext: TenantContextService,
  ) {}

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

  @Get()
  @RequirePermission(PERMISSION_KEYS.DOCUMENTS_VIEW)
  list() {
    return this.documentsService.list();
  }

  @Get(':id/download-url')
  @RequirePermission(PERMISSION_KEYS.DOCUMENTS_VIEW)
  getDownloadUrl(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.documentsService.getDownloadUrl(this.tenantContext.tenantId as string, id, user.id);
  }

  @Delete(':id')
  @RequirePermission(PERMISSION_KEYS.DOCUMENTS_MANAGE)
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.documentsService.remove(this.tenantContext.tenantId as string, id, user.id);
  }
}
