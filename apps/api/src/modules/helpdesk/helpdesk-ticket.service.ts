/**
 * Helpdesk ticket service — the ticket lifecycle: creation with SLA assignment, assignment,
 * the status workflow (open → in progress → pending → resolved → closed, resolution and
 * reopening), internal notes, attachments, manual + SLA escalation, feedback/satisfaction, and
 * dashboard/report queries live in HelpdeskReportService. Lifecycle events fan out through the
 * shared NotificationsService and, when a category requires approval, an approval instance is
 * started against the generic workflow engine (entityType "HelpdeskTicket") — best-effort, so a
 * helpdesk action never fails because workflow/notification infrastructure is unavailable.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AUDIT_ACTIONS, AUDIT_MODULES } from '@college-erp/auth';
import type { HelpdeskTicketStatus, PrismaClient } from '@college-erp/database';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WorkflowDefinitionsService } from '../workflow/workflow-definitions.service';
import { WorkflowEngineService } from '../workflow/workflow-engine.service';
import { nextHelpdeskSeriesNumber } from './helpdesk-sequences';
import { HelpdeskConfigService } from './helpdesk-config.service';
import {
  HELPDESK_OPEN_STATUSES,
  type AddHelpdeskAttachmentDto,
  type AddHelpdeskCommentDto,
  type AssignHelpdeskTicketDto,
  type ChangeHelpdeskTicketStatusDto,
  type CreateHelpdeskTicketDto,
  type EscalateHelpdeskTicketDto,
  type ListHelpdeskTicketsDto,
  type ReopenHelpdeskTicketDto,
  type ResolveHelpdeskTicketDto,
  type SubmitHelpdeskFeedbackDto,
  type UpdateHelpdeskTicketDto,
} from './dto/helpdesk.dto';

type Client = PrismaClient;

const WORKFLOW_ENTITY_TYPE = 'HelpdeskTicket';
const OPEN_STATUSES = [...HELPDESK_OPEN_STATUSES] as HelpdeskTicketStatus[];
const TERMINAL_STATUSES: HelpdeskTicketStatus[] = ['RESOLVED', 'CLOSED', 'CANCELLED'];

/** Allowed status transitions for the helpdesk state machine. */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  NEW: ['OPEN', 'IN_PROGRESS', 'PENDING', 'CANCELLED'],
  OPEN: ['IN_PROGRESS', 'PENDING', 'RESOLVED', 'CANCELLED'],
  IN_PROGRESS: ['PENDING', 'RESOLVED', 'CLOSED', 'CANCELLED'],
  PENDING: ['IN_PROGRESS', 'RESOLVED', 'CANCELLED'],
  RESOLVED: ['CLOSED', 'REOPENED'],
  CLOSED: ['REOPENED'],
  REOPENED: ['IN_PROGRESS', 'PENDING', 'RESOLVED', 'CANCELLED'],
  CANCELLED: [],
};

@Injectable()
export class HelpdeskTicketService {
  private readonly logger = new Logger(HelpdeskTicketService.name);

  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly config: HelpdeskConfigService,
    private readonly auditService: AuditService,
    private readonly notifications: NotificationsService,
    private readonly workflowDefinitions: WorkflowDefinitionsService,
    private readonly workflowEngine: WorkflowEngineService,
  ) {}

  private get db(): Client {
    return this.tenantPrisma.client as unknown as Client;
  }

  private async audit(
    tenantId: string,
    userId: string | null,
    action: string,
    entityId: string,
    extra?: { before?: unknown; after?: unknown },
  ) {
    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: userId ? 'USER' : 'SYSTEM',
      actorUserId: userId ?? undefined,
      action,
      module: AUDIT_MODULES.HELPDESK,
      entityType: 'HelpdeskTicket',
      entityId,
      before: extra?.before,
      after: extra?.after,
    });
  }

  private async notify(tenantId: string, recipientUserId: string | null | undefined, subject: string, body: string) {
    if (!recipientUserId) return;
    try {
      await this.notifications.sendSystem(tenantId, { recipientUserId, channel: 'IN_APP', subject, body });
    } catch (error) {
      this.logger.warn(`Helpdesk notification to ${recipientUserId} failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  private async recordHistory(
    tenantId: string,
    ticketId: string,
    event: string,
    opts: { actorUserId?: string | null; actorType?: string; fromValue?: string | null; toValue?: string | null; note?: string | null } = {},
  ) {
    await this.db.helpdeskTicketHistory.create({
      data: {
        tenantId,
        ticketId,
        event: event as any,
        actorUserId: opts.actorUserId ?? null,
        actorType: opts.actorType ?? 'USER',
        fromValue: opts.fromValue ?? null,
        toValue: opts.toValue ?? null,
        note: opts.note ?? null,
      },
    });
  }

  // ── Create ─────────────────────────────────────────────────────────────────

  async create(tenantId: string, userId: string, dto: CreateHelpdeskTicketDto) {
    const category = await this.db.helpdeskCategory.findFirst({ where: { id: dto.categoryId } });
    if (!category) throw new NotFoundException('Helpdesk category not found.');

    const departmentId = dto.departmentId ?? category.defaultDepartmentId ?? null;
    if (departmentId) await this.assertDepartmentExists(departmentId);
    if (dto.assignedToUserId) await this.assertUserExists(dto.assignedToUserId);
    if (dto.requesterUserId) await this.assertUserExists(dto.requesterUserId);

    const priority = dto.priority ?? category.defaultPriority ?? 'MEDIUM';
    const slaPolicy = await this.config.resolveSlaPolicyFor(tenantId, { categoryId: category.id, priority, departmentId });
    const now = new Date();
    const responseDueAt = slaPolicy ? new Date(now.getTime() + slaPolicy.responseMinutes * 60_000) : null;
    const resolutionDueAt = slaPolicy ? new Date(now.getTime() + slaPolicy.resolutionMinutes * 60_000) : null;

    const documents = dto.attachmentDocumentIds?.length ? await this.loadDocuments(dto.attachmentDocumentIds) : [];

    const ticket = await this.tenantPrisma.client.$transaction(async (tx: any) => {
      const ticketNumber = await nextHelpdeskSeriesNumber(tx, tenantId, 'TICKET', `HD-${now.getFullYear()}`);
      const created = await tx.helpdeskTicket.create({
        data: {
          tenantId,
          ticketNumber,
          subject: dto.subject,
          description: dto.description,
          status: 'NEW',
          priority,
          source: dto.source ?? 'WEB',
          categoryId: category.id,
          departmentId,
          slaPolicyId: slaPolicy?.id ?? null,
          requesterUserId: dto.requesterUserId ?? userId,
          requesterName: dto.requesterName ?? null,
          requesterEmail: dto.requesterEmail ?? null,
          assignedToUserId: dto.assignedToUserId ?? null,
          responseDueAt,
          resolutionDueAt,
          tags: dto.tags ?? [],
          createdBy: userId,
          updatedBy: userId,
        },
      });

      await tx.helpdeskTicketHistory.create({
        data: {
          tenantId,
          ticketId: created.id,
          event: 'CREATED',
          actorUserId: userId,
          actorType: 'USER',
          toValue: 'NEW',
        },
      });

      for (const doc of documents) {
        await tx.helpdeskTicketAttachment.create({
          data: {
            tenantId,
            ticketId: created.id,
            documentId: doc.id,
            filename: doc.originalFilename,
            mimeType: doc.mimeType,
            sizeBytes: doc.sizeBytes ?? null,
            uploadedBy: userId,
          },
        });
      }

      return created;
    });

    await this.audit(tenantId, userId, AUDIT_ACTIONS.HELPDESK_TICKET_CREATED, ticket.id, { after: { ticketNumber: ticket.ticketNumber, priority, categoryId: category.id } });

    const requesterId = ticket.requesterUserId;
    await this.notify(tenantId, requesterId, `Ticket ${ticket.ticketNumber} created`, `Your helpdesk ticket "${ticket.subject}" has been received.`);
    if (ticket.assignedToUserId) {
      await this.notify(tenantId, ticket.assignedToUserId, `Ticket ${ticket.ticketNumber} assigned to you`, ticket.subject);
    }

    if (category.requiresApproval) {
      await this.syncWorkflow(tenantId, userId, ticket, 'SUBMIT');
    }

    return this.get(tenantId, ticket.id);
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  private buildWhere(tenantId: string, q: ListHelpdeskTicketsDto, userId?: string) {
    const where: any = {};
    if (q.status) where.status = q.status;
    if (q.priority) where.priority = q.priority;
    if (q.categoryId) where.categoryId = q.categoryId;
    if (q.departmentId) where.departmentId = q.departmentId;
    if (q.assignedToUserId) where.assignedToUserId = q.assignedToUserId;
    if (q.requesterUserId) where.requesterUserId = q.requesterUserId;
    if (q.unassigned) where.assignedToUserId = null;
    if (q.mine && userId) where.assignedToUserId = userId;
    if (q.breached) {
      where.OR = [
        { responseDueAt: { lt: new Date(), not: null }, firstRespondedAt: null },
        { resolutionDueAt: { lt: new Date() }, status: { in: OPEN_STATUSES } },
      ];
    }
    if (q.dateFrom || q.dateTo) {
      where.createdAt = {};
      if (q.dateFrom) where.createdAt.gte = new Date(q.dateFrom);
      if (q.dateTo) where.createdAt.lte = new Date(q.dateTo);
    }
    if (q.search) {
      const search = [
        { ticketNumber: { contains: q.search, mode: 'insensitive' } },
        { subject: { contains: q.search, mode: 'insensitive' } },
        { description: { contains: q.search, mode: 'insensitive' } },
      ];
      where.AND = [{ OR: search }];
    }
    return where;
  }

  async list(tenantId: string, userId: string, q: ListHelpdeskTicketsDto) {
    const where = this.buildWhere(tenantId, q, userId);
    const skip = q.skip ?? 0;
    const take = q.take ?? 50;
    const [items, total] = await Promise.all([
      this.db.helpdeskTicket.findMany({
        where,
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        skip,
        take,
        include: {
          category: { select: { id: true, name: true } },
          department: { select: { id: true, name: true } },
          slaPolicy: { select: { id: true, name: true } },
          _count: { select: { comments: true, attachments: true, escalations: true } },
        },
      }),
      this.db.helpdeskTicket.count({ where }),
    ]);
    return { items, total, skip, take };
  }

  async listMine(tenantId: string, userId: string, q: ListHelpdeskTicketsDto) {
    const scoped = { ...q, requesterUserId: userId };
    return this.list(tenantId, userId, scoped as ListHelpdeskTicketsDto);
  }

  async get(tenantId: string, id: string, opts: { includeInternal?: boolean } = {}) {
    const ticket = await this.db.helpdeskTicket.findFirst({
      where: { id },
      include: {
        category: { select: { id: true, code: true, name: true } },
        department: { select: { id: true, code: true, name: true } },
        slaPolicy: true,
        history: { orderBy: { createdAt: 'asc' } },
        escalations: { orderBy: { createdAt: 'asc' } },
        feedback: { orderBy: { createdAt: 'desc' } },
        attachments: { orderBy: { createdAt: 'asc' } },
        comments: {
          where: opts.includeInternal === false ? { visibility: 'PUBLIC' } : {},
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!ticket) throw new NotFoundException('Helpdesk ticket not found.');
    return ticket;
  }

  async listComments(tenantId: string, id: string, includeInternal = true) {
    await this.findTicketOrThrow(id);
    return this.db.helpdeskTicketComment.findMany({
      where: { ticketId: id, ...(includeInternal ? {} : { visibility: 'PUBLIC' }) },
      orderBy: { createdAt: 'asc' },
    });
  }

  async listAttachments(tenantId: string, id: string) {
    await this.findTicketOrThrow(id);
    return this.db.helpdeskTicketAttachment.findMany({ where: { ticketId: id }, orderBy: { createdAt: 'asc' } });
  }

  async listHistory(tenantId: string, id: string) {
    await this.findTicketOrThrow(id);
    return this.db.helpdeskTicketHistory.findMany({ where: { ticketId: id }, orderBy: { createdAt: 'asc' } });
  }

  async listEscalations(tenantId: string, id: string) {
    await this.findTicketOrThrow(id);
    return this.db.helpdeskEscalation.findMany({ where: { ticketId: id }, orderBy: { createdAt: 'asc' } });
  }

  // ── Update ─────────────────────────────────────────────────────────────────

  async update(tenantId: string, userId: string, id: string, dto: UpdateHelpdeskTicketDto) {
    const ticket = await this.findTicketOrThrow(id);
    if (ticket.status === 'CLOSED' || ticket.status === 'CANCELLED') {
      throw new BadRequestException(`A ${ticket.status.toLowerCase()} ticket cannot be edited.`);
    }

    const data: any = { updatedBy: userId };
    if (dto.subject !== undefined) data.subject = dto.subject;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.source !== undefined) data.source = dto.source;
    if (dto.tags !== undefined) data.tags = dto.tags;
    if (dto.requesterName !== undefined) data.requesterName = dto.requesterName;
    if (dto.requesterEmail !== undefined) data.requesterEmail = dto.requesterEmail;

    if (dto.assignedToUserId !== undefined) {
      if (dto.assignedToUserId) await this.assertUserExists(dto.assignedToUserId);
      data.assignedToUserId = dto.assignedToUserId;
    }
    if (dto.departmentId !== undefined) {
      if (dto.departmentId) await this.assertDepartmentExists(dto.departmentId);
      data.departmentId = dto.departmentId;
    }
    if (dto.categoryId !== undefined) {
      const category = await this.db.helpdeskCategory.findFirst({ where: { id: dto.categoryId } });
      if (!category) throw new NotFoundException('Helpdesk category not found.');
      data.categoryId = dto.categoryId;
    }

    const priorityChanged = dto.priority !== undefined && dto.priority !== ticket.priority;
    if (dto.priority !== undefined) data.priority = dto.priority;

    const affectsSla = priorityChanged || dto.departmentId !== undefined || dto.categoryId !== undefined;
    if (affectsSla && !ticket.firstRespondedAt) {
      const policy = await this.config.resolveSlaPolicyFor(tenantId, {
        categoryId: data.categoryId ?? ticket.categoryId,
        priority: data.priority ?? ticket.priority,
        departmentId: data.departmentId ?? ticket.departmentId,
      });
      if (policy) {
        data.slaPolicyId = policy.id;
        data.resolutionDueAt = new Date(ticket.createdAt.getTime() + policy.resolutionMinutes * 60_000);
        if (!ticket.firstRespondedAt) {
          data.responseDueAt = new Date(ticket.createdAt.getTime() + policy.responseMinutes * 60_000);
        }
      }
    }

    const updated = await this.db.helpdeskTicket.update({ where: { id }, data });

    if (priorityChanged) {
      await this.recordHistory(tenantId, id, 'PRIORITY_CHANGED', { actorUserId: userId, fromValue: ticket.priority, toValue: data.priority });
    }
    if (dto.departmentId !== undefined && dto.departmentId !== ticket.departmentId) {
      await this.recordHistory(tenantId, id, 'DEPARTMENT_CHANGED', { actorUserId: userId, fromValue: ticket.departmentId, toValue: dto.departmentId });
    }
    if (dto.categoryId !== undefined && dto.categoryId !== ticket.categoryId) {
      await this.recordHistory(tenantId, id, 'CATEGORY_CHANGED', { actorUserId: userId, fromValue: ticket.categoryId, toValue: dto.categoryId });
    }
    await this.recordHistory(tenantId, id, 'UPDATED', { actorUserId: userId });

    await this.audit(tenantId, userId, AUDIT_ACTIONS.HELPDESK_TICKET_UPDATED, id, { before: ticket, after: updated });
    return this.get(tenantId, id);
  }

  async remove(tenantId: string, userId: string, id: string) {
    const ticket = await this.findTicketOrThrow(id);
    await this.db.helpdeskTicket.delete({ where: { id } });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.HELPDESK_TICKET_DELETED, id, { before: ticket });
    return { deleted: true };
  }

  // ── Assignment ─────────────────────────────────────────────────────────────

  async assign(tenantId: string, userId: string, id: string, dto: AssignHelpdeskTicketDto) {
    const ticket = await this.findTicketOrThrow(id);
    if (TERMINAL_STATUSES.includes(ticket.status) && ticket.status !== 'RESOLVED') {
      throw new BadRequestException(`A ${ticket.status.toLowerCase()} ticket cannot be reassigned.`);
    }
    if (dto.assignedToUserId) await this.assertUserExists(dto.assignedToUserId);
    if (dto.departmentId) await this.assertDepartmentExists(dto.departmentId);

    const data: any = { updatedBy: userId };
    if (dto.assignedToUserId !== undefined) data.assignedToUserId = dto.assignedToUserId;
    if (dto.departmentId !== undefined) data.departmentId = dto.departmentId;
    if (ticket.status === 'NEW') data.status = 'OPEN';

    const updated = await this.db.helpdeskTicket.update({ where: { id }, data });
    await this.recordHistory(tenantId, id, 'ASSIGNED', {
      actorUserId: userId,
      fromValue: ticket.assignedToUserId,
      toValue: dto.assignedToUserId ?? null,
      note: dto.note,
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.HELPDESK_TICKET_ASSIGNED, id, { after: { assignedToUserId: data.assignedToUserId, departmentId: data.departmentId } });

    if (dto.assignedToUserId && dto.assignedToUserId !== ticket.assignedToUserId) {
      await this.notify(tenantId, dto.assignedToUserId, `Ticket ${ticket.ticketNumber} assigned to you`, ticket.subject);
    }
    return this.get(tenantId, id);
  }

  // ── Status workflow ────────────────────────────────────────────────────────

  async changeStatus(tenantId: string, userId: string, id: string, dto: ChangeHelpdeskTicketStatusDto) {
    return this.transitionStatus(tenantId, userId, id, dto.status, { note: dto.note, resolutionSummary: dto.resolutionSummary });
  }

  async resolve(tenantId: string, userId: string, id: string, dto: ResolveHelpdeskTicketDto) {
    return this.transitionStatus(tenantId, userId, id, 'RESOLVED', { note: dto.note, resolutionSummary: dto.resolutionSummary });
  }

  async close(tenantId: string, userId: string, id: string) {
    return this.transitionStatus(tenantId, userId, id, 'CLOSED', {});
  }

  async cancel(tenantId: string, userId: string, id: string) {
    return this.transitionStatus(tenantId, userId, id, 'CANCELLED', {});
  }

  async reopen(tenantId: string, userId: string, id: string, dto: ReopenHelpdeskTicketDto) {
    return this.transitionStatus(tenantId, userId, id, 'REOPENED', { note: dto.reason });
  }

  private async transitionStatus(
    tenantId: string,
    userId: string,
    id: string,
    newStatus: string,
    opts: { note?: string; resolutionSummary?: string },
  ) {
    const ticket = await this.findTicketOrThrow(id);
    if (ticket.status === newStatus) {
      throw new BadRequestException(`Ticket is already ${newStatus.toLowerCase()}.`);
    }
    const allowed = ALLOWED_TRANSITIONS[ticket.status] ?? [];
    if (!allowed.includes(newStatus)) {
      throw new BadRequestException(`Cannot move a ${ticket.status} ticket to ${newStatus}.`);
    }

    const now = new Date();
    const data: any = { status: newStatus, updatedBy: userId };

    if (newStatus === 'RESOLVED') {
      const summary = opts.resolutionSummary ?? ticket.resolutionSummary;
      if (!summary) throw new BadRequestException('A resolution summary is required to resolve a ticket.');
      data.resolutionSummary = summary;
      data.resolvedAt = now;
    }
    if (newStatus === 'CLOSED') data.closedAt = now;
    if (newStatus === 'CANCELLED') data.cancelledAt = now;
    if (newStatus === 'REOPENED') {
      data.resolvedAt = null;
      data.closedAt = null;
      data.satisfactionSubmittedAt = null;
      data.reopenedCount = (ticket.reopenedCount ?? 0) + 1;
      const policy = ticket.slaPolicyId
        ? await this.db.helpdeskSlaPolicy.findFirst({ where: { id: ticket.slaPolicyId } })
        : await this.config.resolveSlaPolicyFor(tenantId, { categoryId: ticket.categoryId, priority: ticket.priority, departmentId: ticket.departmentId });
      if (policy) {
        data.resolutionDueAt = new Date(now.getTime() + policy.resolutionMinutes * 60_000);
      }
    }

    // First staff response: moving a fresh ticket forward counts as the first response when the
    // acting user is not the requester.
    const isStaffAction = userId !== ticket.requesterUserId;
    if (!ticket.firstRespondedAt && isStaffAction && ['IN_PROGRESS', 'PENDING', 'RESOLVED', 'CLOSED'].includes(newStatus)) {
      data.firstRespondedAt = now;
    }

    const updated = await this.db.helpdeskTicket.update({ where: { id }, data });

    await this.recordHistory(tenantId, id, 'STATUS_CHANGED', {
      actorUserId: userId,
      fromValue: ticket.status,
      toValue: newStatus,
      note: opts.note,
    });
    if (newStatus === 'RESOLVED') await this.recordHistory(tenantId, id, 'RESOLVED', { actorUserId: userId, note: opts.resolutionSummary });
    if (newStatus === 'REOPENED') await this.recordHistory(tenantId, id, 'REOPENED', { actorUserId: userId, note: opts.note });
    if (newStatus === 'CLOSED') await this.recordHistory(tenantId, id, 'CLOSED', { actorUserId: userId });

    const actionMap: Record<string, string> = {
      RESOLVED: AUDIT_ACTIONS.HELPDESK_TICKET_RESOLVED,
      CLOSED: AUDIT_ACTIONS.HELPDESK_TICKET_CLOSED,
      CANCELLED: AUDIT_ACTIONS.HELPDESK_TICKET_CANCELLED,
      REOPENED: AUDIT_ACTIONS.HELPDESK_TICKET_REOPENED,
    };
    await this.audit(tenantId, userId, actionMap[newStatus] ?? AUDIT_ACTIONS.HELPDESK_TICKET_STATUS_CHANGED, id, { before: { status: ticket.status }, after: { status: newStatus } });

    await this.notify(
      tenantId,
      ticket.requesterUserId,
      `Ticket ${ticket.ticketNumber} ${newStatus.toLowerCase().replace('_', ' ')}`,
      `${ticket.subject} — status is now ${newStatus}.`,
    );
    if (newStatus === 'REOPENED') {
      await this.notify(tenantId, ticket.assignedToUserId, `Ticket ${ticket.ticketNumber} reopened`, ticket.subject);
    }
    if (newStatus === 'CANCELLED') {
      await this.syncWorkflow(tenantId, userId, ticket, 'CANCEL');
    }

    return this.get(tenantId, id);
  }

  // ── Comments & attachments ─────────────────────────────────────────────────

  async addComment(tenantId: string, userId: string, id: string, dto: AddHelpdeskCommentDto) {
    const ticket = await this.findTicketOrThrow(id);
    if (ticket.status === 'CANCELLED') throw new BadRequestException('Cannot comment on a cancelled ticket.');

    const documents = dto.attachmentDocumentIds?.length ? await this.loadDocuments(dto.attachmentDocumentIds) : [];

    const comment = await this.tenantPrisma.client.$transaction(async (tx: any) => {
      const created = await tx.helpdeskTicketComment.create({
        data: {
          tenantId,
          ticketId: id,
          authorUserId: userId,
          body: dto.body,
          visibility: dto.visibility ?? 'PUBLIC',
          isResolutionNote: dto.isResolutionNote ?? false,
          createdBy: userId,
        },
      });
      for (const doc of documents) {
        await tx.helpdeskTicketAttachment.create({
          data: {
            tenantId,
            ticketId: id,
            commentId: created.id,
            documentId: doc.id,
            filename: doc.originalFilename,
            mimeType: doc.mimeType,
            sizeBytes: doc.sizeBytes ?? null,
            uploadedBy: userId,
          },
        });
      }
      return created;
    });

    const update: any = { updatedBy: userId };
    // A public staff comment counts as the first response, and any public comment moves a NEW
    // ticket to OPEN so it leaves the intake queue.
    if (userId !== ticket.requesterUserId && !ticket.firstRespondedAt) {
      update.firstRespondedAt = new Date();
    }
    if (ticket.status === 'NEW' && userId !== ticket.requesterUserId) {
      update.status = 'OPEN';
    }
    await this.db.helpdeskTicket.update({ where: { id }, data: update });

    await this.recordHistory(tenantId, id, 'COMMENTED', { actorUserId: userId, toValue: comment.visibility });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.HELPDESK_TICKET_COMMENTED, id, { after: { commentId: comment.id, visibility: comment.visibility } });

    if (comment.visibility === 'INTERNAL') {
      if (ticket.assignedToUserId && ticket.assignedToUserId !== userId) {
        await this.notify(tenantId, ticket.assignedToUserId, `Internal note on ${ticket.ticketNumber}`, dto.body.slice(0, 140));
      }
    } else {
      if (ticket.requesterUserId && ticket.requesterUserId !== userId) {
        await this.notify(tenantId, ticket.requesterUserId, `New reply on ${ticket.ticketNumber}`, dto.body.slice(0, 140));
      }
      if (ticket.assignedToUserId && ticket.assignedToUserId !== userId && ticket.assignedToUserId !== ticket.requesterUserId) {
        await this.notify(tenantId, ticket.assignedToUserId, `New reply on ${ticket.ticketNumber}`, dto.body.slice(0, 140));
      }
    }

    return this.get(tenantId, id);
  }

  async addAttachment(tenantId: string, userId: string, id: string, dto: AddHelpdeskAttachmentDto) {
    const ticket = await this.findTicketOrThrow(id);
    const [doc] = await this.loadDocuments([dto.documentId]);
    if (!doc) throw new NotFoundException('Document not found.');
    if (dto.commentId) {
      const comment = await this.db.helpdeskTicketComment.findFirst({ where: { id: dto.commentId, ticketId: id } });
      if (!comment) throw new NotFoundException('Comment not found on this ticket.');
    }

    const attachment = await this.db.helpdeskTicketAttachment.create({
      data: {
        tenantId,
        ticketId: id,
        commentId: dto.commentId ?? null,
        documentId: doc.id,
        filename: doc.originalFilename,
        mimeType: doc.mimeType,
        sizeBytes: doc.sizeBytes ?? null,
        uploadedBy: userId,
      },
    });
    await this.recordHistory(tenantId, id, 'ATTACHED', { actorUserId: userId, toValue: doc.originalFilename });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.HELPDESK_TICKET_ATTACHMENT_ADDED, id, { after: { attachmentId: attachment.id } });
    return attachment;
  }

  async removeAttachment(tenantId: string, userId: string, id: string, attachmentId: string) {
    await this.findTicketOrThrow(id);
    const attachment = await this.db.helpdeskTicketAttachment.findFirst({ where: { id: attachmentId, ticketId: id } });
    if (!attachment) throw new NotFoundException('Attachment not found.');
    await this.db.helpdeskTicketAttachment.delete({ where: { id: attachmentId } });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.HELPDESK_TICKET_ATTACHMENT_DELETED, id, { before: { attachmentId } });
    return { deleted: true };
  }

  // ── Escalation ─────────────────────────────────────────────────────────────

  async escalate(tenantId: string, userId: string, id: string, dto: EscalateHelpdeskTicketDto) {
    const ticket = await this.findTicketOrThrow(id);
    return this.applyEscalation(tenantId, ticket, {
      reason: 'MANUAL',
      toUserId: dto.toUserId ?? null,
      toRoleCode: dto.toRoleCode ?? null,
      note: dto.note ?? null,
      escalatedByUserId: userId,
    });
  }

  private async applyEscalation(
    tenantId: string,
    ticket: any,
    opts: { reason: string; toUserId?: string | null; toRoleCode?: string | null; note?: string | null; escalatedByUserId?: string | null },
  ) {
    const level = (ticket.escalationLevel ?? 0) + 1;
    await this.db.helpdeskEscalation.create({
      data: {
        tenantId,
        ticketId: ticket.id,
        reason: opts.reason as any,
        level,
        fromAssigneeUserId: ticket.assignedToUserId ?? null,
        toUserId: opts.toUserId ?? null,
        toRoleCode: opts.toRoleCode ?? null,
        note: opts.note ?? null,
        escalatedByUserId: opts.escalatedByUserId ?? null,
      },
    });

    const data: any = { escalationLevel: level, escalatedAt: new Date(), updatedBy: opts.escalatedByUserId ?? undefined };
    if (opts.toUserId) data.assignedToUserId = opts.toUserId;
    await this.db.helpdeskTicket.update({ where: { id: ticket.id }, data });

    await this.recordHistory(tenantId, ticket.id, opts.reason === 'MANUAL' ? 'ESCALATED' : 'SLA_BREACHED', {
      actorUserId: opts.escalatedByUserId ?? null,
      actorType: opts.escalatedByUserId ? 'USER' : 'SYSTEM',
      toValue: opts.reason,
      note: opts.note,
    });
    await this.audit(tenantId, opts.escalatedByUserId ?? null, AUDIT_ACTIONS.HELPDESK_TICKET_ESCALATED, ticket.id, {
      after: { reason: opts.reason, level, toUserId: opts.toUserId, toRoleCode: opts.toRoleCode },
    });

    const recipients = new Set<string>();
    if (opts.toUserId) recipients.add(opts.toUserId);
    if (opts.toRoleCode) {
      for (const uid of await this.config.usersForRole(opts.toRoleCode)) recipients.add(uid);
    }
    for (const recipient of recipients) {
      await this.notify(
        tenantId,
        recipient,
        `Ticket ${ticket.ticketNumber} escalated`,
        `${ticket.subject} — escalated (${opts.reason}).${opts.note ? ` ${opts.note}` : ''}`,
      );
    }

    return this.get(tenantId, ticket.id);
  }

  /** Evaluates every open ticket against its SLA and auto-escalates breaches. Used by the manual
   * POST /helpdesk/sla/sweep endpoint; the worker's HelpdeskSlaSweepProcessor runs the same
   * evaluation on a schedule. */
  async sweepSla(tenantId: string, actorUserId: string | null) {
    const now = new Date();
    const openTickets = await this.db.helpdeskTicket.findMany({
      where: {
        status: { in: OPEN_STATUSES },
        OR: [
          { responseDueAt: { lt: now, not: null }, firstRespondedAt: null },
          { resolutionDueAt: { lt: now } },
        ],
      },
      select: { id: true },
    });

    let escalated = 0;
    for (const { id } of openTickets) {
      const ticket = await this.db.helpdeskTicket.findFirst({ where: { id } });
      if (!ticket) continue;
      const policy = ticket.slaPolicyId ? await this.db.helpdeskSlaPolicy.findFirst({ where: { id: ticket.slaPolicyId } }) : null;
      if (!policy?.escalateAfterMinutes) continue;
      const graceMs = policy.escalateAfterMinutes * 60_000;

      const existing = await this.db.helpdeskEscalation.findMany({ where: { ticketId: id }, select: { reason: true } });
      const reasons = new Set(existing.map((e: any) => e.reason));

      const responseBreached = !ticket.firstRespondedAt && ticket.responseDueAt && ticket.responseDueAt.getTime() + graceMs < now.getTime();
      const resolutionBreached = ticket.resolutionDueAt && ticket.resolutionDueAt.getTime() + graceMs < now.getTime();

      if (responseBreached && !reasons.has('RESPONSE_BREACH')) {
        await this.applyEscalation(tenantId, ticket, {
          reason: 'RESPONSE_BREACH',
          toRoleCode: policy.escalateToRoleCode,
          note: `First response was due ${ticket.responseDueAt?.toISOString()}.`,
          escalatedByUserId: actorUserId,
        });
        escalated += 1;
      } else if (resolutionBreached && !reasons.has('RESOLUTION_BREACH')) {
        await this.applyEscalation(tenantId, ticket, {
          reason: 'RESOLUTION_BREACH',
          toRoleCode: policy.escalateToRoleCode,
          note: `Resolution was due ${ticket.resolutionDueAt?.toISOString()}.`,
          escalatedByUserId: actorUserId,
        });
        escalated += 1;
      }
    }

    return { evaluated: openTickets.length, escalated };
  }

  // ── Feedback ───────────────────────────────────────────────────────────────

  async submitFeedback(tenantId: string, userId: string, id: string, dto: SubmitHelpdeskFeedbackDto) {
    const ticket = await this.findTicketOrThrow(id);
    if (!['RESOLVED', 'CLOSED'].includes(ticket.status)) {
      throw new BadRequestException('Feedback can only be submitted for resolved or closed tickets.');
    }
    const existing = await this.db.helpdeskFeedback.findFirst({ where: { ticketId: id } });
    if (existing) throw new BadRequestException('Feedback has already been submitted for this ticket.');

    const feedback = await this.tenantPrisma.client.$transaction(async (tx: any) => {
      const created = await tx.helpdeskFeedback.create({
        data: { tenantId, ticketId: id, score: dto.score, comment: dto.comment ?? null, submittedByUserId: userId },
      });
      await tx.helpdeskTicket.update({
        where: { id },
        data: { satisfactionScore: dto.score, satisfactionComment: dto.comment ?? null, satisfactionSubmittedAt: new Date() },
      });
      return created;
    });

    await this.recordHistory(tenantId, id, 'FEEDBACK_SUBMITTED', { actorUserId: userId, toValue: String(dto.score) });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.HELPDESK_FEEDBACK_SUBMITTED, id, { after: { score: dto.score } });
    await this.notify(tenantId, ticket.assignedToUserId, `Feedback received for ${ticket.ticketNumber}`, `Score: ${dto.score}/5.`);
    return feedback;
  }

  // ── Workflow integration ───────────────────────────────────────────────────

  async getWorkflow(tenantId: string, id: string) {
    await this.findTicketOrThrow(id);
    return this.workflowEngine.findInstance(tenantId, WORKFLOW_ENTITY_TYPE, id);
  }

  /** Best-effort attach/detach of a generic workflow approval instance for this ticket. Never
   * throws into the caller — helpdesk actions must not fail because workflow infrastructure is
   * unavailable (same contract as AdmissionsService.syncAdmissionWorkflow). */
  private async syncWorkflow(tenantId: string, userId: string, ticket: any, action: 'SUBMIT' | 'CANCEL') {
    try {
      if (action === 'CANCEL') {
        const instance = await this.workflowEngine.findInstance(tenantId, WORKFLOW_ENTITY_TYPE, ticket.id);
        if (instance && instance.status === 'IN_PROGRESS') {
          await this.workflowEngine.cancel(tenantId, instance.id, userId);
        }
        return;
      }

      const existing = await this.workflowDefinitions.getActiveDefinitionForEntityType(tenantId, WORKFLOW_ENTITY_TYPE);
      if (!existing) {
        await this.workflowDefinitions.createDefinition(
          tenantId,
          {
            code: 'HELPDESK_TICKET_APPROVAL_V1',
            name: 'Helpdesk Ticket Approval',
            description: 'Default pipeline for helpdesk tickets that require approval — auto-advances to approved so the ticket stays actionable.',
            entityType: WORKFLOW_ENTITY_TYPE,
            states: [
              { code: 'SUBMITTED', name: 'Ticket submitted', category: 'INITIAL' },
              { code: 'APPROVED', name: 'Ticket approved', category: 'APPROVED' },
            ],
            transitions: [
              {
                code: 'SUBMIT',
                name: 'Submit ticket',
                fromStateCode: 'SUBMITTED',
                toStateCode: 'APPROVED',
                action: 'SUBMIT',
                approvalMode: 'NONE',
              },
            ],
          },
          userId,
        );
      }

      const already = await this.workflowEngine.findInstance(tenantId, WORKFLOW_ENTITY_TYPE, ticket.id);
      if (already) return;

      await this.workflowEngine.startInstance(
        tenantId,
        {
          entityType: WORKFLOW_ENTITY_TYPE,
          entityId: ticket.id,
          context: { ticketId: ticket.id, ticketNumber: ticket.ticketNumber, priority: ticket.priority, departmentId: ticket.departmentId, categoryId: ticket.categoryId },
        },
        userId,
      );
    } catch (error) {
      this.logger.warn(`Helpdesk workflow sync skipped for ${ticket.id}: ${error instanceof Error ? error.message : error}`);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async findTicketOrThrow(id: string) {
    const ticket = await this.db.helpdeskTicket.findFirst({ where: { id } });
    if (!ticket) throw new NotFoundException('Helpdesk ticket not found.');
    return ticket;
  }

  private async assertDepartmentExists(id: string) {
    const found = await this.db.helpdeskDepartment.findFirst({ where: { id }, select: { id: true } });
    if (!found) throw new NotFoundException('Helpdesk department not found.');
  }

  private async assertUserExists(id: string) {
    const found = await this.db.user.findFirst({ where: { id }, select: { id: true } });
    if (!found) throw new NotFoundException('User not found in this tenant.');
  }

  private async loadDocuments(ids: string[]) {
    const unique = [...new Set(ids)];
    const docs = await this.db.document.findMany({ where: { id: { in: unique }, deletedAt: null } });
    const byId = new Map(docs.map((doc: any) => [doc.id, doc]));
    return unique.map((docId) => byId.get(docId)).filter(Boolean) as any[];
  }
}
