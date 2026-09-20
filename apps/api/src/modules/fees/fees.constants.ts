/**
 * Fees & Finance (Phase 14) module constants — free-form audit-action values (the tenant audit
 * trail's `action` column is an open string; AUDIT_MODULES.FEES is the module discriminator) and
 * default numbering prefixes. Prefixes can be overridden per tenant through the configuration
 * engine where it exposes them (numbering.feeReceiptPrefix); the fallbacks below keep the module
 * usable even when a tenant has never touched that section.
 */

export const FEE_EVENTS = {
  HEAD_CREATED: 'fees.head.created',
  HEAD_UPDATED: 'fees.head.updated',
  HEAD_ARCHIVED: 'fees.head.archived',
  STRUCTURE_CREATED: 'fees.structure.created',
  STRUCTURE_UPDATED: 'fees.structure.updated',
  STRUCTURE_ACTIVATED: 'fees.structure.activated',
  STRUCTURE_ARCHIVED: 'fees.structure.archived',
  ASSIGNMENT_CREATED: 'fees.assignment.created',
  ASSIGNMENT_REVOKED: 'fees.assignment.revoked',
  DEMAND_ISSUED: 'fees.demand.issued',
  DEMAND_LATE_FEE_ACCRUED: 'fees.demand.late_fee_accrued',
  PAYMENT_RECORDED: 'fees.payment.recorded',
  CONCESSION_REQUESTED: 'fees.concession.requested',
  CONCESSION_DECIDED: 'fees.concession.decided',
  REFUND_REQUESTED: 'fees.refund.requested',
  REFUND_DECIDED: 'fees.refund.decided',
  REFUND_PROCESSED: 'fees.refund.processed',
} as const;

export const DEMAND_PREFIX_DEFAULT = 'DEM';
export const RECEIPT_PREFIX_DEFAULT = 'RCT';
export const REFUND_PREFIX_DEFAULT = 'RFN';

/** Reference labels for the concession targets, kept in sync with the schema's nullable trio. */
export const CONCESSION_TARGET_LABELS = {
  fee: 'fee',
  demand: 'demand',
} as const;