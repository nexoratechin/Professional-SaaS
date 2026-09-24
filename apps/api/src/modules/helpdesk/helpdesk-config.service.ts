/**
 * Helpdesk configuration service — routing departments, ticket categories, SLA policies, and the
 * consolidated lookups payload the frontend needs. All records are shared tenant resources gated
 * purely by the helpdesk.* permissions (no campus/department data-separation, like the library
 * catalog); every mutation lands an audit event (module 'helpdesk').
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AUDIT_ACTIONS, AUDIT_MODULES } from '@college-erp/auth';
import type { PrismaClient } from '@college-erp/database';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  HELPDESK_COMMENT_VISIBILITIES,
  HELPDESK_ESCALATION_REASONS,
  HELPDESK_TICKET_PRIORITIES,
  HELPDESK_TICKET_SOURCES,
  HELPDESK_TICKET_STATUSES,
  type CreateHelpdeskCategoryDto,
  type CreateHelpdeskDepartmentDto,
  type CreateHelpdeskSlaPolicyDto,
  type HelpdeskPaginationDto,
  type UpdateHelpdeskCategoryDto,
  type UpdateHelpdeskDepartmentDto,
  type UpdateHelpdeskSlaPolicyDto,
} from './dto/helpdesk.dto';

type Client = PrismaClient;

@Injectable()
export class HelpdeskConfigService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditService: AuditService,
  ) {}

  private get db(): Client {
    return this.tenantPrisma.client as unknown as Client;
  }

  private async audit(tenantId: string, userId: string, action: string, entityType: string, entityId?: string, extra?: { before?: unknown; after?: unknown }) {
    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId: userId,
      action,
      module: AUDIT_MODULES.HELPDESK,
      entityType,
      entityId,
      before: extra?.before,
      after: extra?.after,
    });
  }

  private async page(model: any, where: any, orderBy: any, skip = 0, take = 50, include?: any) {
    const [items, total] = await Promise.all([
      model.findMany({ where, orderBy, skip, take, include }),
      model.count({ where }),
    ]);
    return { items, total, skip, take };
  }

  // ── Lookups ────────────────────────────────────────────────────────────────

  async lookups(tenantId: string) {
    const [departments, categories, slaPolicies, campuses, users] = await Promise.all([
      this.db.helpdeskDepartment.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, code: true, name: true, campusId: true } }),
      this.db.helpdeskCategory.findMany({ where: { isActive: true }, orderBy: [{ sequenceOrder: 'asc' }, { name: 'asc' }], select: { id: true, code: true, name: true, parentId: true, defaultPriority: true, defaultDepartmentId: true, slaPolicyId: true, requiresApproval: true } }),
      this.db.helpdeskSlaPolicy.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, code: true, name: true, priority: true, departmentId: true } }),
      this.db.campus.findMany({ orderBy: { name: 'asc' }, select: { id: true, code: true, name: true } }),
      this.db.user.findMany({ where: { status: 'ACTIVE' }, orderBy: { fullName: 'asc' }, select: { id: true, fullName: true, email: true }, take: 500 }),
    ]);

    return {
      departments,
      categories,
      slaPolicies,
      campuses,
      users,
      ticketStatuses: [...HELPDESK_TICKET_STATUSES],
      ticketPriorities: [...HELPDESK_TICKET_PRIORITIES],
      ticketSources: [...HELPDESK_TICKET_SOURCES],
      commentVisibilities: [...HELPDESK_COMMENT_VISIBILITIES],
      escalationReasons: [...HELPDESK_ESCALATION_REASONS],
      tenantId,
    };
  }

  // ── Departments ────────────────────────────────────────────────────────────

  listDepartments(_tenantId: string, q: HelpdeskPaginationDto) {
    const where: any = {};
    if (q.search) {
      where.OR = [
        { name: { contains: q.search, mode: 'insensitive' } },
        { code: { contains: q.search, mode: 'insensitive' } },
      ];
    }
    return this.page(this.db.helpdeskDepartment, where, { name: 'asc' }, q.skip ?? 0, q.take ?? 50, {
      _count: { select: { tickets: true, categories: true } },
    });
  }

  async createDepartment(tenantId: string, userId: string, dto: CreateHelpdeskDepartmentDto) {
    const existing = await this.db.helpdeskDepartment.findFirst({ where: { code: dto.code } });
    if (existing) {
      throw new ConflictException(`A helpdesk department with code "${dto.code}" already exists.`);
    }
    const created = await this.db.helpdeskDepartment.create({
      data: { ...this.departmentData(dto), tenantId, createdBy: userId, updatedBy: userId },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.HELPDESK_DEPARTMENT_CREATED, 'HelpdeskDepartment', created.id, { after: created });
    return created;
  }

  async updateDepartment(tenantId: string, userId: string, id: string, dto: UpdateHelpdeskDepartmentDto) {
    await this.findDepartmentOrThrow(id);
    const updated = await this.db.helpdeskDepartment.update({
      where: { id },
      data: { ...this.departmentData(dto), updatedBy: userId },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.HELPDESK_DEPARTMENT_UPDATED, 'HelpdeskDepartment', id, { after: updated });
    return updated;
  }

  async deleteDepartment(tenantId: string, userId: string, id: string) {
    await this.findDepartmentOrThrow(id);
    const used = await this.db.helpdeskTicket.count({ where: { departmentId: id } });
    if (used > 0) {
      throw new BadRequestException('This department has tickets assigned to it; deactivate it instead of deleting.');
    }
    await this.db.helpdeskDepartment.delete({ where: { id } });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.HELPDESK_DEPARTMENT_DELETED, 'HelpdeskDepartment', id);
    return { deleted: true };
  }

  private departmentData(dto: CreateHelpdeskDepartmentDto | UpdateHelpdeskDepartmentDto) {
    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.campusId !== undefined) data.campusId = dto.campusId;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    return data;
  }

  private async findDepartmentOrThrow(id: string) {
    const found = await this.db.helpdeskDepartment.findFirst({ where: { id } });
    if (!found) throw new NotFoundException('Helpdesk department not found.');
    return found;
  }

  // ── Categories ─────────────────────────────────────────────────────────────

  listCategories(_tenantId: string, q: HelpdeskPaginationDto) {
    const where: any = {};
    if (q.search) {
      where.OR = [
        { name: { contains: q.search, mode: 'insensitive' } },
        { code: { contains: q.search, mode: 'insensitive' } },
      ];
    }
    return this.page(this.db.helpdeskCategory, where, [{ sequenceOrder: 'asc' }, { name: 'asc' }], q.skip ?? 0, q.take ?? 100, {
      defaultDepartment: { select: { id: true, name: true } },
      slaPolicy: { select: { id: true, name: true } },
      _count: { select: { tickets: true, children: true } },
    });
  }

  async createCategory(tenantId: string, userId: string, dto: CreateHelpdeskCategoryDto) {
    const existing = await this.db.helpdeskCategory.findFirst({ where: { code: dto.code } });
    if (existing) {
      throw new ConflictException(`A helpdesk category with code "${dto.code}" already exists.`);
    }
    if (dto.parentId) await this.findCategoryOrThrow(dto.parentId);
    const created = await this.db.helpdeskCategory.create({
      data: { ...this.categoryData(dto), tenantId, createdBy: userId, updatedBy: userId },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.HELPDESK_CATEGORY_CREATED, 'HelpdeskCategory', created.id, { after: created });
    return created;
  }

  async updateCategory(tenantId: string, userId: string, id: string, dto: UpdateHelpdeskCategoryDto) {
    const current = await this.findCategoryOrThrow(id);
    if (dto.parentId) {
      if (dto.parentId === id) throw new BadRequestException('A category cannot be its own parent.');
      await this.findCategoryOrThrow(dto.parentId);
    }
    const updated = await this.db.helpdeskCategory.update({
      where: { id },
      data: { ...this.categoryData(dto), updatedBy: userId },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.HELPDESK_CATEGORY_UPDATED, 'HelpdeskCategory', id, { before: current, after: updated });
    return updated;
  }

  async deleteCategory(tenantId: string, userId: string, id: string) {
    const current = await this.findCategoryOrThrow(id);
    const used = await this.db.helpdeskTicket.count({ where: { categoryId: id } });
    if (used > 0) {
      throw new BadRequestException('This category has tickets; deactivate it instead of deleting.');
    }
    const withChildren = await this.db.helpdeskCategory.count({ where: { parentId: id } });
    if (withChildren > 0) {
      throw new BadRequestException('This category has sub-categories; remove or re-parent them first.');
    }
    await this.db.helpdeskCategory.delete({ where: { id } });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.HELPDESK_CATEGORY_DELETED, 'HelpdeskCategory', id, { before: current });
    return { deleted: true };
  }

  private categoryData(dto: CreateHelpdeskCategoryDto | UpdateHelpdeskCategoryDto) {
    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.parentId !== undefined) data.parentId = dto.parentId;
    if (dto.defaultPriority !== undefined) data.defaultPriority = dto.defaultPriority;
    if (dto.defaultDepartmentId !== undefined) data.defaultDepartmentId = dto.defaultDepartmentId;
    if (dto.slaPolicyId !== undefined) data.slaPolicyId = dto.slaPolicyId;
    if (dto.requiresApproval !== undefined) data.requiresApproval = dto.requiresApproval;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.sequenceOrder !== undefined) data.sequenceOrder = dto.sequenceOrder;
    return data;
  }

  private async findCategoryOrThrow(id: string) {
    const found = await this.db.helpdeskCategory.findFirst({ where: { id } });
    if (!found) throw new NotFoundException('Helpdesk category not found.');
    return found;
  }

  // ── SLA policies ───────────────────────────────────────────────────────────

  listSlaPolicies(_tenantId: string, q: HelpdeskPaginationDto) {
    const where: any = {};
    if (q.search) {
      where.OR = [
        { name: { contains: q.search, mode: 'insensitive' } },
        { code: { contains: q.search, mode: 'insensitive' } },
      ];
    }
    return this.page(this.db.helpdeskSlaPolicy, where, { name: 'asc' }, q.skip ?? 0, q.take ?? 50, {
      department: { select: { id: true, name: true } },
      _count: { select: { tickets: true, categories: true } },
    });
  }

  async createSlaPolicy(tenantId: string, userId: string, dto: CreateHelpdeskSlaPolicyDto) {
    const existing = await this.db.helpdeskSlaPolicy.findFirst({ where: { code: dto.code } });
    if (existing) {
      throw new ConflictException(`An SLA policy with code "${dto.code}" already exists.`);
    }
    const created = await this.db.helpdeskSlaPolicy.create({
      data: { ...this.slaData(dto), tenantId, createdBy: userId, updatedBy: userId },
    });
    if (dto.isDefault) {
      await this.db.helpdeskSlaPolicy.updateMany({ where: { id: { not: created.id }, isDefault: true }, data: { isDefault: false } });
    }
    await this.audit(tenantId, userId, AUDIT_ACTIONS.HELPDESK_SLA_POLICY_CREATED, 'HelpdeskSlaPolicy', created.id, { after: created });
    return created;
  }

  async updateSlaPolicy(tenantId: string, userId: string, id: string, dto: UpdateHelpdeskSlaPolicyDto) {
    const current = await this.findSlaOrThrow(id);
    const updated = await this.db.helpdeskSlaPolicy.update({
      where: { id },
      data: { ...this.slaData(dto), updatedBy: userId },
    });
    if (dto.isDefault) {
      await this.db.helpdeskSlaPolicy.updateMany({ where: { id: { not: id }, isDefault: true }, data: { isDefault: false } });
    }
    await this.audit(tenantId, userId, AUDIT_ACTIONS.HELPDESK_SLA_POLICY_UPDATED, 'HelpdeskSlaPolicy', id, { before: current, after: updated });
    return updated;
  }

  async deleteSlaPolicy(tenantId: string, userId: string, id: string) {
    const current = await this.findSlaOrThrow(id);
    const used = await this.db.helpdeskTicket.count({ where: { slaPolicyId: id } });
    if (used > 0) {
      throw new BadRequestException('This SLA policy is applied to tickets; deactivate it instead of deleting.');
    }
    await this.db.helpdeskCategory.updateMany({ where: { slaPolicyId: id }, data: { slaPolicyId: null } });
    await this.db.helpdeskSlaPolicy.delete({ where: { id } });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.HELPDESK_SLA_POLICY_DELETED, 'HelpdeskSlaPolicy', id, { before: current });
    return { deleted: true };
  }

  private slaData(dto: CreateHelpdeskSlaPolicyDto | UpdateHelpdeskSlaPolicyDto) {
    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.departmentId !== undefined) data.departmentId = dto.departmentId;
    if (dto.responseMinutes !== undefined) data.responseMinutes = dto.responseMinutes;
    if (dto.resolutionMinutes !== undefined) data.resolutionMinutes = dto.resolutionMinutes;
    if (dto.atRiskMinutes !== undefined) data.atRiskMinutes = dto.atRiskMinutes;
    if (dto.escalateToRoleCode !== undefined) data.escalateToRoleCode = dto.escalateToRoleCode;
    if (dto.escalateAfterMinutes !== undefined) data.escalateAfterMinutes = dto.escalateAfterMinutes;
    if (dto.isDefault !== undefined) data.isDefault = dto.isDefault;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    return data;
  }

  private async findSlaOrThrow(id: string) {
    const found = await this.db.helpdeskSlaPolicy.findFirst({ where: { id } });
    if (!found) throw new NotFoundException('Helpdesk SLA policy not found.');
    return found;
  }

  /** Policy resolution precedence (mirrors the schema doc comment). Shared with the ticket
   * service so ticket creation and re-computation use exactly one algorithm. */
  async resolveSlaPolicyFor(tenantId: string, input: { categoryId: string; priority: string; departmentId?: string | null }) {
    const category = await this.db.helpdeskCategory.findFirst({ where: { id: input.categoryId }, select: { slaPolicyId: true } });
    if (category?.slaPolicyId) {
      const pinned = await this.db.helpdeskSlaPolicy.findFirst({ where: { id: category.slaPolicyId, isActive: true } });
      if (pinned) return pinned;
    }

    const candidates = await this.db.helpdeskSlaPolicy.findMany({ where: { isActive: true } });
    const score = (policy: any): number => {
      let s = 0;
      if (policy.priority) s += policy.priority === input.priority ? 2 : -100;
      if (policy.departmentId) s += policy.departmentId === input.departmentId ? 1 : -100;
      if (policy.isDefault) s += 0;
      return s;
    };
    const matched = candidates
      .filter((policy: any) => {
        if (policy.priority && policy.priority !== input.priority) return false;
        if (policy.departmentId && policy.departmentId !== input.departmentId) return false;
        return true;
      })
      .sort((a: any, b: any) => score(b) - score(a));
    if (matched.length > 0) {
      return matched[0];
    }
    return candidates.find((policy: any) => policy.isDefault) ?? null;
  }

  /** The ids of the policy's configured escalation role holders (ACTIVE users), used by the SLA
   * sweep and manual escalation to fan out notifications. */
  async usersForRole(roleCode: string) {
    const rows = await this.db.userRole.findMany({
      where: { role: { code: roleCode }, user: { status: 'ACTIVE' } },
      select: { userId: true },
    });
    return rows.map((row: any) => row.userId as string);
  }
}
