import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSION_KEYS, type AuthenticatedUser } from '@college-erp/auth';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { TenantMatchGuard } from '../../common/guards/tenant-match.guard';
import { TenantContextService } from '../../common/prisma/tenant-context.service';
import {
  CreateCertificateTemplateDto,
  GenerateCertificateDto,
  ListCertificatesQueryDto,
  ListTemplatesQueryDto,
  ReissueCertificateDto,
  RejectCertificateDto,
  RequestCertificateDto,
  RevokeCertificateDto,
  UpdateCertificateTemplateDto,
} from './dto/certificates.dto';
import { CertificatesService } from './certificates.service';

@ApiTags('certificates')
@Controller('certificates')
@UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard)
export class CertificatesController {
  constructor(
    private readonly certificatesService: CertificatesService,
    private readonly tenantContext: TenantContextService,
  ) {}

  // ── Templates ─────────────────────────────────────────────────────────────

  @Get('templates')
  @RequirePermission(PERMISSION_KEYS.CERTIFICATES_VIEW)
  listTemplates(@Query() query: ListTemplatesQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.certificatesService.listTemplates(this.tenantContext.tenantId as string, user.id, query);
  }

  @Get('templates/:id')
  @RequirePermission(PERMISSION_KEYS.CERTIFICATES_VIEW)
  getTemplate(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.certificatesService.getTemplate(this.tenantContext.tenantId as string, user.id, id);
  }

  @Post('templates')
  @RequirePermission(PERMISSION_KEYS.CERTIFICATES_MANAGE)
  createTemplate(@Body() dto: CreateCertificateTemplateDto, @CurrentUser() user: AuthenticatedUser) {
    return this.certificatesService.createTemplate(this.tenantContext.tenantId as string, user.id, dto);
  }

  @Patch('templates/:id')
  @RequirePermission(PERMISSION_KEYS.CERTIFICATES_MANAGE)
  updateTemplate(@Param('id') id: string, @Body() dto: UpdateCertificateTemplateDto, @CurrentUser() user: AuthenticatedUser) {
    return this.certificatesService.updateTemplate(this.tenantContext.tenantId as string, user.id, id, dto);
  }

  @Post('templates/:id/archive')
  @RequirePermission(PERMISSION_KEYS.CERTIFICATES_MANAGE)
  archiveTemplate(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.certificatesService.archiveTemplate(this.tenantContext.tenantId as string, user.id, id);
  }

  @Delete('templates/:id')
  @RequirePermission(PERMISSION_KEYS.CERTIFICATES_MANAGE)
  deleteTemplate(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.certificatesService.deleteTemplate(this.tenantContext.tenantId as string, user.id, id);
  }

  // ── Certificates ──────────────────────────────────────────────────────────

  @Get('export')
  @RequirePermission(PERMISSION_KEYS.CERTIFICATES_EXPORT)
  export(@Query() query: ListCertificatesQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.certificatesService.exportCertificates(this.tenantContext.tenantId as string, user.id, query);
  }

  @Get()
  @RequirePermission(PERMISSION_KEYS.CERTIFICATES_VIEW)
  listCertificates(@Query() query: ListCertificatesQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.certificatesService.listCertificates(this.tenantContext.tenantId as string, user.id, query);
  }

  @Get(':id')
  @RequirePermission(PERMISSION_KEYS.CERTIFICATES_VIEW)
  getCertificate(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.certificatesService.getCertificate(this.tenantContext.tenantId as string, user.id, id);
  }

  @Get(':id/download-url')
  @RequirePermission(PERMISSION_KEYS.CERTIFICATES_VIEW)
  getDownloadUrl(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.certificatesService.getDownloadUrl(this.tenantContext.tenantId as string, user.id, id);
  }

  @Post()
  @RequirePermission(PERMISSION_KEYS.CERTIFICATES_CREATE)
  request(@Body() dto: RequestCertificateDto, @CurrentUser() user: AuthenticatedUser) {
    return this.certificatesService.request(this.tenantContext.tenantId as string, user.id, dto);
  }

  @Post(':id/generate')
  @RequirePermission(PERMISSION_KEYS.CERTIFICATES_CREATE)
  generate(
    @Param('id') id: string,
    @Body() dto: GenerateCertificateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.certificatesService.generate(this.tenantContext.tenantId as string, user.id, id, dto);
  }

  @Post(':id/approve')
  @RequirePermission(PERMISSION_KEYS.CERTIFICATES_APPROVE)
  approve(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.certificatesService.approve(this.tenantContext.tenantId as string, user.id, id);
  }

  @Post(':id/issue')
  @RequirePermission(PERMISSION_KEYS.CERTIFICATES_APPROVE)
  issue(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.certificatesService.issue(this.tenantContext.tenantId as string, user.id, id);
  }

  @Post(':id/reject')
  @RequirePermission(PERMISSION_KEYS.CERTIFICATES_APPROVE)
  reject(@Param('id') id: string, @Body() dto: RejectCertificateDto, @CurrentUser() user: AuthenticatedUser) {
    return this.certificatesService.reject(this.tenantContext.tenantId as string, user.id, id, dto);
  }

  @Post(':id/revoke')
  @RequirePermission(PERMISSION_KEYS.CERTIFICATES_APPROVE)
  revoke(@Param('id') id: string, @Body() dto: RevokeCertificateDto, @CurrentUser() user: AuthenticatedUser) {
    return this.certificatesService.revoke(this.tenantContext.tenantId as string, user.id, id, dto);
  }

  @Post(':id/reissue')
  @RequirePermission(PERMISSION_KEYS.CERTIFICATES_APPROVE)
  reissue(@Param('id') id: string, @Body() dto: ReissueCertificateDto, @CurrentUser() user: AuthenticatedUser) {
    return this.certificatesService.reissue(this.tenantContext.tenantId as string, user.id, id, dto);
  }
}