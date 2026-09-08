import { Injectable, NotFoundException } from '@nestjs/common';
import { AUDIT_ACTIONS, AUDIT_MODULES } from '@college-erp/auth';
import type { SupportTicketPriority, SupportTicketStatus } from '@college-erp/database';
import { PlatformPrismaService } from '../../common/prisma/platform-prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AddSupportTicketCommentDto } from './dto/add-support-ticket-comment.dto';
import type { CreateSupportTicketDto } from './dto/create-support-ticket.dto';
import type { ListSupportTicketsDto } from './dto/list-support-tickets.dto';
import type { ListTenantSupportTicketsDto } from './dto/list-tenant-support-tickets.dto';
import type { UpdateSupportTicketDto } from './dto/update-support-ticket.dto';

/**
 * Support tickets are control-plane data (SupportTicket.tenantId is OPTIONAL — see the schema
 * doc comment), always accessed via the unscoped PlatformPrismaService with explicit tenantId
 * filtering wherever a tenant context is involved. Tenant self-service is deliberately scoped to
 * "tickets I raised" (raisedByUserId === the caller), not "every ticket my tenant ever raised" —
 * the simplest ownership boundary that needs no new tenant RBAC permission at all; a future
 * org-wide view for tenant admins would need one and is left for when that's actually requested.
 */
@Injectable()
export class SupportTicketsService {
  constructor(
    private readonly platformPrisma: PlatformPrismaService,
    private readonly auditService: AuditService,
  ) {}

  async createForTenant(tenantId: string, dto: CreateSupportTicketDto, actorUserId: string) {
    const ticket = await this.platformPrisma.client.supportTicket.create({
      data: {
        tenantId,
        subject: dto.subject,
        description: dto.description,
        priority: (dto.priority ?? 'MEDIUM') as SupportTicketPriority,
        raisedByUserId: actorUserId,
      },
    });

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.SUPPORT_TICKET_CREATED,
      module: AUDIT_MODULES.SUPPORT,
      entityType: 'SupportTicket',
      entityId: ticket.id,
      after: { subject: ticket.subject, priority: ticket.priority },
    });

    return ticket;
  }

  async createByPlatformUser(dto: CreateSupportTicketDto, actorPlatformUserId: string) {
    const ticket = await this.platformPrisma.client.supportTicket.create({
      data: {
        tenantId: dto.tenantId,
        subject: dto.subject,
        description: dto.description,
        priority: (dto.priority ?? 'MEDIUM') as SupportTicketPriority,
        raisedByPlatformUserId: actorPlatformUserId,
      },
    });

    await this.auditService.record({
      scope: 'PLATFORM',
      tenantId: dto.tenantId,
      actorType: 'PLATFORM_USER',
      actorPlatformUserId,
      action: AUDIT_ACTIONS.SUPPORT_TICKET_CREATED,
      module: AUDIT_MODULES.SUPPORT,
      entityType: 'SupportTicket',
      entityId: ticket.id,
      after: { subject: ticket.subject, priority: ticket.priority },
    });

    return ticket;
  }

  async listForPlatform(query: ListSupportTicketsDto = {}) {
    const where = {
      tenantId: query.tenantId,
      status: query.status as SupportTicketStatus | undefined,
      priority: query.priority as SupportTicketPriority | undefined,
      assignedToPlatformUserId: query.assignedToPlatformUserId,
    };
    const [data, total] = await Promise.all([
      this.platformPrisma.client.supportTicket.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip ?? 0,
        take: query.take ?? 50,
      }),
      this.platformPrisma.client.supportTicket.count({ where }),
    ]);
    return { data, total };
  }

  async listOwnForTenant(tenantId: string, userId: string, query: ListTenantSupportTicketsDto = {}) {
    const where = { tenantId, raisedByUserId: userId, status: query.status as SupportTicketStatus | undefined };
    const [data, total] = await Promise.all([
      this.platformPrisma.client.supportTicket.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip ?? 0,
        take: query.take ?? 50,
      }),
      this.platformPrisma.client.supportTicket.count({ where }),
    ]);
    return { data, total };
  }

  async get(id: string) {
    const ticket = await this.platformPrisma.client.supportTicket.findUnique({
      where: { id },
      include: { comments: { orderBy: { createdAt: 'asc' } } },
    });
    if (!ticket) {
      throw new NotFoundException('Support ticket not found.');
    }
    return ticket;
  }

  async getOwnForTenant(tenantId: string, userId: string, id: string) {
    const ticket = await this.get(id);
    if (ticket.tenantId !== tenantId || ticket.raisedByUserId !== userId) {
      throw new NotFoundException('Support ticket not found.');
    }
    return ticket;
  }

  async updateStatus(id: string, dto: UpdateSupportTicketDto, actorPlatformUserId: string) {
    const before = await this.platformPrisma.client.supportTicket.findUniqueOrThrow({ where: { id } });
    const isResolving = dto.status === 'RESOLVED' || dto.status === 'CLOSED';

    const ticket = await this.platformPrisma.client.supportTicket.update({
      where: { id },
      data: {
        status: dto.status as SupportTicketStatus | undefined,
        priority: dto.priority as SupportTicketPriority | undefined,
        resolvedAt: isResolving ? new Date() : before.resolvedAt,
      },
    });

    await this.auditService.record({
      scope: 'PLATFORM',
      tenantId: ticket.tenantId,
      actorType: 'PLATFORM_USER',
      actorPlatformUserId,
      action: AUDIT_ACTIONS.SUPPORT_TICKET_UPDATED,
      module: AUDIT_MODULES.SUPPORT,
      entityType: 'SupportTicket',
      entityId: id,
      before: { status: before.status, priority: before.priority },
      after: { status: ticket.status, priority: ticket.priority },
    });

    return ticket;
  }

  async assign(id: string, assignedToPlatformUserId: string, actorPlatformUserId: string) {
    const assignee = await this.platformPrisma.client.platformUser.findUnique({ where: { id: assignedToPlatformUserId } });
    if (!assignee) {
      throw new NotFoundException('Platform user not found.');
    }

    const ticket = await this.platformPrisma.client.supportTicket.update({
      where: { id },
      data: { assignedToPlatformUserId },
    });

    await this.auditService.record({
      scope: 'PLATFORM',
      tenantId: ticket.tenantId,
      actorType: 'PLATFORM_USER',
      actorPlatformUserId,
      action: AUDIT_ACTIONS.SUPPORT_TICKET_ASSIGNED,
      module: AUDIT_MODULES.SUPPORT,
      entityType: 'SupportTicket',
      entityId: id,
      after: { assignedToPlatformUserId },
    });

    return ticket;
  }

  async addCommentAsTenantUser(tenantId: string, ticketId: string, dto: AddSupportTicketCommentDto, actorUserId: string) {
    const ticket = await this.getOwnForTenant(tenantId, actorUserId, ticketId);

    const comment = await this.platformPrisma.client.supportTicketComment.create({
      data: { ticketId: ticket.id, authorType: 'USER', authorUserId: actorUserId, body: dto.body },
    });

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.SUPPORT_TICKET_COMMENTED,
      module: AUDIT_MODULES.SUPPORT,
      entityType: 'SupportTicket',
      entityId: ticket.id,
    });

    return comment;
  }

  async addCommentAsPlatformUser(ticketId: string, dto: AddSupportTicketCommentDto, actorPlatformUserId: string) {
    const ticket = await this.get(ticketId);

    const comment = await this.platformPrisma.client.supportTicketComment.create({
      data: { ticketId: ticket.id, authorType: 'PLATFORM_USER', authorPlatformUserId: actorPlatformUserId, body: dto.body },
    });

    await this.auditService.record({
      scope: 'PLATFORM',
      tenantId: ticket.tenantId,
      actorType: 'PLATFORM_USER',
      actorPlatformUserId,
      action: AUDIT_ACTIONS.SUPPORT_TICKET_COMMENTED,
      module: AUDIT_MODULES.SUPPORT,
      entityType: 'SupportTicket',
      entityId: ticket.id,
    });

    return comment;
  }
}
