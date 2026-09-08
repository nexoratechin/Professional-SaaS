import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AUDIT_ACTIONS, AUDIT_MODULES } from '@college-erp/auth';
import type { Prisma, WorkflowInstance, WorkflowTransitionAction } from '@college-erp/database';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { ConditionExpression } from './condition-evaluator';
import { evaluateCondition } from './condition-evaluator';
import type { DecideTaskDto } from './dto/decide-task.dto';
import type { ResubmitInstanceDto } from './dto/resubmit-instance.dto';
import type { StartWorkflowInstanceDto } from './dto/start-workflow-instance.dto';
import { WorkflowApproverResolutionService } from './workflow-approver-resolution.service';
import { WorkflowDefinitionsService } from './workflow-definitions.service';

type DefinitionGraph = Awaited<ReturnType<WorkflowDefinitionsService['getDefinition']>>;
type TransitionInGraph = DefinitionGraph['transitions'][number];

export interface WorkflowActionMeta {
  ipAddress?: string;
  userAgent?: string;
}

/**
 * The RUNTIME half of the engine (WorkflowDefinitionsService owns configuration). Knows nothing
 * about admissions/fees/exams/etc. — every method here operates purely in terms of
 * WorkflowInstance/WorkflowApprovalTask rows and the generic state graph a tenant configured.
 *
 * The core loop: whenever an instance lands in a new state (on start, or after a transition
 * fires), enterState() looks at that state's outgoing APPROVE transition (condition + priority
 * resolved, at most one match). NONE-approvalMode transitions fire immediately and chain
 * (auto-advance); SEQUENTIAL/PARALLEL transitions instead create the first round of approval
 * tasks and stop, waiting for decide(). REJECT/CANCEL/RESUBMIT transitions are never fired
 * automatically — only in direct response to a rejection, cancel(), or resubmit() call.
 */
@Injectable()
export class WorkflowEngineService {
  private readonly logger = new Logger(WorkflowEngineService.name);

  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly definitions: WorkflowDefinitionsService,
    private readonly approverResolution: WorkflowApproverResolutionService,
    private readonly auditService: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async startInstance(tenantId: string, dto: StartWorkflowInstanceDto, actorUserId: string, meta: WorkflowActionMeta = {}) {
    const existing = await this.tenantPrisma.client.workflowInstance.findFirst({
      where: { entityType: dto.entityType, entityId: dto.entityId },
    });
    if (existing) {
      throw new BadRequestException(
        `A workflow instance already exists for ${dto.entityType}/${dto.entityId}. Use resubmit instead of starting a new one.`,
      );
    }

    const definition = await this.definitions.getActiveDefinitionForEntityType(tenantId, dto.entityType);
    if (!definition) {
      throw new NotFoundException(`No active workflow definition configured for entityType "${dto.entityType}".`);
    }
    const initialState = definition.states.find((state) => state.category === 'INITIAL');
    if (!initialState) {
      throw new BadRequestException(`Workflow definition "${definition.code}" has no INITIAL state.`);
    }

    const instance = await this.tenantPrisma.client.workflowInstance.create({
      data: {
        tenantId,
        definitionId: definition.id,
        entityType: dto.entityType,
        entityId: dto.entityId,
        currentStateId: initialState.id,
        context: (dto.context ?? undefined) as Prisma.InputJsonValue,
        startedBy: actorUserId,
      },
    });

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.WORKFLOW_INSTANCE_STARTED,
      module: AUDIT_MODULES.WORKFLOWS,
      entityType: dto.entityType,
      entityId: dto.entityId,
      after: { instanceId: instance.id, definitionCode: definition.code },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    const fullDefinition = await this.definitions.getDefinition(definition.id);
    await this.enterState(tenantId, instance, fullDefinition, actorUserId, meta);

    return this.getInstance(tenantId, instance.id);
  }

  async decide(tenantId: string, taskId: string, dto: DecideTaskDto, actorUserId: string, meta: WorkflowActionMeta = {}) {
    const task = await this.tenantPrisma.client.workflowApprovalTask.findFirst({
      where: { id: taskId },
      include: { approverSlot: true },
    });
    if (!task) {
      throw new NotFoundException('Approval task not found.');
    }
    if (task.status !== 'PENDING') {
      throw new BadRequestException(`This task is already ${task.status.toLowerCase()}.`);
    }

    const instance = await this.tenantPrisma.client.workflowInstance.findFirstOrThrow({ where: { id: task.instanceId } });
    const context = (instance.context ?? {}) as Record<string, unknown>;

    const isDirectlyAssigned = task.assignedUserId === actorUserId;
    const isEligibleForSlot =
      !!task.approverSlot && (await this.approverResolution.isUserEligible(task.approverSlot, context, actorUserId));
    // Escalation widens who may decide this task (see the field's schema doc comment) — checked
    // as an ad-hoc ROLE slot with no scope restriction, not a real WorkflowTransitionApprover row.
    const isEligibleViaEscalation =
      !!task.escalatedToRoleCode &&
      (await this.approverResolution.isUserEligible(
        { approverType: 'ROLE', roleCode: task.escalatedToRoleCode, specificUserId: null, scopeField: null },
        context,
        actorUserId,
      ));
    if (!isDirectlyAssigned && !isEligibleForSlot && !isEligibleViaEscalation) {
      throw new ForbiddenException('You are not an eligible approver for this task.');
    }

    const decidedStatus = dto.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    await this.tenantPrisma.client.workflowApprovalTask.update({
      where: { id: task.id },
      data: {
        status: decidedStatus,
        decidedByUserId: actorUserId,
        decidedAt: new Date(),
        comment: dto.comment,
        assignedUserId: task.assignedUserId ?? actorUserId,
      },
    });

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: dto.decision === 'APPROVE' ? AUDIT_ACTIONS.WORKFLOW_TASK_APPROVED : AUDIT_ACTIONS.WORKFLOW_TASK_REJECTED,
      module: AUDIT_MODULES.WORKFLOWS,
      entityType: instance.entityType,
      entityId: instance.entityId,
      after: { taskId: task.id, transitionId: task.transitionId, comment: dto.comment },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    const definition = await this.definitions.getDefinition(instance.definitionId);
    const transition = definition.transitions.find((t) => t.id === task.transitionId);
    if (!transition) {
      throw new NotFoundException('The transition this task belonged to no longer exists.');
    }

    await this.resolveTaskOutcome(tenantId, instance, definition, transition, actorUserId, meta);

    return this.getInstance(tenantId, instance.id);
  }

  async resubmit(tenantId: string, instanceId: string, dto: ResubmitInstanceDto, actorUserId: string, meta: WorkflowActionMeta = {}) {
    const instance = await this.tenantPrisma.client.workflowInstance.findFirst({ where: { id: instanceId } });
    if (!instance) {
      throw new NotFoundException('Workflow instance not found.');
    }
    const definition = await this.definitions.getDefinition(instance.definitionId);
    const currentState = definition.states.find((state) => state.id === instance.currentStateId);
    if (!currentState?.allowsResubmission) {
      throw new BadRequestException('This request cannot be resubmitted from its current state.');
    }

    const context = (dto.context ?? instance.context ?? {}) as Record<string, unknown>;
    const transition = this.selectTransition(definition.transitions, currentState.id, ['RESUBMIT'], context);
    if (!transition) {
      throw new BadRequestException('No resubmission path is configured from this state.');
    }

    // A state with allowsResubmission=true may itself be a REJECTED-category (terminal) state —
    // completeInstance() would already have set status/completedAt when the instance first
    // landed there. Reopening it here must clear both, or the instance would show as REJECTED
    // forever even while a fresh approval cycle is in progress.
    const updated = await this.tenantPrisma.client.workflowInstance.update({
      where: { id: instance.id },
      data: {
        status: 'IN_PROGRESS',
        completedAt: null,
        ...(dto.context ? { context: dto.context as Prisma.InputJsonValue } : {}),
      },
    });

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.WORKFLOW_RESUBMITTED,
      module: AUDIT_MODULES.WORKFLOWS,
      entityType: instance.entityType,
      entityId: instance.entityId,
      after: { instanceId: instance.id },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    await this.fireTransition(tenantId, updated, definition, transition, actorUserId, meta);
    return this.getInstance(tenantId, instance.id);
  }

  async cancel(tenantId: string, instanceId: string, actorUserId: string, meta: WorkflowActionMeta = {}) {
    const instance = await this.tenantPrisma.client.workflowInstance.findFirst({ where: { id: instanceId } });
    if (!instance) {
      throw new NotFoundException('Workflow instance not found.');
    }
    if (instance.status !== 'IN_PROGRESS') {
      throw new BadRequestException(`Cannot cancel an instance that is already ${instance.status.toLowerCase()}.`);
    }

    const definition = await this.definitions.getDefinition(instance.definitionId);
    const context = (instance.context ?? {}) as Record<string, unknown>;
    const transition = this.selectTransition(definition.transitions, instance.currentStateId, ['CANCEL'], context);
    if (!transition) {
      throw new BadRequestException('Cancellation is not configured from this state.');
    }

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.WORKFLOW_CANCELLED,
      module: AUDIT_MODULES.WORKFLOWS,
      entityType: instance.entityType,
      entityId: instance.entityId,
      after: { instanceId: instance.id },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    await this.fireTransition(tenantId, instance, definition, transition, actorUserId, meta);
    return this.getInstance(tenantId, instance.id);
  }

  async getInstance(tenantId: string, id: string) {
    const instance = await this.tenantPrisma.client.workflowInstance.findFirst({
      where: { id },
      include: {
        currentState: true,
        definition: true,
        tasks: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!instance) {
      throw new NotFoundException('Workflow instance not found.');
    }
    return instance;
  }

  async findInstance(tenantId: string, entityType: string, entityId: string) {
    return this.tenantPrisma.client.workflowInstance.findFirst({
      where: { entityType, entityId },
      include: { currentState: true, tasks: { orderBy: { createdAt: 'asc' } } },
    });
  }

  /** Every PENDING task the calling user is currently eligible to act on — either directly
   * assigned (SPECIFIC_USER slots), or matching a ROLE slot's role+scope (see
   * WorkflowApproverResolutionService). Scoped to a bounded recent window, not the whole table,
   * to keep this a reasonable in-memory filter rather than an unbounded scan as task volume
   * grows — a future iteration could precompute assignee rows instead. */
  async listMyTasks(tenantId: string, userId: string, take = 100) {
    const candidates = await this.tenantPrisma.client.workflowApprovalTask.findMany({
      where: { status: 'PENDING' },
      include: { approverSlot: true, instance: true },
      orderBy: { createdAt: 'asc' },
      take,
    });

    const mine = [];
    for (const task of candidates) {
      if (task.assignedUserId === userId) {
        mine.push(task);
        continue;
      }
      if (task.approverSlot) {
        const context = (task.instance.context ?? {}) as Record<string, unknown>;
        if (await this.approverResolution.isUserEligible(task.approverSlot, context, userId)) {
          mine.push(task);
        }
      }
    }
    return mine;
  }

  // ---------------------------------------------------------------------
  // Internal engine loop
  // ---------------------------------------------------------------------

  private selectTransition(
    transitions: TransitionInGraph[],
    fromStateId: string,
    actions: WorkflowTransitionAction[],
    context: Record<string, unknown>,
  ): TransitionInGraph | undefined {
    return transitions
      .filter((transition) => transition.fromStateId === fromStateId && actions.includes(transition.action))
      .sort((a, b) => b.priority - a.priority)
      .find((transition) => evaluateCondition(transition.conditionExpression as ConditionExpression | null, context));
  }

  /** Called whenever an instance lands in a (possibly new) state — on start, after a transition
   * fires, or after a rejection/cancel/resubmit path lands somewhere. */
  private async enterState(
    tenantId: string,
    instance: WorkflowInstance,
    definition: DefinitionGraph,
    actorUserId: string,
    meta: WorkflowActionMeta,
  ): Promise<void> {
    const currentState = definition.states.find((state) => state.id === instance.currentStateId);
    if (!currentState) {
      return;
    }

    if (currentState.category === 'APPROVED' || currentState.category === 'REJECTED' || currentState.category === 'CANCELLED') {
      await this.completeInstance(tenantId, instance, currentState.category, meta);
      return;
    }

    const context = (instance.context ?? {}) as Record<string, unknown>;
    // SUBMIT (leaving the INITIAL state) and APPROVE (leaving any later pending state) are both
    // "the primary forward path" from the engine's point of view — only their audit label
    // differs, chosen by whichever the definition's author used for that particular edge.
    const transition = this.selectTransition(definition.transitions, currentState.id, ['SUBMIT', 'APPROVE'], context);
    if (!transition) {
      // A non-terminal state with no configured forward path — nothing more to do until an
      // explicit cancel/resubmit/escalation acts on it.
      return;
    }

    if (transition.approvalMode === 'NONE') {
      await this.fireTransition(tenantId, instance, definition, transition, actorUserId, meta);
      return;
    }

    // A FRESH round — whether this is the transition's first time firing, or a resubmission
    // re-entering the very same transition (see createTasksForTransition's isNewRound param).
    await this.createTasksForTransition(tenantId, instance, transition, transition.approvalMode === 'PARALLEL', true);
  }

  private async fireTransition(
    tenantId: string,
    instance: WorkflowInstance,
    definition: DefinitionGraph,
    transition: TransitionInGraph,
    actorUserId: string,
    meta: WorkflowActionMeta,
  ): Promise<void> {
    const updated = await this.tenantPrisma.client.workflowInstance.update({
      where: { id: instance.id },
      data: { currentStateId: transition.toStateId },
    });

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.WORKFLOW_TRANSITIONED,
      module: AUDIT_MODULES.WORKFLOWS,
      entityType: instance.entityType,
      entityId: instance.entityId,
      after: { transitionCode: transition.code, fromStateId: transition.fromStateId, toStateId: transition.toStateId },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    await this.enterState(tenantId, updated, definition, actorUserId, meta);
  }

  private async createTasksForTransition(
    tenantId: string,
    instance: WorkflowInstance,
    transition: TransitionInGraph,
    isParallel: boolean,
    isNewRound: boolean,
  ): Promise<void> {
    const approvers = [...transition.approvers].sort((a, b) => a.sequenceOrder - b.sequenceOrder);
    if (approvers.length === 0) {
      return;
    }

    if (isNewRound) {
      // A rejection-then-resubmission cycle can re-enter the SAME transition (e.g. the HOD step
      // rejects, the requester fixes and resubmits, landing right back at the HOD step) — clear
      // any leftover task rows from the previous round before creating fresh ones, or
      // resolveTaskOutcome's approved/rejected counts would be contaminated by stale history.
      // The decision itself is never lost: AuditService already recorded it permanently.
      await this.tenantPrisma.client.workflowApprovalTask.deleteMany({
        where: { transitionId: transition.id, instanceId: instance.id },
      });
    }

    const slots = isParallel ? approvers : [approvers[0] as (typeof approvers)[number]];
    const dueAt = transition.deadlineHours ? new Date(Date.now() + transition.deadlineHours * 60 * 60 * 1000) : null;
    const context = (instance.context ?? {}) as Record<string, unknown>;

    for (const slot of slots) {
      const task = await this.tenantPrisma.client.workflowApprovalTask.create({
        data: {
          tenantId,
          instanceId: instance.id,
          transitionId: transition.id,
          approverSlotId: slot.id,
          assignedUserId: slot.approverType === 'SPECIFIC_USER' ? slot.specificUserId : null,
          sequenceOrder: slot.sequenceOrder,
          dueAt,
        },
      });

      const eligible = await this.approverResolution.resolveEligibleUsers(slot, context);
      await this.notifyApprovers(tenantId, eligible, instance, `Approval needed: ${transition.name}`, task.id);
    }
  }

  /** Applies the outcome of one decided task to the transition it belongs to — advancing to the
   * next SEQUENTIAL step, evaluating a PARALLEL rule, or resolving the whole transition once
   * enough decisions are in. */
  private async resolveTaskOutcome(
    tenantId: string,
    instance: WorkflowInstance,
    definition: DefinitionGraph,
    transition: TransitionInGraph,
    actorUserId: string,
    meta: WorkflowActionMeta,
  ): Promise<void> {
    const tasks = await this.tenantPrisma.client.workflowApprovalTask.findMany({
      where: { transitionId: transition.id, instanceId: instance.id },
      orderBy: { sequenceOrder: 'asc' },
    });

    if (transition.approvalMode === 'SEQUENTIAL') {
      const lastDecided = [...tasks].reverse().find((task) => task.status !== 'PENDING');
      if (lastDecided?.status === 'REJECTED') {
        await this.resolveRejection(tenantId, instance, definition, actorUserId, meta);
        return;
      }

      const approvers = [...transition.approvers].sort((a, b) => a.sequenceOrder - b.sequenceOrder);
      const nextIndex = tasks.filter((task) => task.status === 'APPROVED').length;
      if (nextIndex < approvers.length) {
        await this.createTasksForTransition(
          tenantId,
          instance,
          { ...transition, approvers: [approvers[nextIndex] as (typeof approvers)[number]] },
          false,
          false,
        );
        return;
      }

      await this.fireTransition(tenantId, instance, definition, transition, actorUserId, meta);
      return;
    }

    // PARALLEL
    const approvedCount = tasks.filter((task) => task.status === 'APPROVED').length;
    const rejectedCount = tasks.filter((task) => task.status === 'REJECTED').length;
    const total = tasks.length;
    const rule = transition.parallelRule ?? 'ALL';

    const resolveApproved = async () => {
      await this.tenantPrisma.client.workflowApprovalTask.updateMany({
        where: { transitionId: transition.id, instanceId: instance.id, status: 'PENDING' },
        data: { status: 'SKIPPED' },
      });
      await this.fireTransition(tenantId, instance, definition, transition, actorUserId, meta);
    };
    const resolveRejected = async () => {
      await this.tenantPrisma.client.workflowApprovalTask.updateMany({
        where: { transitionId: transition.id, instanceId: instance.id, status: 'PENDING' },
        data: { status: 'SKIPPED' },
      });
      await this.resolveRejection(tenantId, instance, definition, actorUserId, meta);
    };

    if (rule === 'ALL') {
      if (rejectedCount > 0) {
        await resolveRejected();
      } else if (approvedCount === total) {
        await resolveApproved();
      }
      return;
    }

    if (rule === 'ANY') {
      if (approvedCount > 0) {
        await resolveApproved();
      } else if (rejectedCount > 0) {
        await resolveRejected();
      }
      return;
    }

    // QUORUM
    const quorum = transition.parallelQuorumCount ?? total;
    if (approvedCount >= quorum) {
      await resolveApproved();
    } else if (total - rejectedCount < quorum) {
      await resolveRejected();
    }
  }

  private async resolveRejection(
    tenantId: string,
    instance: WorkflowInstance,
    definition: DefinitionGraph,
    actorUserId: string,
    meta: WorkflowActionMeta,
  ): Promise<void> {
    const context = (instance.context ?? {}) as Record<string, unknown>;
    const rejectTransition = this.selectTransition(definition.transitions, instance.currentStateId, ['REJECT'], context);
    if (!rejectTransition) {
      this.logger.warn(
        `Workflow instance ${instance.id}: a task was rejected but no REJECT transition is configured from its ` +
          'current state — the instance stays where it is.',
      );
      return;
    }
    await this.fireTransition(tenantId, instance, definition, rejectTransition, actorUserId, meta);
  }

  private async completeInstance(
    tenantId: string,
    instance: WorkflowInstance,
    category: 'APPROVED' | 'REJECTED' | 'CANCELLED',
    meta: WorkflowActionMeta,
  ): Promise<void> {
    await this.tenantPrisma.client.workflowInstance.update({
      where: { id: instance.id },
      data: { status: category, completedAt: new Date() },
    });

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'SYSTEM',
      action: AUDIT_ACTIONS.WORKFLOW_COMPLETED,
      module: AUDIT_MODULES.WORKFLOWS,
      entityType: instance.entityType,
      entityId: instance.entityId,
      after: { instanceId: instance.id, outcome: category },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    if (instance.startedBy) {
      await this.notifyApprovers(
        tenantId,
        [{ userId: instance.startedBy, email: '' }],
        instance,
        `Your ${instance.entityType} request was ${category.toLowerCase()}`,
      );
    }
  }

  private async notifyApprovers(
    tenantId: string,
    recipients: Array<{ userId: string; email: string }>,
    instance: WorkflowInstance,
    subject: string,
    taskId?: string,
  ): Promise<void> {
    for (const recipient of recipients) {
      try {
        await this.notifications.sendSystem(tenantId, {
          recipientUserId: recipient.userId,
          channel: 'IN_APP',
          subject,
          body: taskId
            ? `A workflow task (${taskId}) is waiting on your decision for ${instance.entityType}/${instance.entityId}.`
            : `${instance.entityType}/${instance.entityId}: ${subject}.`,
        });
      } catch (error) {
        this.logger.warn(
          `Failed to notify user ${recipient.userId} about workflow instance ${instance.id}: ${
            error instanceof Error ? error.message : error
          }`,
        );
      }
    }
  }
}
