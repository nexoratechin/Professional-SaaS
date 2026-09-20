import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AUDIT_ACTIONS, AUDIT_MODULES } from '@college-erp/auth';
import type {
  Prisma,
  WorkflowApprovalMode,
  WorkflowApproverType,
  WorkflowParallelRule,
  WorkflowStateCategory,
  WorkflowTransitionAction,
} from '@college-erp/database';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { AuditService } from '../audit/audit.service';
import { assertValidConditionExpression } from './condition-evaluator';
import { KNOWN_SCOPE_FIELDS } from './workflow-approver-resolution.service';
import type { CreateWorkflowDefinitionDto } from './dto/create-workflow-definition.dto';

/**
 * Owns the CONFIGURATION side of the engine — definitions, their states, transitions, and
 * approver slots. A definition's graph is created whole (states + transitions + approvers in one
 * request) and is then immutable: changing an approval chain means creating a new definition
 * version and activating it, which atomically deactivates whichever definition was previously
 * active for that entityType. This mirrors how real BPM engines treat published process
 * definitions, and sidesteps the much harder problem of safely mutating a graph that
 * in-flight WorkflowInstances may already be relying on.
 */
@Injectable()
export class WorkflowDefinitionsService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditService: AuditService,
  ) {}

  async createDefinition(tenantId: string, dto: CreateWorkflowDefinitionDto, actorUserId: string) {
    await this.validate(dto);

    const definition = await this.tenantPrisma.client.$transaction(async (tx) => {
      // At most one ACTIVE definition per (tenantId, entityType) — app-enforced (see schema
      // comment; Prisma has no partial unique index support).
      await tx.workflowDefinition.updateMany({
        where: { tenantId, entityType: dto.entityType, isActive: true },
        data: { isActive: false, updatedBy: actorUserId },
      });

      const created = await tx.workflowDefinition.create({
        data: {
          tenantId,
          code: dto.code,
          name: dto.name,
          description: dto.description,
          entityType: dto.entityType,
          isActive: true,
          createdBy: actorUserId,
        },
      });

      const stateIdByCode = new Map<string, string>();
      for (const state of dto.states) {
        const row = await tx.workflowState.create({
          data: {
            tenantId,
            definitionId: created.id,
            code: state.code,
            name: state.name,
            category: (state.category ?? 'IN_PROGRESS') as WorkflowStateCategory,
            allowsResubmission: state.allowsResubmission ?? false,
            sequenceOrder: state.sequenceOrder ?? 0,
          },
        });
        stateIdByCode.set(state.code, row.id);
      }

      for (const transition of dto.transitions) {
        const transitionRow = await tx.workflowTransition.create({
          data: {
            tenantId,
            definitionId: created.id,
            code: transition.code,
            name: transition.name,
            fromStateId: stateIdByCode.get(transition.fromStateCode) as string,
            toStateId: stateIdByCode.get(transition.toStateCode) as string,
            action: transition.action as WorkflowTransitionAction,
            priority: transition.priority ?? 0,
            conditionExpression: (transition.conditionExpression ?? undefined) as Prisma.InputJsonValue,
            approvalMode: (transition.approvalMode ?? 'NONE') as WorkflowApprovalMode,
            parallelRule: transition.parallelRule as WorkflowParallelRule | undefined,
            parallelQuorumCount: transition.parallelQuorumCount,
            deadlineHours: transition.deadlineHours,
            escalationRoleCode: transition.escalationRoleCode,
            escalationAfterHours: transition.escalationAfterHours,
          },
        });

        if (transition.approvers?.length) {
          await tx.workflowTransitionApprover.createMany({
            data: transition.approvers.map((approver) => ({
              tenantId,
              transitionId: transitionRow.id,
              approverType: approver.approverType as WorkflowApproverType,
              roleCode: approver.roleCode,
              specificUserId: approver.specificUserId,
              scopeField: approver.scopeField,
              sequenceOrder: approver.sequenceOrder ?? 0,
            })),
          });
        }
      }

      return created;
    });

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.WORKFLOW_DEFINITION_CREATED,
      module: AUDIT_MODULES.WORKFLOWS,
      entityType: 'WorkflowDefinition',
      entityId: definition.id,
      after: { code: definition.code, entityType: definition.entityType },
    });

    return this.getDefinition(definition.id);
  }

  async listDefinitions(entityType?: string) {
    return this.tenantPrisma.client.workflowDefinition.findMany({
      where: { deletedAt: null, entityType },
      orderBy: [{ entityType: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async getDefinition(id: string) {
    const definition = await this.tenantPrisma.client.workflowDefinition.findFirst({
      where: { id, deletedAt: null },
      include: {
        states: { orderBy: { sequenceOrder: 'asc' } },
        transitions: { include: { approvers: true }, orderBy: { priority: 'desc' } },
      },
    });
    if (!definition) {
      throw new NotFoundException('Workflow definition not found.');
    }
    return definition;
  }

  /** What WorkflowEngineService.startInstance() actually uses — there is deliberately no
   * fallback to "any definition for this entityType" if none is active: a tenant that hasn't
   * configured a workflow for a given entityType simply cannot start one, rather than silently
   * picking an arbitrary/stale definition. */
  async getActiveDefinitionForEntityType(tenantId: string, entityType: string) {
    return this.tenantPrisma.client.workflowDefinition.findFirst({
      where: { tenantId, entityType, isActive: true, deletedAt: null },
      include: { states: true, transitions: { include: { approvers: true } } },
    });
  }

  async setActive(tenantId: string, id: string, isActive: boolean, actorUserId: string) {
    const definition = await this.tenantPrisma.client.workflowDefinition.findFirst({ where: { id } });
    if (!definition) {
      throw new NotFoundException('Workflow definition not found.');
    }

    if (isActive) {
      await this.tenantPrisma.client.$transaction([
        this.tenantPrisma.client.workflowDefinition.updateMany({
          where: { tenantId, entityType: definition.entityType, isActive: true },
          data: { isActive: false, updatedBy: actorUserId },
        }),
        this.tenantPrisma.client.workflowDefinition.update({
          where: { id },
          data: { isActive: true, updatedBy: actorUserId },
        }),
      ]);
    } else {
      await this.tenantPrisma.client.workflowDefinition.update({
        where: { id },
        data: { isActive: false, updatedBy: actorUserId },
      });
    }

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: isActive ? AUDIT_ACTIONS.WORKFLOW_DEFINITION_ACTIVATED : AUDIT_ACTIONS.WORKFLOW_DEFINITION_DEACTIVATED,
      module: AUDIT_MODULES.WORKFLOWS,
      entityType: 'WorkflowDefinition',
      entityId: id,
    });

    return this.getDefinition(id);
  }

  private async validate(dto: CreateWorkflowDefinitionDto): Promise<void> {
    if (dto.states.length === 0) {
      throw new BadRequestException('A workflow definition needs at least one state.');
    }
    const stateCodes = new Set(dto.states.map((state) => state.code));
    if (stateCodes.size !== dto.states.length) {
      throw new BadRequestException('State codes must be unique within a definition.');
    }
    const initialStates = dto.states.filter((state) => (state.category ?? 'IN_PROGRESS') === 'INITIAL');
    if (initialStates.length !== 1) {
      throw new BadRequestException('A workflow definition must have exactly one state with category INITIAL.');
    }

    if (dto.transitions.length === 0) {
      throw new BadRequestException('A workflow definition needs at least one transition.');
    }
    const transitionCodes = new Set(dto.transitions.map((transition) => transition.code));
    if (transitionCodes.size !== dto.transitions.length) {
      throw new BadRequestException('Transition codes must be unique within a definition.');
    }

    for (const transition of dto.transitions) {
      if (!stateCodes.has(transition.fromStateCode)) {
        throw new BadRequestException(`Transition "${transition.code}": unknown fromStateCode "${transition.fromStateCode}".`);
      }
      if (!stateCodes.has(transition.toStateCode)) {
        throw new BadRequestException(`Transition "${transition.code}": unknown toStateCode "${transition.toStateCode}".`);
      }
      assertValidConditionExpression(
        transition.conditionExpression ?? null,
        `transitions[${transition.code}].conditionExpression`,
      );

      const approvalMode = transition.approvalMode ?? 'NONE';
      const approvers = transition.approvers ?? [];
      if (approvalMode !== 'NONE' && approvers.length === 0) {
        throw new BadRequestException(`Transition "${transition.code}" uses ${approvalMode} approval but defines no approvers.`);
      }
      if (approvalMode === 'PARALLEL' && transition.parallelRule === 'QUORUM') {
        if (!transition.parallelQuorumCount || transition.parallelQuorumCount > approvers.length) {
          throw new BadRequestException(
            `Transition "${transition.code}": parallelQuorumCount must be set and no greater than the number of approvers.`,
          );
        }
      }

      for (const approver of approvers) {
        if (approver.approverType === 'ROLE') {
          if (!approver.roleCode) {
            throw new BadRequestException(`Transition "${transition.code}": a ROLE approver requires roleCode.`);
          }
          const role = await this.tenantPrisma.client.role.findFirst({
            where: { code: approver.roleCode, deletedAt: null },
          });
          if (!role) {
            throw new BadRequestException(
              `Transition "${transition.code}": unknown role code "${approver.roleCode}".`,
            );
          }
        } else if (approver.approverType === 'SPECIFIC_USER') {
          if (!approver.specificUserId) {
            throw new BadRequestException(`Transition "${transition.code}": a SPECIFIC_USER approver requires specificUserId.`);
          }
          const user = await this.tenantPrisma.client.user.findFirst({ where: { id: approver.specificUserId } });
          if (!user) {
            throw new BadRequestException(`Transition "${transition.code}": unknown specificUserId.`);
          }
        }
        if (approver.scopeField && !KNOWN_SCOPE_FIELDS.includes(approver.scopeField)) {
          throw new BadRequestException(
            `Transition "${transition.code}": unknown scopeField "${approver.scopeField}" — must be one of ${KNOWN_SCOPE_FIELDS.join(', ')}.`,
          );
        }
      }

      // Any transition requiring a human decision must have somewhere for a rejection to go —
      // otherwise WorkflowEngineService.resolveRejection() would find nothing to fire and the
      // instance would silently get stuck. NONE-mode transitions (SUBMIT, auto-advance) need no
      // such counterpart since there's no decision to reject.
      if (approvalMode !== 'NONE') {
        const hasRejectCounterpart = dto.transitions.some(
          (candidate) => candidate.fromStateCode === transition.fromStateCode && candidate.action === 'REJECT',
        );
        if (!hasRejectCounterpart) {
          throw new BadRequestException(
            `Transition "${transition.code}" requires approval but state "${transition.fromStateCode}" has no REJECT transition configured.`,
          );
        }
      }
    }
  }
}
