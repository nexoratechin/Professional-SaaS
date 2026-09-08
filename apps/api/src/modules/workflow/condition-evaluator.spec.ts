import { assertValidConditionExpression, evaluateCondition } from './condition-evaluator';

describe('evaluateCondition', () => {
  it('is always eligible when there is no condition', () => {
    expect(evaluateCondition(null, {})).toBe(true);
    expect(evaluateCondition(undefined, {})).toBe(true);
  });

  it('evaluates comparison operators against the context', () => {
    const context = { amount: 75000, category: 'REFUND', tags: ['urgent'] };
    expect(evaluateCondition({ op: 'gt', field: 'amount', value: 50000 }, context)).toBe(true);
    expect(evaluateCondition({ op: 'lte', field: 'amount', value: 50000 }, context)).toBe(false);
    expect(evaluateCondition({ op: 'eq', field: 'category', value: 'REFUND' }, context)).toBe(true);
    expect(evaluateCondition({ op: 'ne', field: 'category', value: 'REFUND' }, context)).toBe(false);
    expect(evaluateCondition({ op: 'in', field: 'category', value: ['REFUND', 'WAIVER'] }, context)).toBe(true);
  });

  it('reads dotted-path fields out of nested context', () => {
    const context = { student: { departmentId: 'dept-1' } };
    expect(evaluateCondition({ op: 'eq', field: 'student.departmentId', value: 'dept-1' }, context)).toBe(true);
  });

  it('composes with and/or/not', () => {
    const context = { amount: 75000, isReturningStudent: false };
    const highValueOrNewStudent: import('./condition-evaluator').ConditionExpression = {
      op: 'or',
      conditions: [
        { op: 'gt', field: 'amount', value: 50000 },
        { op: 'eq', field: 'isReturningStudent', value: false },
      ],
    };
    expect(evaluateCondition(highValueOrNewStudent, context)).toBe(true);
    expect(evaluateCondition({ op: 'not', condition: { op: 'gt', field: 'amount', value: 50000 } }, context)).toBe(
      false,
    );
    expect(
      evaluateCondition(
        { op: 'and', conditions: [{ op: 'gt', field: 'amount', value: 50000 }, { op: 'eq', field: 'missing', value: 1 }] },
        context,
      ),
    ).toBe(false);
  });

  it('treats a missing field as undefined rather than throwing', () => {
    expect(evaluateCondition({ op: 'eq', field: 'does.not.exist', value: undefined }, {})).toBe(true);
    expect(evaluateCondition({ op: 'eq', field: 'does.not.exist', value: null }, {})).toBe(false);
  });
});

describe('assertValidConditionExpression', () => {
  it('accepts null/undefined', () => {
    expect(() => assertValidConditionExpression(null)).not.toThrow();
    expect(() => assertValidConditionExpression(undefined)).not.toThrow();
  });

  it('accepts a well-formed comparison', () => {
    expect(() => assertValidConditionExpression({ op: 'gt', field: 'amount', value: 100 })).not.toThrow();
  });

  it('accepts well-formed and/or/not composition', () => {
    expect(() =>
      assertValidConditionExpression({
        op: 'and',
        conditions: [
          { op: 'gt', field: 'amount', value: 100 },
          { op: 'not', condition: { op: 'eq', field: 'category', value: 'X' } },
        ],
      }),
    ).not.toThrow();
  });

  it('rejects a non-object', () => {
    expect(() => assertValidConditionExpression('not-an-object')).toThrow();
    expect(() => assertValidConditionExpression(42)).toThrow();
  });

  it('rejects an unrecognized operator', () => {
    expect(() => assertValidConditionExpression({ op: 'eval', code: 'process.exit()' })).toThrow();
  });

  it('rejects a comparison missing its field', () => {
    expect(() => assertValidConditionExpression({ op: 'eq', value: 1 })).toThrow();
  });

  it('rejects "in" with a non-array value', () => {
    expect(() => assertValidConditionExpression({ op: 'in', field: 'x', value: 'not-an-array' })).toThrow();
  });

  it('rejects and/or with an empty or missing conditions array', () => {
    expect(() => assertValidConditionExpression({ op: 'and', conditions: [] })).toThrow();
    expect(() => assertValidConditionExpression({ op: 'or' })).toThrow();
  });

  it('recurses into nested conditions to reject a deeply invalid one', () => {
    expect(() =>
      assertValidConditionExpression({
        op: 'and',
        conditions: [{ op: 'gt', field: 'amount', value: 100 }, { op: 'bogus' }],
      }),
    ).toThrow();
  });
});
