import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AUDIT_ACTIONS, AUDIT_MODULES } from '@college-erp/auth';
import type { PlatformUserRole } from '@college-erp/database';
import { AuditService } from '../audit/audit.service';
import { PlatformPrismaService } from '../../common/prisma/platform-prisma.service';
import type { CreatePlatformUserDto } from './dto/create-platform-user.dto';
import type { UpdatePlatformUserDto } from './dto/update-platform-user.dto';

/** The password hash and MFA secret never leave this service. */
const SAFE_SELECT = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  isActive: true,
  mfaEnabled: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * CRUD for the platform realm's own operators (`platform_users`) — the accounts that sign in at
 * `/platform/login`. Entirely separate from tenant users: there is no tenantId here and no RBAC
 * permission catalog involved, because these accounts sit above every tenant.
 *
 * Safety rails that matter when the whole control plane is one role:
 *   - an operator cannot deactivate or demote themselves (no self-lockout);
 *   - the last active PLATFORM_ADMIN cannot be deactivated or demoted (no orphaned control plane);
 *   - a password reset revokes that operator's platform sessions immediately.
 */
@Injectable()
export class PlatformUsersService {
  constructor(
    private readonly platformPrisma: PlatformPrismaService,
    private readonly auditService: AuditService,
  ) {}

  list() {
    return this.platformPrisma.client.platformUser.findMany({
      select: SAFE_SELECT,
      orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async create(dto: CreatePlatformUserDto, actorPlatformUserId: string) {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.platformPrisma.client.platformUser.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('A platform operator with this email already exists.');
    }

    const created = await this.platformPrisma.client.platformUser.create({
      data: {
        email,
        fullName: dto.fullName.trim(),
        role: dto.role,
        passwordHash: await bcrypt.hash(dto.password, 12),
      },
      select: SAFE_SELECT,
    });

    await this.auditService.record({
      scope: 'PLATFORM',
      actorType: 'PLATFORM_USER',
      actorPlatformUserId,
      action: AUDIT_ACTIONS.PLATFORM_USER_CREATED,
      module: AUDIT_MODULES.PLATFORM,
      entityType: 'PlatformUser',
      entityId: created.id,
      after: { email: created.email, fullName: created.fullName, role: created.role },
    });

    return created;
  }

  async update(id: string, dto: UpdatePlatformUserDto, actorPlatformUserId: string) {
    const before = await this.getOrThrow(id);
    const isSelf = before.id === actorPlatformUserId;

    if (isSelf && (dto.isActive === false || (dto.role !== undefined && dto.role !== 'PLATFORM_ADMIN'))) {
      throw new BadRequestException('You cannot deactivate or demote your own platform account.');
    }

    const demotingOrDeactivatingAdmin =
      before.role === 'PLATFORM_ADMIN' &&
      ((dto.role !== undefined && dto.role !== 'PLATFORM_ADMIN') || dto.isActive === false);
    if (demotingOrDeactivatingAdmin) {
      await this.assertAnotherActiveAdminExists(id);
    }

    const updated = await this.platformPrisma.client.platformUser.update({
      where: { id },
      data: {
        ...(dto.fullName !== undefined ? { fullName: dto.fullName.trim() } : {}),
        ...(dto.role !== undefined ? { role: dto.role as PlatformUserRole } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
      select: SAFE_SELECT,
    });

    if (dto.isActive === false) {
      await this.revokeSessions(id);
    }

    await this.auditService.record({
      scope: 'PLATFORM',
      actorType: 'PLATFORM_USER',
      actorPlatformUserId,
      action: AUDIT_ACTIONS.PLATFORM_USER_UPDATED,
      module: AUDIT_MODULES.PLATFORM,
      entityType: 'PlatformUser',
      entityId: id,
      before: { fullName: before.fullName, role: before.role, isActive: before.isActive },
      after: { fullName: updated.fullName, role: updated.role, isActive: updated.isActive },
    });

    return updated;
  }

  async resetPassword(id: string, password: string, actorPlatformUserId: string) {
    const target = await this.getOrThrow(id);

    await this.platformPrisma.client.platformUser.update({
      where: { id },
      data: {
        passwordHash: await bcrypt.hash(password, 12),
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
    await this.revokeSessions(id);

    await this.auditService.record({
      scope: 'PLATFORM',
      actorType: 'PLATFORM_USER',
      actorPlatformUserId,
      action: AUDIT_ACTIONS.PLATFORM_USER_PASSWORD_RESET,
      module: AUDIT_MODULES.PLATFORM,
      entityType: 'PlatformUser',
      entityId: id,
      after: { email: target.email, sessionsRevoked: true },
    });
  }

  private async getOrThrow(id: string) {
    const user = await this.platformPrisma.client.platformUser.findUnique({ where: { id }, select: SAFE_SELECT });
    if (!user) throw new NotFoundException('Platform operator not found.');
    return user;
  }

  private async assertAnotherActiveAdminExists(excludingId: string): Promise<void> {
    const remaining = await this.platformPrisma.client.platformUser.count({
      where: { role: 'PLATFORM_ADMIN', isActive: true, id: { not: excludingId } },
    });
    if (remaining === 0) {
      throw new BadRequestException('At least one active PLATFORM_ADMIN must remain.');
    }
  }

  private async revokeSessions(platformUserId: string): Promise<void> {
    await this.platformPrisma.client.platformSession.updateMany({
      where: { platformUserId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
