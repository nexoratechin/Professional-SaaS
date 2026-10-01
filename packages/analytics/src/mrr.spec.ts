import {
  buildSaasSnapshotMetrics,
  computeMrrByTenant,
  computeMrrMovement,
  computeSubscriptionMrr,
  isRecurringStatus,
  normalizeToMonthly,
  ratePercent,
} from './mrr';
import type { SubscriptionRevenueInput } from './types';

function subscription(overrides: Partial<SubscriptionRevenueInput> = {}): SubscriptionRevenueInput {
  return {
    id: 'sub_1',
    tenantId: 'tenant_1',
    status: 'ACTIVE',
    billingCycle: 'MONTHLY',
    planPriceCents: 10_000,
    items: [],
    currentPeriodStart: new Date('2026-01-01T00:00:00.000Z'),
    currentPeriodEnd: new Date('2026-02-01T00:00:00.000Z'),
    canceledAt: null,
    ...overrides,
  };
}

describe('normalizeToMonthly', () => {
  it('passes MONTHLY through unchanged', () => {
    expect(normalizeToMonthly(10_000, 'MONTHLY')).toBe(10_000);
  });

  it('divides ANNUAL down by 12', () => {
    expect(normalizeToMonthly(120_000, 'ANNUAL')).toBe(10_000);
  });

  it('rounds an annual price that is not divisible by 12 to whole cents', () => {
    expect(normalizeToMonthly(10_001, 'ANNUAL')).toBe(833);
  });

  it('treats ONE_TIME and unknown cycles as non-recurring', () => {
    expect(normalizeToMonthly(50_000, 'ONE_TIME')).toBe(0);
    expect(normalizeToMonthly(50_000, 'WEEKLY')).toBe(0);
  });

  it('ignores zero, negative and non-finite amounts', () => {
    expect(normalizeToMonthly(0, 'MONTHLY')).toBe(0);
    expect(normalizeToMonthly(-5, 'MONTHLY')).toBe(0);
    expect(normalizeToMonthly(Number.NaN, 'MONTHLY')).toBe(0);
  });
});

describe('isRecurringStatus', () => {
  it('keeps PAST_DUE in the recurring set but drops SUSPENDED/CANCELED/EXPIRED', () => {
    expect(isRecurringStatus('ACTIVE')).toBe(true);
    expect(isRecurringStatus('TRIALING')).toBe(true);
    expect(isRecurringStatus('PAST_DUE')).toBe(true);
    expect(isRecurringStatus('SUSPENDED')).toBe(false);
    expect(isRecurringStatus('CANCELED')).toBe(false);
    expect(isRecurringStatus('EXPIRED')).toBe(false);
  });
});

describe('computeSubscriptionMrr', () => {
  it('uses the plan price for a bare subscription', () => {
    expect(computeSubscriptionMrr(subscription())).toBe(10_000);
  });

  it('adds metered items at quantity x normalized unit price', () => {
    const row = subscription({
      planPriceCents: 10_000,
      items: [{ itemType: 'PER_STUDENT', quantity: 300, unitPriceCents: 50 }],
    });
    expect(computeSubscriptionMrr(row)).toBe(25_000);
  });

  it('normalizes item prices by the subscription billing cycle too', () => {
    const row = subscription({
      billingCycle: 'ANNUAL',
      planPriceCents: 120_000,
      items: [{ itemType: 'ADDON_MODULE', quantity: 2, unitPriceCents: 12_000 }],
    });
    expect(computeSubscriptionMrr(row)).toBe(12_000);
  });

  it('contributes nothing for a non-recurring status', () => {
    expect(computeSubscriptionMrr(subscription({ status: 'CANCELED' }))).toBe(0);
  });

  it('treats a null plan price as zero rather than NaN', () => {
    expect(computeSubscriptionMrr(subscription({ planPriceCents: null }))).toBe(0);
  });
});

describe('computeMrrByTenant', () => {
  it('sums every subscription belonging to a tenant', () => {
    const byTenant = computeMrrByTenant([
      subscription({ id: 'a', tenantId: 't1' }),
      subscription({ id: 'b', tenantId: 't1', planPriceCents: 5_000 }),
      subscription({ id: 'c', tenantId: 't2', planPriceCents: 7_000 }),
    ]);
    expect(byTenant.get('t1')).toBe(15_000);
    expect(byTenant.get('t2')).toBe(7_000);
  });
});

describe('computeMrrMovement', () => {
  const map = (entries: Array<[string, number]> = []) => new Map<string, number>(entries);

  it('separates new, expansion, contraction and churn', () => {
    const movement = computeMrrMovement(
      map([
        ['kept', 10_000],
        ['expanded', 5_000],
        ['contracted', 8_000],
        ['churned', 4_000],
      ]),
      map([
        ['kept', 10_000],
        ['expanded', 9_000],
        ['contracted', 6_000],
        ['new', 3_000],
      ]),
    );

    expect(movement).toEqual({
      newMrrCents: 3_000,
      expansionMrrCents: 4_000,
      contractionMrrCents: 2_000,
      churnedMrrCents: 4_000,
      netNewMrrCents: 1_000,
      newTenantCount: 1,
      churnedTenantCount: 1,
    });
  });

  it('reports zero movement when nothing changed', () => {
    const movement = computeMrrMovement(map([['a', 10]]), map([['a', 10]]));
    expect(movement.netNewMrrCents).toBe(0);
    expect(movement.newTenantCount).toBe(0);
    expect(movement.churnedTenantCount).toBe(0);
  });

  it('treats a tenant dropping to zero MRR as churn, not contraction', () => {
    const movement = computeMrrMovement(map([['a', 10]]), map());
    expect(movement.churnedMrrCents).toBe(10);
    expect(movement.contractionMrrCents).toBe(0);
  });
});

describe('ratePercent', () => {
  it('returns 0 for an empty or negative denominator instead of Infinity', () => {
    expect(ratePercent(5, 0)).toBe(0);
    expect(ratePercent(5, -1)).toBe(0);
  });

  it('rounds to two decimals', () => {
    expect(ratePercent(1, 3)).toBe(33.33);
  });
});

describe('buildSaasSnapshotMetrics', () => {
  it('derives ARR as MRR x 12 and churn against the opening base', () => {
    const metrics = buildSaasSnapshotMetrics({
      subscriptionsByStatus: { ACTIVE: 2, CANCELED: 1 },
      recurringSubscriptionCount: 2,
      tenantCountByStatus: { ACTIVE: 2, CANCELED: 1 },
      previousMrrByTenant: new Map([
        ['a', 10_000],
        ['b', 10_000],
        ['c', 5_000],
      ]),
      currentMrrByTenant: new Map([
        ['a', 10_000],
        ['b', 10_000],
      ]),
      totalUserCount: 42,
      activeUserCount: 30,
      meteredStudentCount: 1_200,
      billedCents: 50_000,
      collectedCents: 40_000,
      outstandingCents: 10_000,
      usageByEventType: [{ eventType: 'STUDENT_ENROLLED', quantity: 12, eventCount: 12 }],
      tenantNames: new Map([
        ['a', { name: 'Alpha', slug: 'alpha' }],
        ['b', { name: 'Beta', slug: 'beta' }],
      ]),
    });

    expect(metrics.mrrCents).toBe(20_000);
    expect(metrics.arrCents).toBe(240_000);
    expect(metrics.churnedTenantCount).toBe(1);
    // 1 churned out of 3 tenants at the START of the window.
    expect(metrics.customerChurnPercent).toBe(33.33);
    // 5000 churned out of 25000 opening MRR.
    expect(metrics.mrrChurnPercent).toBe(20);
    expect(metrics.meteredStudentCount).toBe(1_200);
    expect(metrics.topTenantsByMrr.map((row) => row.tenantSlug)).toEqual(['alpha', 'beta']);
  });

  it('falls back to the tenant id when no name is known', () => {
    const metrics = buildSaasSnapshotMetrics({
      subscriptionsByStatus: {},
      recurringSubscriptionCount: 1,
      tenantCountByStatus: {},
      previousMrrByTenant: new Map(),
      currentMrrByTenant: new Map([['unknown-tenant', 1_000]]),
      totalUserCount: 0,
      activeUserCount: 0,
      meteredStudentCount: 0,
      billedCents: 0,
      collectedCents: 0,
      outstandingCents: 0,
      usageByEventType: [],
      tenantNames: new Map(),
    });
    expect(metrics.topTenantsByMrr[0]).toEqual({
      tenantId: 'unknown-tenant',
      tenantName: 'unknown-tenant',
      tenantSlug: 'unknown-tenant',
      mrrCents: 1_000,
    });
    expect(metrics.customerChurnPercent).toBe(0);
  });
});
