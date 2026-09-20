import { SYSTEM_ROLE_CODES } from './permission-keys';

/**
 * Example tenant-configurable workflow definitions, seeded per tenant by TenantProvisioningService
 * — the same pattern already used for DEFAULT_ROLE_DEFINITIONS. These are DATA, not code: a
 * tenant admin can deactivate, replace, or reconfigure either one via the workflow-definitions
 * API without touching the engine itself. The two examples deliberately exercise different
 * engine features (sequential + conditional branching vs. parallel + ANY-rule) so a fresh tenant
 * has working proof the engine end-to-end without any business module having to build one first.
 *
 * Deliberately framework-agnostic (no NestJS/class-validator types) — apps/api's
 * CreateWorkflowDefinitionDto has the identical shape; TenantProvisioningService passes these
 * straight through to WorkflowDefinitionsService.createDefinition().
 */

export type WorkflowStateCategoryDefault = 'INITIAL' | 'IN_PROGRESS' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export type WorkflowTransitionActionDefault = 'SUBMIT' | 'APPROVE' | 'REJECT' | 'RESUBMIT' | 'ESCALATE' | 'CANCEL';
export type WorkflowApprovalModeDefault = 'NONE' | 'SEQUENTIAL' | 'PARALLEL';
export type WorkflowParallelRuleDefault = 'ALL' | 'ANY' | 'QUORUM';

export interface WorkflowStateDefault {
  code: string;
  name: string;
  category?: WorkflowStateCategoryDefault;
  allowsResubmission?: boolean;
  sequenceOrder?: number;
}

export interface WorkflowTransitionApproverDefault {
  approverType: 'ROLE' | 'SPECIFIC_USER';
  roleCode?: string;
  scopeField?: string;
  sequenceOrder?: number;
}

export interface WorkflowTransitionDefault {
  code: string;
  name: string;
  fromStateCode: string;
  toStateCode: string;
  action: WorkflowTransitionActionDefault;
  priority?: number;
  conditionExpression?: Record<string, unknown>;
  approvalMode?: WorkflowApprovalModeDefault;
  parallelRule?: WorkflowParallelRuleDefault;
  parallelQuorumCount?: number;
  deadlineHours?: number;
  escalationRoleCode?: string;
  escalationAfterHours?: number;
  approvers?: WorkflowTransitionApproverDefault[];
}

export interface WorkflowDefinitionDefault {
  code: string;
  name: string;
  description: string;
  entityType: string;
  states: WorkflowStateDefault[];
  transitions: WorkflowTransitionDefault[];
}

const R = SYSTEM_ROLE_CODES;

export const DEFAULT_WORKFLOW_DEFINITIONS: WorkflowDefinitionDefault[] = [
  {
    code: 'FEE_REFUND_APPROVAL_V1',
    name: 'Fee Refund Approval',
    description:
      'HOD then Accountant sign-off for fee refunds over ₹5,000; smaller refunds skip straight to ' +
      'Accountant-only approval. HOD step escalates to the Principal after 48 hours.',
    entityType: 'FeeRefund',
    states: [
      { code: 'DRAFT', name: 'Draft', category: 'INITIAL', sequenceOrder: 0 },
      { code: 'PENDING_HOD', name: 'Pending HOD Approval', sequenceOrder: 1 },
      { code: 'PENDING_ACCOUNTANT', name: 'Pending Accountant Approval', sequenceOrder: 2 },
      { code: 'NEEDS_RESUBMISSION', name: 'Needs Resubmission', category: 'REJECTED', allowsResubmission: true, sequenceOrder: 3 },
      { code: 'APPROVED', name: 'Refund Approved', category: 'APPROVED', sequenceOrder: 4 },
      { code: 'CANCELLED', name: 'Cancelled', category: 'CANCELLED', sequenceOrder: 5 },
    ],
    transitions: [
      { code: 'SUBMIT', name: 'Submit refund request', fromStateCode: 'DRAFT', toStateCode: 'PENDING_HOD', action: 'SUBMIT' },
      {
        code: 'HOD_AUTO_APPROVE_SMALL',
        name: 'HOD sign-off (auto-final, ≤ ₹5,000)',
        fromStateCode: 'PENDING_HOD',
        toStateCode: 'APPROVED',
        action: 'APPROVE',
        priority: 10,
        conditionExpression: { op: 'lte', field: 'amount', value: 5000 },
        approvalMode: 'SEQUENTIAL',
        deadlineHours: 48,
        escalationRoleCode: R.PRINCIPAL,
        escalationAfterHours: 48,
        approvers: [{ approverType: 'ROLE', roleCode: R.HOD, scopeField: 'departmentId', sequenceOrder: 0 }],
      },
      {
        code: 'HOD_APPROVE_LARGE',
        name: 'HOD sign-off (forwards to Accountant, > ₹5,000)',
        fromStateCode: 'PENDING_HOD',
        toStateCode: 'PENDING_ACCOUNTANT',
        action: 'APPROVE',
        priority: 0,
        approvalMode: 'SEQUENTIAL',
        deadlineHours: 48,
        escalationRoleCode: R.PRINCIPAL,
        escalationAfterHours: 48,
        approvers: [{ approverType: 'ROLE', roleCode: R.HOD, scopeField: 'departmentId', sequenceOrder: 0 }],
      },
      {
        code: 'HOD_REJECT',
        name: 'HOD rejects',
        fromStateCode: 'PENDING_HOD',
        toStateCode: 'NEEDS_RESUBMISSION',
        action: 'REJECT',
      },
      {
        code: 'ACCOUNTANT_APPROVE',
        name: 'Accountant sign-off',
        fromStateCode: 'PENDING_ACCOUNTANT',
        toStateCode: 'APPROVED',
        action: 'APPROVE',
        approvalMode: 'SEQUENTIAL',
        deadlineHours: 72,
        approvers: [{ approverType: 'ROLE', roleCode: R.ACCOUNTANT, sequenceOrder: 0 }],
      },
      {
        code: 'ACCOUNTANT_REJECT',
        name: 'Accountant rejects',
        fromStateCode: 'PENDING_ACCOUNTANT',
        toStateCode: 'NEEDS_RESUBMISSION',
        action: 'REJECT',
      },
      {
        code: 'RESUBMIT',
        name: 'Resubmit corrected request',
        fromStateCode: 'NEEDS_RESUBMISSION',
        toStateCode: 'PENDING_HOD',
        action: 'RESUBMIT',
      },
      { code: 'CANCEL_FROM_DRAFT', name: 'Withdraw', fromStateCode: 'DRAFT', toStateCode: 'CANCELLED', action: 'CANCEL' },
      {
        code: 'CANCEL_FROM_HOD',
        name: 'Withdraw',
        fromStateCode: 'PENDING_HOD',
        toStateCode: 'CANCELLED',
        action: 'CANCEL',
      },
      {
        code: 'CANCEL_FROM_ACCOUNTANT',
        name: 'Withdraw',
        fromStateCode: 'PENDING_ACCOUNTANT',
        toStateCode: 'CANCELLED',
        action: 'CANCEL',
      },
    ],
  },
  {
    code: 'LEAVE_REQUEST_APPROVAL_V1',
    name: 'Leave Request Approval',
    description:
      'A leave request is approved as soon as EITHER HR or the Principal signs off (first ' +
      'responder wins), escalating to the Principal if nobody acts within 24 hours.',
    entityType: 'LeaveRequest',
    states: [
      { code: 'DRAFT', name: 'Draft', category: 'INITIAL', sequenceOrder: 0 },
      { code: 'PENDING_PANEL', name: 'Pending Approval', sequenceOrder: 1 },
      { code: 'REJECTED', name: 'Rejected', category: 'REJECTED', allowsResubmission: true, sequenceOrder: 2 },
      { code: 'APPROVED', name: 'Approved', category: 'APPROVED', sequenceOrder: 3 },
      { code: 'CANCELLED', name: 'Cancelled', category: 'CANCELLED', sequenceOrder: 4 },
    ],
    transitions: [
      { code: 'SUBMIT', name: 'Submit leave request', fromStateCode: 'DRAFT', toStateCode: 'PENDING_PANEL', action: 'SUBMIT' },
      {
        code: 'PANEL_APPROVE',
        name: 'Panel sign-off (any one of HR or Principal)',
        fromStateCode: 'PENDING_PANEL',
        toStateCode: 'APPROVED',
        action: 'APPROVE',
        approvalMode: 'PARALLEL',
        parallelRule: 'ANY',
        deadlineHours: 24,
        escalationRoleCode: R.PRINCIPAL,
        escalationAfterHours: 24,
        approvers: [
          { approverType: 'ROLE', roleCode: R.HR, sequenceOrder: 0 },
          { approverType: 'ROLE', roleCode: R.PRINCIPAL, sequenceOrder: 1 },
        ],
      },
      { code: 'PANEL_REJECT', name: 'Panel rejects', fromStateCode: 'PENDING_PANEL', toStateCode: 'REJECTED', action: 'REJECT' },
      { code: 'RESUBMIT', name: 'Resubmit corrected request', fromStateCode: 'REJECTED', toStateCode: 'PENDING_PANEL', action: 'RESUBMIT' },
      { code: 'CANCEL_FROM_DRAFT', name: 'Withdraw', fromStateCode: 'DRAFT', toStateCode: 'CANCELLED', action: 'CANCEL' },
      {
        code: 'CANCEL_FROM_PANEL',
        name: 'Withdraw',
        fromStateCode: 'PENDING_PANEL',
        toStateCode: 'CANCELLED',
        action: 'CANCEL',
      },
    ],
  },
];
