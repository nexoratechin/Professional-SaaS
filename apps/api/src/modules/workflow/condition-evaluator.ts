import { BadRequestException } from '@nestjs/common';

/**
 * A tiny, safe condition tree evaluated against a WorkflowInstance's `context` JSON — never a
 * stored code string, so a tenant admin configuring a workflow (WorkflowTransition
 * .conditionExpression) can never get arbitrary code execution out of it. Deliberately small:
 * comparisons plus and/or/not composition covers every "only escalate to the Principal above
 * ₹50,000" / "only auto-approve for returning students" case this engine needs without building
 * a general-purpose expression language.
 */
export type ConditionExpression =
  | { op: 'eq'; field: string; value: unknown }
  | { op: 'ne'; field: string; value: unknown }
  | { op: 'gt'; field: string; value: number }
  | { op: 'gte'; field: string; value: number }
  | { op: 'lt'; field: string; value: number }
  | { op: 'lte'; field: string; value: number }
  | { op: 'in'; field: string; value: unknown[] }
  | { op: 'and'; conditions: ConditionExpression[] }
  | { op: 'or'; conditions: ConditionExpression[] }
  | { op: 'not'; condition: ConditionExpression };

/** Dotted-path field lookup (e.g. "student.departmentId") against the instance context. */
function readField(context: Record<string, unknown>, field: string): unknown {
  return field
    .split('.')
    .reduce<unknown>(
      (value, key) => (value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined),
      context,
    );
}

/** Null/undefined means "always eligible" — most transitions have no condition at all. */
export function evaluateCondition(
  expression: ConditionExpression | null | undefined,
  context: Record<string, unknown>,
): boolean {
  if (expression === null || expression === undefined) {
    return true;
  }

  switch (expression.op) {
    case 'eq':
      return readField(context, expression.field) === expression.value;
    case 'ne':
      return readField(context, expression.field) !== expression.value;
    case 'gt':
      return Number(readField(context, expression.field)) > expression.value;
    case 'gte':
      return Number(readField(context, expression.field)) >= expression.value;
    case 'lt':
      return Number(readField(context, expression.field)) < expression.value;
    case 'lte':
      return Number(readField(context, expression.field)) <= expression.value;
    case 'in':
      return expression.value.includes(readField(context, expression.field));
    case 'and':
      return expression.conditions.every((condition) => evaluateCondition(condition, context));
    case 'or':
      return expression.conditions.some((condition) => evaluateCondition(condition, context));
    case 'not':
      return !evaluateCondition(expression.condition, context);
    default:
      return false;
  }
}

const COMPARISON_OPS = new Set(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in']);

/** Validated once at definition-creation time (not on every evaluation) — a tenant admin's
 * malformed condition tree is rejected as a 400 rather than silently misbehaving or throwing
 * deep inside an approval decision later. */
export function assertValidConditionExpression(value: unknown, path = 'conditionExpression'): void {
  if (value === null || value === undefined) {
    return;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException(`${path} must be an object.`);
  }
  const expression = value as Record<string, unknown>;
  const op = expression.op;

  if (typeof op !== 'string') {
    throw new BadRequestException(`${path}.op must be a string.`);
  }

  if (COMPARISON_OPS.has(op)) {
    if (typeof expression.field !== 'string' || expression.field.length === 0) {
      throw new BadRequestException(`${path}.field must be a non-empty string.`);
    }
    if (op === 'in' && !Array.isArray(expression.value)) {
      throw new BadRequestException(`${path}.value must be an array for op "in".`);
    }
    return;
  }

  if (op === 'and' || op === 'or') {
    if (!Array.isArray(expression.conditions) || expression.conditions.length === 0) {
      throw new BadRequestException(`${path}.conditions must be a non-empty array for op "${op}".`);
    }
    expression.conditions.forEach((condition, index) =>
      assertValidConditionExpression(condition, `${path}.conditions[${index}]`),
    );
    return;
  }

  if (op === 'not') {
    assertValidConditionExpression(expression.condition, `${path}.condition`);
    return;
  }

  throw new BadRequestException(`${path}.op "${op}" is not a recognized condition operator.`);
}
