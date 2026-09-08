import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

const STATE_CATEGORIES = ['INITIAL', 'IN_PROGRESS', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
const TRANSITION_ACTIONS = ['SUBMIT', 'APPROVE', 'REJECT', 'RESUBMIT', 'ESCALATE', 'CANCEL'] as const;
const APPROVAL_MODES = ['NONE', 'SEQUENTIAL', 'PARALLEL'] as const;
const PARALLEL_RULES = ['ALL', 'ANY', 'QUORUM'] as const;
const APPROVER_TYPES = ['ROLE', 'SPECIFIC_USER'] as const;

export class CreateWorkflowStateDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsIn(STATE_CATEGORIES)
  category?: string;

  @IsOptional()
  @IsBoolean()
  allowsResubmission?: boolean;

  @IsOptional()
  @IsInt()
  sequenceOrder?: number;
}

export class CreateWorkflowTransitionApproverDto {
  @IsIn(APPROVER_TYPES)
  approverType!: string;

  @IsOptional()
  @IsString()
  roleCode?: string;

  @IsOptional()
  @IsString()
  specificUserId?: string;

  /** One of KNOWN_SCOPE_FIELDS (see workflow-approver-resolution.service.ts) — validated in
   * WorkflowDefinitionsService, not here, so the DTO doesn't need to import a service. */
  @IsOptional()
  @IsString()
  scopeField?: string;

  @IsOptional()
  @IsInt()
  sequenceOrder?: number;
}

export class CreateWorkflowTransitionDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  /** References a state by CODE, not id — no ids exist yet when a whole definition is created
   * in one request. WorkflowDefinitionsService resolves codes to the rows it just created. */
  @IsString()
  fromStateCode!: string;

  @IsString()
  toStateCode!: string;

  @IsIn(TRANSITION_ACTIONS)
  action!: string;

  @IsOptional()
  @IsInt()
  priority?: number;

  /** A ConditionExpression tree — validated structurally by assertValidConditionExpression in
   * the service, not by class-validator (a recursive discriminated union doesn't map cleanly
   * onto decorators). */
  @IsOptional()
  @IsObject()
  conditionExpression?: Record<string, unknown>;

  @IsOptional()
  @IsIn(APPROVAL_MODES)
  approvalMode?: string;

  @IsOptional()
  @IsIn(PARALLEL_RULES)
  parallelRule?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  parallelQuorumCount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  deadlineHours?: number;

  @IsOptional()
  @IsString()
  escalationRoleCode?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  escalationAfterHours?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateWorkflowTransitionApproverDto)
  approvers?: CreateWorkflowTransitionApproverDto[];
}

export class CreateWorkflowDefinitionDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  /** Free-form — the future business module's own name for what it's attaching (e.g.
   * "FeeRefund", "LeaveRequest"). Never validated against a fixed enum here; see the schema's
   * WorkflowDefinition.entityType doc comment for why. */
  @IsString()
  entityType!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateWorkflowStateDto)
  states!: CreateWorkflowStateDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateWorkflowTransitionDto)
  transitions!: CreateWorkflowTransitionDto[];
}
