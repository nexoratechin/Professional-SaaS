/**
 * Organization master-data CRUD, hierarchy, import, and export.
 *
 * One service dispatches over all nine organization entities through ENTITY_META — dynamic
 * Prisma delegate access is intentionally untyped (`any`) because the model is chosen at
 * runtime from the entity map; the DTOs (class-validator) enforce the shape of everything a
 * caller can supply, so the dynamic access is bounded on the input side.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type PrismaClient } from '@college-erp/database';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { AuditService } from '../audit/audit.service';
import { PermissionsService } from '../rbac/permissions.service';
import { ENTITY_META, type EntityName, type OrganizationEntityMeta } from './organization.constants';
import { parseCsvToRows, rowsToCsv } from './org-csv';
import { scopeFilter } from './org-scope';
import { type ImportResult, type ImportResultRow } from './dto/import-organization.dto';

type Client = PrismaClient;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a Prisma `where` clause for free-text search on code + name + (description if present). */
function searchWhere(q: string | undefined, meta: OrganizationEntityMeta): Record<string, unknown> | undefined {
  if (!q) return undefined;
  const contains = { contains: q, mode: 'insensitive' as const };
  const fields: Array<Record<string, unknown>> = [{ code: contains }, { name: contains }];
  if (meta.csvColumns.some(([, f]) => f === 'description')) {
    fields.push({ description: contains });
  }
  return { OR: fields };
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class OrganizationService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditService: AuditService,
    private readonly permissionsService: PermissionsService,
  ) {}

  // ── Scope helpers ─────────────────────────────────────────────────────────

  /**
   * Weave the scope hierarchy (DEPT → CAMPUS, PROGRAM → DEPT/CAMPUS) into a Prisma where
   * clause for `entity`. Returns `undefined` when the user has GLOBAL access.
   */
  private async scopeWhereForEntity(
    tenantId: string,
    userId: string,
    entity: EntityName,
  ): Promise<Record<string, any> | undefined> {
    const meta = ENTITY_META[entity];
    const grants = await this.permissionsService.getScopeGrantsFor(tenantId, userId, meta.viewKey);
    if (grants.length === 0) return { id: { in: [] } };

    return scopeFilter(
      {
        grants,
        deptToCampus: async (ids) => {
          const rows = await (this.tenantPrisma.client as Client).department.findMany({
            where: { id: { in: ids } },
            select: { id: true, campusId: true },
          });
          return new Map(rows.map((r) => [r.id, r.campusId]));
        },
        progToAncestors: async (ids) => {
          const rows = await (this.tenantPrisma.client as Client).program.findMany({
            where: { id: { in: ids } },
            select: { id: true, departmentId: true, department: { select: { campusId: true } } },
          });
          return new Map(
            rows.map((r) => [r.id, { departmentId: r.departmentId, campusId: r.department?.campusId ?? null }]),
          );
        },
      },
      entity === 'academicYear' || entity === 'term'
        ? 'global'
        : entity === 'program' || entity === 'section' || entity === 'batch'
          ? 'program'
          : entity === 'department'
            ? 'department'
            : 'campus',
    );
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────

  async list(
    entity: EntityName,
    tenantId: string,
    userId: string,
    query: {
      q?: string;
      campusId?: string;
      departmentId?: string;
      programId?: string;
      academicYearId?: string;
      buildingId?: string;
      isActive?: string;
      skip?: number;
      take?: number;
    },
  ) {
    const meta = ENTITY_META[entity];
    const scopeFilter = await this.scopeWhereForEntity(tenantId, userId, entity);

    const where: Record<string, any> = {};
    if (scopeFilter) Object.assign(where, scopeFilter);
    const search = searchWhere(query.q, meta);
    if (search) Object.assign(where, search);
    if (query.isActive !== undefined) where.isActive = query.isActive === 'true';
    // Only apply the parent-id filters the entity actually owns (an entity can't be a
    // child of its own kind); unknown filters would crash Prisma with an invalid `where`.
    const ownParentFields = new Set((meta.parentRefs ?? []).map((r) => r.field));
    if (query.campusId && ownParentFields.has('campusId')) where.campusId = query.campusId;
    if (query.departmentId && ownParentFields.has('departmentId')) where.departmentId = query.departmentId;
    if (query.programId && ownParentFields.has('programId')) where.programId = query.programId;
    if (query.academicYearId && ownParentFields.has('academicYearId')) where.academicYearId = query.academicYearId;
    if (query.buildingId && ownParentFields.has('buildingId')) where.buildingId = query.buildingId;

    const model = this.getModel(entity);
    const [data, total] = await Promise.all([
      (model as any).findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip ?? 0,
        take: query.take ?? 50,
      }),
      (model as any).count({ where }),
    ]);
    return { data, total };
  }

  async get(entity: EntityName, id: string) {
    const model = this.getModel(entity);
    const row = await (model as any).findFirst({ where: { id } });
    if (!row) throw new NotFoundException(`${ENTITY_META[entity].entityType} not found.`);
    return row;
  }

  async create(entity: EntityName, tenantId: string, userId: string, dto: Record<string, unknown>) {
    const meta = ENTITY_META[entity];
    await this.validateParents(entity, dto);

    if (entity === 'academicYear' && dto.isCurrent === true) {
      await (this.tenantPrisma.client as Client).academicYear.updateMany({
        where: { isCurrent: true },
        data: { isCurrent: false },
      });
    }
    if (entity === 'term' && dto.isCurrent === true && dto.academicYearId) {
      await (this.tenantPrisma.client as Client).term.updateMany({
        where: { academicYearId: dto.academicYearId as string, isCurrent: true },
        data: { isCurrent: false },
      });
    }

    try {
      const model = this.getModel(entity);
      const created = await (model as any).create({ data: { ...dto, createdBy: userId } });
      await this.auditService.record({
        scope: 'TENANT',
        tenantId,
        actorType: 'USER',
        actorUserId: userId,
        action: meta.createAuditAction,
        module: 'organization',
        entityType: meta.entityType,
        entityId: created.id,
        after: { code: created.code, name: created.name },
      });
      return created;
    } catch (err: any) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`${meta.entityType} with the same code already exists.`);
      }
      throw err;
    }
  }

  async update(entity: EntityName, tenantId: string, userId: string, id: string, dto: Record<string, unknown>) {
    const meta = ENTITY_META[entity];
    const before = await this.get(entity, id);
    await this.validateParents(entity, dto);

    if (entity === 'academicYear' && dto.isCurrent === true) {
      await (this.tenantPrisma.client as Client).academicYear.updateMany({
        where: { isCurrent: true, NOT: { id } },
        data: { isCurrent: false },
      });
    }
    if (entity === 'term' && dto.isCurrent === true) {
      const term = await this.get('term', id);
      await (this.tenantPrisma.client as Client).term.updateMany({
        where: { academicYearId: term.academicYearId, isCurrent: true, NOT: { id } },
        data: { isCurrent: false },
      });
    }

    try {
      const model = this.getModel(entity);
      const updated = await (model as any).update({ where: { id }, data: { ...dto, updatedBy: userId } });
      await this.auditService.record({
        scope: 'TENANT',
        tenantId,
        actorType: 'USER',
        actorUserId: userId,
        action: meta.updateAuditAction,
        module: 'organization',
        entityType: meta.entityType,
        entityId: id,
        before: { code: before.code, name: before.name },
        after: { code: updated.code, name: updated.name },
      });
      return updated;
    } catch (err: any) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`${meta.entityType} with the same code already exists.`);
      }
      throw err;
    }
  }

  async archive(entity: EntityName, tenantId: string, userId: string, id: string) {
    const meta = ENTITY_META[entity];
    const before = await this.get(entity, id);
    const model = this.getModel(entity);
    const archived = await (model as any).update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false, updatedBy: userId },
    });
    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId: userId,
      action: meta.archiveAuditAction,
      module: 'organization',
      entityType: meta.entityType,
      entityId: id,
      before: { code: before.code, name: before.name },
    });
    return archived;
  }

  // ── Parent validation ──────────────────────────────────────────────────────

  /** Ensure any parent-id reference on the DTO points to an existing tenant-owned row,
   *  so a create/update can't silently hang off a foreign tenant's or orphaned parent. */
  private async validateParents(entity: EntityName, dto: Record<string, unknown>) {
    const client = this.tenantPrisma.client as Client;
    const refs: Array<{ field: string; entity: string; model: string }> = [
      { field: 'campusId', entity: 'Campus', model: 'campus' },
      { field: 'departmentId', entity: 'Department', model: 'department' },
      { field: 'programId', entity: 'Program', model: 'program' },
      { field: 'academicYearId', entity: 'Academic Year', model: 'academicYear' },
      { field: 'buildingId', entity: 'Building', model: 'building' },
    ];
    for (const ref of refs) {
      const val = dto[ref.field];
      if (val === null || val === undefined) continue;
      if (ref.field === 'campusId' && entity === 'campus') continue; // not a self-reference
      const found = await (client as any)[ref.model].findFirst({ where: { id: val } });
      if (!found) throw new NotFoundException(`${ref.entity} not found.`);
    }
  }

  // ── Hierarchy ──────────────────────────────────────────────────────────────

  async hierarchy(tenantId: string, userId: string) {
    const campusScope = await this.scopeWhereForEntity(tenantId, userId, 'campus');
    const yearScope = await this.scopeWhereForEntity(tenantId, userId, 'academicYear');

    const [campuses, academicYears] = await Promise.all([
      (this.tenantPrisma.client as Client).campus.findMany({
        where: { deletedAt: null, ...(campusScope ?? {}) },
        include: {
          buildings: { where: { deletedAt: null }, orderBy: { name: 'asc' } },
          rooms: { where: { deletedAt: null }, orderBy: { name: 'asc' } },
          departments: {
            where: { deletedAt: null },
            orderBy: { name: 'asc' },
            include: {
              programs: {
                where: { deletedAt: null },
                orderBy: { name: 'asc' },
                include: {
                  sections: { where: { deletedAt: null }, orderBy: { name: 'asc' } },
                  batches: { where: { deletedAt: null }, orderBy: { name: 'asc' } },
                },
              },
            },
          },
        },
        orderBy: { name: 'asc' },
      }),
      (this.tenantPrisma.client as Client).academicYear.findMany({
        where: { deletedAt: null, ...(yearScope ?? {}) },
        include: { terms: { where: { deletedAt: null }, orderBy: { sequence: 'asc' } } },
        orderBy: { startDate: 'desc' },
      }),
    ]);

    return { campuses, academicYears };
  }

  // ── Export ─────────────────────────────────────────────────────────────────

  async exportCsv(
    entity: EntityName,
    tenantId: string,
    userId: string,
    query: {
      q?: string;
      campusId?: string;
      departmentId?: string;
      programId?: string;
      academicYearId?: string;
      buildingId?: string;
      isActive?: string;
    },
  ) {
    const meta = ENTITY_META[entity];
    const { data } = await this.list(entity, tenantId, userId, { ...query, skip: 0, take: 10_000 });
    const fields = meta.csvColumns.map(([, f]) => f);
    const rows = (data as Record<string, unknown>[]).map((row) => {
      const out: Record<string, unknown> = {};
      for (const [, field] of meta.csvColumns) {
        out[field] = row[field] ?? '';
      }
      return out;
    });
    const csv = rowsToCsv(rows, fields);
    return { csv, entity, count: data.length, filename: `${entity}s.csv` };
  }

  // ── Import ─────────────────────────────────────────────────────────────────

  async importCsv(
    entity: EntityName,
    tenantId: string,
    userId: string,
    csv: string,
    mode: 'validate' | 'upsert',
  ): Promise<ImportResult> {
    const meta = ENTITY_META[entity];
    const fields = meta.csvColumns.map(([, f]) => f);
    const rows = parseCsvToRows(csv, fields);

    // Resolve parent-codes → IDs once, so N rows don't incur N queries per parent.
    const refMaps = new Map<string, Map<string, string>>();
    if (meta.parentRefs) {
      for (const ref of meta.parentRefs) {
        if (refMaps.has(ref.refEntity)) continue;
        const parentMeta = ENTITY_META[ref.refEntity];
        const parentCodeField = parentMeta.csvColumns[0]![1];
        const parentModel = this.getModel(ref.refEntity);
        const parentRows = await (parentModel as any).findMany({
          where: { deletedAt: null },
          select: { id: true, [parentCodeField]: true },
        });
        const map = new Map<string, string>();
        for (const r of parentRows) map.set(r[parentCodeField], r.id);
        refMaps.set(ref.refEntity, map);
      }
    }

    const errors: ImportResultRow[] = [];
    const validRows: Array<{ row: number; code: string; data: Record<string, unknown> }> = [];

    for (let idx = 0; idx < rows.length; idx++) {
      const row = rows[idx]!;
      const rowNum = idx + 2; // 1-indexed, skipping the header line
      const code = String(row.code ?? '').trim();

      if (!code) {
        errors.push({ row: rowNum, code: '', success: false, error: 'code is required' });
        continue;
      }

      const resolved: Record<string, unknown> = { ...row };

      if (meta.parentRefs) {
        for (const ref of meta.parentRefs) {
          const codeVal = String(row[ref.field] ?? '').trim();
          if (!codeVal) {
            delete resolved[ref.field];
            continue;
          }
          const map = refMaps.get(ref.refEntity);
          const id = map?.get(codeVal);
          if (!id) {
            errors.push({ row: rowNum, code, success: false, error: `${ref.header} "${codeVal}" not found` });
            continue;
          }
          resolved[ref.field] = id;
        }
      }

      // Coerce types parsed by the CSV helpers into Prisma-friendly values.
      if (resolved.capacity !== null && resolved.capacity !== undefined) {
        const n = Number(resolved.capacity);
        if (Number.isNaN(n)) {
          errors.push({ row: rowNum, code, success: false, error: 'capacity must be an integer' });
          continue;
        }
        resolved.capacity = n;
      }
      if (resolved.durationYears !== null && resolved.durationYears !== undefined) {
        const n = Number(resolved.durationYears);
        if (Number.isNaN(n)) {
          errors.push({ row: rowNum, code, success: false, error: 'durationYears must be an integer' });
          continue;
        }
        resolved.durationYears = n;
      }
      if (resolved.sequence !== null && resolved.sequence !== undefined) {
        const n = Number(resolved.sequence);
        if (Number.isNaN(n)) {
          errors.push({ row: rowNum, code, success: false, error: 'sequence must be an integer' });
          continue;
        }
        resolved.sequence = n;
      }
      for (const dateField of ['startDate', 'endDate']) {
        if (typeof resolved[dateField] === 'string' && resolved[dateField]) {
          const d = new Date(resolved[dateField] as string);
          if (Number.isNaN(d.getTime())) {
            errors.push({ row: rowNum, code, success: false, error: `${dateField} is not a valid date` });
            continue;
          }
          resolved[dateField] = d;
        }
      }
      // parseCsvToRows already coerced 'true'/'false' to booleans.

      validRows.push({ row: rowNum, code, data: resolved });
    }

    if (mode === 'validate') {
      return {
        entity,
        mode,
        total: rows.length,
        valid: validRows.length,
        inserted: 0,
        updated: 0,
        errors,
      };
    }

    let inserted = 0;
    let updated = 0;

    for (const { row: rowNum, code, data } of validRows) {
      try {
        await this.create(entity, tenantId, userId, { ...data, code });
        inserted++;
      } catch (err: any) {
        if (err instanceof ConflictException) {
          try {
            const model = this.getModel(entity);
            const codeField = meta.csvColumns[0]![1];
            const existing = await (model as any).findFirst({ where: { [codeField]: code } });
            if (existing) {
              await this.update(entity, tenantId, userId, existing.id, data);
              updated++;
            }
          } catch (updateErr: any) {
            errors.push({ row: rowNum, code, success: false, error: updateErr.message });
          }
        } else {
          errors.push({ row: rowNum, code, success: false, error: (err as Error).message });
        }
      }
    }

    return { entity, mode, total: rows.length, valid: validRows.length, inserted, updated, errors };
  }

  // ── Model accessor ─────────────────────────────────────────────────────────

  private getModel(entity: EntityName): any {
    const client = this.tenantPrisma.client as Record<string, any>;
    return client[ENTITY_META[entity].model];
  }
}