import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AUDIT_ACTIONS, AUDIT_MODULES } from '@college-erp/auth';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { EmailVerificationService } from '../auth/email-verification.service';
import { AuditService } from '../audit/audit.service';
import { PermissionsService } from '../rbac/permissions.service';
import type { AssignRoleDto } from './dto/assign-role.dto';
import type { InviteUserDto } from './dto/invite-user.dto';
import type { UpdateUserStatusDto } from './dto/update-user-status.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly permissionsService: PermissionsService,
    private readonly auditService: AuditService,
    private readonly emailVerificationService: EmailVerificationService,
  ) {}

  async invite(tenantId: string, tenantSlug: string, dto: InviteUserDto, actorUserId: string) {
    const passwordHash = await bcrypt.hash(dto.initialPassword, 12);
    const user = await this.tenantPrisma.client.user.create({
      data: {
        tenantId,
        email: dto.email,
        fullName: dto.fullName,
        passwordHash,
        // ACTIVE (not INVITED) — an admin who set this password has already vouched for the
        // account, so it can log in immediately. Email verification is still tracked (below)
        // but doesn't gate login — see EmailVerificationService's doc comment for why.
        status: 'ACTIVE',
        createdBy: actorUserId,
      },
    });

    await this.emailVerificationService.issueVerificationToken(tenantId, tenantSlug, user.id, user.email);

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.USER_INVITED,
      module: AUDIT_MODULES.USERS,
      entityType: 'User',
      entityId: user.id,
      after: { email: user.email, fullName: user.fullName },
    });

    return user;
  }

  async list() {
    return this.tenantPrisma.client.user.findMany({
      include: { userRoles: { include: { role: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(id: string) {
    const user = await this.tenantPrisma.client.user.findFirst({
      where: { id },
      include: { userRoles: { include: { role: true } } },
    });
    if (!user) {
      throw new NotFoundException('User not found.');
    }
    return user;
  }

  async updateStatus(tenantId: string, id: string, dto: UpdateUserStatusDto, actorUserId: string) {
    const before = await this.get(id);
    const user = await this.tenantPrisma.client.user.update({
      where: { id },
      data: { status: dto.status, updatedBy: actorUserId },
    });

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.USER_STATUS_CHANGED,
      module: AUDIT_MODULES.USERS,
      entityType: 'User',
      entityId: id,
      before: { status: before.status },
      after: { status: user.status },
    });

    return user;
  }

  async assignRole(tenantId: string, userId: string, roleId: string, dto: AssignRoleDto, actorUserId: string) {
    const [user, role] = await Promise.all([
      this.tenantPrisma.client.user.findFirst({ where: { id: userId } }),
      this.tenantPrisma.client.role.findFirst({ where: { id: roleId } }),
    ]);
    if (!user || !role) {
      throw new NotFoundException('User or role not found.');
    }

    // Tenant-scoped lookups — referencing another tenant's campus/department/program id here
    // simply finds nothing, same as any other cross-tenant reference in this codebase.
    const [campus, department, program] = await Promise.all([
      dto.campusId ? this.tenantPrisma.client.campus.findFirst({ where: { id: dto.campusId } }) : null,
      dto.departmentId ? this.tenantPrisma.client.department.findFirst({ where: { id: dto.departmentId } }) : null,
      dto.programId ? this.tenantPrisma.client.program.findFirst({ where: { id: dto.programId } }) : null,
    ]);
    if (dto.campusId && !campus) {
      throw new NotFoundException('Campus not found.');
    }
    if (dto.departmentId && !department) {
      throw new NotFoundException('Department not found.');
    }
    if (dto.programId && !program) {
      throw new NotFoundException('Program not found.');
    }

    const scopeData = {
      scopeCampusId: dto.campusId,
      scopeDepartmentId: dto.departmentId,
      scopeProgramId: dto.programId,
    };

    const userRole = await this.tenantPrisma.client.userRole.upsert({
      where: { tenantId_userId_roleId: { tenantId, userId, roleId } },
      update: scopeData,
      create: { tenantId, userId, roleId, assignedByUserId: actorUserId, ...scopeData },
    });

    await this.permissionsService.invalidate(tenantId, userId);
    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.ROLE_ASSIGNED,
      module: AUDIT_MODULES.RBAC,
      entityType: 'UserRole',
      entityId: userRole.id,
      after: { userId, roleCode: role.code, ...scopeData },
    });

    return userRole;
  }

  async unassignRole(tenantId: string, userId: string, roleId: string, actorUserId: string) {
    const userRole = await this.tenantPrisma.client.userRole.findFirst({ where: { userId, roleId } });
    if (!userRole) {
      throw new NotFoundException('Role assignment not found.');
    }

    const role = await this.tenantPrisma.client.role.findFirst({ where: { id: roleId } });
    if (role?.isSystem && role.code === 'TENANT_ADMIN') {
      const remainingAdmins = await this.tenantPrisma.client.userRole.count({ where: { roleId } });
      if (remainingAdmins <= 1) {
        throw new BadRequestException('Cannot remove the last TENANT_ADMIN from the tenant.');
      }
    }

    await this.tenantPrisma.client.userRole.delete({ where: { id: userRole.id } });
    await this.permissionsService.invalidate(tenantId, userId);

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.ROLE_UNASSIGNED,
      module: AUDIT_MODULES.RBAC,
      entityType: 'UserRole',
      entityId: userRole.id,
      before: { userId, roleId },
    });
  }
}
