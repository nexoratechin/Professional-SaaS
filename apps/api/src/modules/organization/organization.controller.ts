/**
 * Routes for the nine organization entities behind a single `/organization` prefix.
 *
 * The entity is a route param, so which DTO / permission applies is decided at runtime;
 * request bodies are deliberately `any` here so the global ValidationPipe doesn't reject
 * them before the per-entity class-validator pass in validateDtoBody() runs.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { validateSync } from 'class-validator';
import type { Response } from 'express';
import type { AuthenticatedUser } from '@college-erp/auth';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { TenantMatchGuard } from '../../common/guards/tenant-match.guard';
import { TenantContextService } from '../../common/prisma/tenant-context.service';
import { PermissionsService } from '../rbac/permissions.service';
import { ENTITY_META, ENTITY_NAMES, type EntityName } from './organization.constants';
import {
  CreateAcademicYearDto,
  CreateBatchDto,
  CreateBuildingDto,
  CreateCampusDto,
  CreateDepartmentDto,
  CreateProgramDto,
  CreateRoomDto,
  CreateSectionDto,
  CreateTermDto,
  UpdateAcademicYearDto,
  UpdateBatchDto,
  UpdateBuildingDto,
  UpdateCampusDto,
  UpdateDepartmentDto,
  UpdateProgramDto,
  UpdateRoomDto,
  UpdateSectionDto,
  UpdateTermDto,
} from './dto/organization.dto';
import { ImportOrganizationDto } from './dto/import-organization.dto';
import { ListOrganizationDto } from './dto/list-organization.dto';
import { OrganizationService } from './organization.service';

const ENTITY_DTO_MAP = {
  campus: { create: CreateCampusDto, update: UpdateCampusDto },
  department: { create: CreateDepartmentDto, update: UpdateDepartmentDto },
  program: { create: CreateProgramDto, update: UpdateProgramDto },
  academicYear: { create: CreateAcademicYearDto, update: UpdateAcademicYearDto },
  term: { create: CreateTermDto, update: UpdateTermDto },
  room: { create: CreateRoomDto, update: UpdateRoomDto },
  building: { create: CreateBuildingDto, update: UpdateBuildingDto },
  section: { create: CreateSectionDto, update: UpdateSectionDto },
  batch: { create: CreateBatchDto, update: UpdateBatchDto },
} as const;

/** Validates an incoming body against a class-validator DTO class.
 *  Returns only decorated (allowed) fields — whitelist enforcement. */
function validateDtoBody(body: Record<string, unknown>, DtoClass: any): Record<string, unknown> {
  const instance = Object.assign(new DtoClass(), body);
  const errors = validateSync(instance as any, {
    whitelist: true,
    forbidNonWhitelisted: true,
    skipMissingProperties: true,
  });
  if (errors.length > 0) {
    const messages = errors.flatMap((e) => Object.values(e.constraints ?? {})).join('; ');
    const err = new Error(`Validation failed: ${messages}`);
    (err as any).status = 400;
    throw err;
  }
  const allowedKeys = new Set(Object.getOwnPropertyNames(new DtoClass()));
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    if (allowedKeys.has(key)) {
      result[key] = body[key];
    }
  }
  return result;
}

@ApiTags('organization')
@Controller('organization')
@UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard)
export class OrganizationController {
  constructor(
    private readonly orgService: OrganizationService,
    private readonly tenantContext: TenantContextService,
    private readonly permissionsService: PermissionsService,
  ) {}

  /**
   * Broad per-entity RBAC gate. `PermissionsGuard` (class-level) only proves the request is
   * authenticated to the tenant; the actual org permissions are checked here per entity,
   * because the entity is only known at runtime from the URL. A user holding no grants for
   * the key is Forbidden — scoped users (CAMPUS/DEPARTMENT/PROGRAM) pass this gate; their
   * per-record limits are applied by the service's scope filter.
   */
  private async ensureOrgPermission(tenantId: string, userId: string, entity: EntityName, action: 'view' | 'manage') {
    const key = action === 'manage' ? ENTITY_META[entity].manageKey : ENTITY_META[entity].viewKey;
    const grants = await this.permissionsService.getScopeGrantsFor(tenantId, userId, key);
    if (grants.length === 0) {
      throw new ForbiddenException(`You need ${key} to ${action} ${ENTITY_META[entity].entityType}.`);
    }
  }

  // ── Hierarchy (static route: MUST be declared before `:entity` so it is not shadowed) ──

  @Get('hierarchy')
  async hierarchy(@CurrentUser() user: AuthenticatedUser) {
    const tenantId = this.tenantContext.tenantId!;
    await this.ensureOrgPermission(tenantId, user.id, 'campus', 'view');
    return this.orgService.hierarchy(tenantId, user.id);
  }

  // ── Export (static route: declared before `:entity`) ─────────────────────────

  @Get('export')
  async exportCsv(
    @Query() query: ListOrganizationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const tenantId = this.tenantContext.tenantId!;
    const entity = this.resolveEntity(query.entity);
    await this.ensureOrgPermission(tenantId, user.id, entity, 'view');
    return this.orgService.exportCsv(entity, tenantId, user.id, {
      q: query.q,
      campusId: query.campusId,
      departmentId: query.departmentId,
      programId: query.programId,
      academicYearId: query.academicYearId,
      buildingId: query.buildingId,
      isActive: query.isActive,
    });
  }

  // ── Import (static route: declared before `:entity`) ─────────────────────────

  @Post('import')
  async import(
    @Body() dto: ImportOrganizationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const tenantId = this.tenantContext.tenantId!;
    const entity = this.resolveEntity(dto.entity);
    await this.ensureOrgPermission(tenantId, user.id, entity, 'manage');
    return this.orgService.importCsv(entity, tenantId, user.id, dto.csv, dto.mode ?? 'upsert');
  }

  // ── List ───────────────────────────────────────────────────────────────────

  @Get(':entity')
  async list(
    @Param('entity') entityParam: string,
    @Query() query: ListOrganizationDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const entity = this.resolveEntity(entityParam);
    const { data, total } = await this.orgService.list(entity, this.tenantContext.tenantId!, user.id, {
      q: query.q,
      campusId: query.campusId,
      departmentId: query.departmentId,
      programId: query.programId,
      academicYearId: query.academicYearId,
      buildingId: query.buildingId,
      isActive: query.isActive,
      skip: query.skip,
      take: query.take,
    });
    res.setHeader('X-Total-Count', String(total));
    return data;
  }

  // ── Get single ─────────────────────────────────────────────────────────────

  @Get(':entity/:id')
  async get(
    @Param('entity') entityParam: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const entity = this.resolveEntity(entityParam);
    await this.ensureOrgPermission(this.tenantContext.tenantId!, user.id, entity, 'view');
    return this.orgService.get(entity, id);
  }

  // ── Create ─────────────────────────────────────────────────────────────────

  @Post(':entity')
  async create(
    @Param('entity') entityParam: string,
    @Body() body: any, // validated manually via DTO class — `any` bypasses global ValidationPipe
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const entity = this.resolveEntity(entityParam);
    await this.ensureOrgPermission(this.tenantContext.tenantId!, user.id, entity, 'manage');
    const DtoClass = ENTITY_DTO_MAP[entity].create;
    const dto = validateDtoBody(body as Record<string, unknown>, DtoClass);
    return this.orgService.create(entity, this.tenantContext.tenantId!, user.id, dto);
  }

  // ── Update ─────────────────────────────────────────────────────────────────

  @Patch(':entity/:id')
  async update(
    @Param('entity') entityParam: string,
    @Param('id') id: string,
    @Body() body: any,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const entity = this.resolveEntity(entityParam);
    await this.ensureOrgPermission(this.tenantContext.tenantId!, user.id, entity, 'manage');
    const DtoClass = ENTITY_DTO_MAP[entity].update;
    const dto = validateDtoBody(body as Record<string, unknown>, DtoClass);
    return this.orgService.update(entity, this.tenantContext.tenantId!, user.id, id, dto);
  }

  // ── Archive (soft delete) ──────────────────────────────────────────────────

  @Delete(':entity/:id')
  async archive(
    @Param('entity') entityParam: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const entity = this.resolveEntity(entityParam);
    await this.ensureOrgPermission(this.tenantContext.tenantId!, user.id, entity, 'manage');
    return this.orgService.archive(entity, this.tenantContext.tenantId!, user.id, id);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private resolveEntity(param: string | undefined): EntityName {
    if (!param) {
      const err = new Error(`Invalid entity: ${param}`);
      (err as any).status = 400;
      throw err;
    }
    const normalized = param.replace(/-([a-z])/g, (_: string, c: string) => c.toUpperCase());
    if (!ENTITY_NAMES.includes(normalized as EntityName)) {
      const err = new Error(`Invalid entity: ${param}`);
      (err as any).status = 404;
      throw err;
    }
    return normalized as EntityName;
  }
}