/**
 * Student 360 — core profile endpoints. Guards follow the feature-module convention
 * (JwtAuthGuard, TenantMatchGuard, PermissionsGuard, FeatureFlagsGuard); scoped permission
 * grants are enforced down in StudentsService via studentScopeFilter. Sub-resource records
 * live on StudentRecordsController.
 */
import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FEATURE_KEYS, PERMISSION_KEYS as K, type AuthenticatedUser } from '@college-erp/auth';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireFeature } from '../../common/decorators/require-feature.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { FeatureFlagsGuard } from '../../common/guards/feature-flag.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { TenantMatchGuard } from '../../common/guards/tenant-match.guard';
import { TenantContextService } from '../../common/prisma/tenant-context.service';
import { StudentsService } from './students.service';
import {
  BulkStudentDto,
  CreateStudentDto,
  ListStudentQueryDto,
  StudentStatusChangeDto,
  UpdateStudentDto,
  VerifyStudentQueryDto,
} from './dto/students.dto';

@ApiTags('students')
@Controller('students')
@UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard, FeatureFlagsGuard)
@RequireFeature(FEATURE_KEYS.STUDENTS)
export class StudentsController {
  constructor(
    private readonly studentsService: StudentsService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private tid(): string {
    return this.tenantContext.tenantId as string;
  }

  @Get('summary')
  @RequirePermission(K.STUDENTS_VIEW)
  summary(@CurrentUser() user: AuthenticatedUser) {
    return this.studentsService.summary(this.tid(), user.id);
  }

  @Get('export')
  @Header('Content-Type', 'text/csv')
  @RequirePermission(K.STUDENTS_EXPORT)
  async exportCsv(@Query() query: ListStudentQueryDto, @CurrentUser() user: AuthenticatedUser) {
    const { csv, filename } = await this.studentsService.exportCsv(this.tid(), user.id, query);
    return new StreamableFile(Buffer.from(csv), {
      type: 'text/csv',
      disposition: `attachment; filename="${filename}"`,
    });
  }

  @Get('verify')
  @RequirePermission(K.STUDENTS_VIEW)
  verifyAdmissionNumber(@Query() query: VerifyStudentQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.studentsService.verifyAdmissionNumber(this.tid(), user.id, query.admissionNumber, query.excludeId);
  }

  @Post('bulk')
  @RequirePermission(K.STUDENTS_MANAGE)
  bulk(@Body() dto: BulkStudentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.studentsService.bulk(this.tid(), user.id, dto);
  }

  @Get()
  @RequirePermission(K.STUDENTS_VIEW)
  list(@Query() query: ListStudentQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.studentsService.list(this.tid(), user.id, query);
  }

  @Post()
  @RequirePermission(K.STUDENTS_CREATE)
  create(@Body() dto: CreateStudentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.studentsService.create(this.tid(), user.id, dto);
  }

  @Get(':id')
  @RequirePermission(K.STUDENTS_VIEW)
  getDetail(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.studentsService.getDetail(id, this.tid(), user.id);
  }

  @Patch(':id')
  @RequirePermission(K.STUDENTS_UPDATE)
  update(@Param('id') id: string, @Body() dto: UpdateStudentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.studentsService.update(id, this.tid(), user.id, dto);
  }

  @Post(':id/status')
  @RequirePermission(K.STUDENTS_UPDATE)
  changeStatus(
    @Param('id') id: string,
    @Body() dto: StudentStatusChangeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.studentsService.changeStatus(id, this.tid(), user.id, dto.status, dto.reason);
  }

  @Post(':id/archive')
  @RequirePermission(K.STUDENTS_DELETE)
  archive(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.studentsService.archive(id, this.tid(), user.id);
  }

  @Post(':id/restore')
  @RequirePermission(K.STUDENTS_DELETE)
  restore(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.studentsService.restore(id, this.tid(), user.id);
  }
}