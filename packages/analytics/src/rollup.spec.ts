import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ADMISSION_FUNNEL_ORDER, ADMISSION_TERMINAL_STATUSES, type AnalyticsScopeFilter } from './college';
import { resolvePeriods } from './periods';
import {
  computeCollegeRollup,
  computeSaasRollup,
  groupCountsBy,
  groupSumsBy,
  liveSubscriptionWhere,
  studentWhere,
  toFiniteNumber,
  upsertAnalyticsSnapshot,
  type CollegeRollupScope,
} from './rollup';
import type { AnalyticsPeriod, AnalyticsPrisma } from './types';

// ---------------------------------------------------------------------------
// Fake Prisma
// ---------------------------------------------------------------------------

type Args = Record<string, unknown>;
type Responder = unknown | ((args: Args) => unknown);
type Method = 'findMany' | 'count' | 'aggregate' | 'groupBy' | 'upsert';

interface Call {
  delegate: string;
  method: Method;
  args: Args;
}

interface FakePrisma extends AnalyticsPrisma {
  calls: Call[];
  argsFor(delegate: string, method: Method, occurrence?: number): Args | undefined;
}

const DELEGATES = [
  'tenant',
  'user',
  'subscription',
  'subscriptionItem',
  'invoice',
  'payment',
  'usageEvent',
  'student',
  'studentAttendance',
  'studentFee',
  'studentPayment',
  'studentResult',
  'admissionApplication',
  'employee',
  'facultyWorkload',
  'placementOutcome',
  'studentHostelBooking',
  'studentLibraryLoan',
  'studentTransportPass',
] as const;

/**
 * Hand-rolled stand-in for the generated client. Returns canned rows per delegate/method and
 * records every call, so the tests can assert on the *shape of the query* (which relation filter it
 * used, whether it stays inside the index, how many round trips it costs) and not only on the
 * arithmetic that comes back.
 *
 * An unstubbed method returns the empty-set answer, which is exactly what Prisma returns for a
 * table with no matching rows - so an unstubbed metric reads as 0 rather than exploding, and a
 * forgotten query is visible as a missing call in the budget assertions rather than as a crash.
 */
function makeFake(overrides: Record<string, Partial<Record<Method, Responder>>> = {}): FakePrisma {
  const calls: Call[] = [];
  const prisma: Record<string, unknown> = {};

  const answer = (name: string, method: Method, args: Args, fallback: unknown): unknown => {
    const stub = overrides[name]?.[method];
    if (stub === undefined) return fallback;
    return typeof stub === 'function' ? (stub as (a: Args) => unknown)(args) : stub;
  };

  for (const name of DELEGATES) {
    prisma[name] = {
      findMany: async (args: Args) => {
        calls.push({ delegate: name, method: 'findMany', args });
        return answer(name, 'findMany', args, []);
      },
      count: async (args: Args) => {
        calls.push({ delegate: name, method: 'count', args });
        return answer(name, 'count', args, 0) as number;
      },
      aggregate: async (args: Args) => {
        calls.push({ delegate: name, method: 'aggregate', args });
        return answer(name, 'aggregate', args, {});
      },
      groupBy: async (args: Args) => {
        calls.push({ delegate: name, method: 'groupBy', args });
        return answer(name, 'groupBy', args, []);
      },
    };
  }

  prisma['analyticsSnapshot'] = {
    upsert: async (args: Args) => {
      calls.push({ delegate: 'analyticsSnapshot', method: 'upsert', args });
      return {};
    },
  };

  prisma['calls'] = calls;
  prisma['argsFor'] = (name: string, method: Method, occurrence = 0) =>
    calls.filter((call) => call.delegate === name && call.method === method)[occurrence]?.args;

  return prisma as unknown as FakePrisma;
}

/** `groupBy` row shape Prisma returns for `by: ['<key>'], _count: { _all: true }`. */
function counts(key: string, buckets: Record<string, number>) {
  return Object.entries(buckets).map(([bucket, count]) => ({ [key]: bucket, _count: { _all: count } }));
}

const DAY = 86_400_000;

function daily(key: string): AnalyticsPeriod {
  const from = new Date(`${key}T00:00:00.000Z`);
  return { granularity: 'DAILY', from, to: new Date(from.getTime() + DAY), key };
}

const PERIOD = daily('2026-03-01');
/**
 * The bucket whose end instant IS the cancellation instant. `canceledAt > asOf` is false from that
 * moment on, so this is the first bucket in which the tenant is gone - i.e. the one that reports
 * the churn. The bucket after it reports nothing, because by then the tenant is missing from the
 * comparison bucket as well.
 */
const CHURN_BUCKET = daily('2026-03-03');

// ---------------------------------------------------------------------------
// Numeric + histogram coercion
// ---------------------------------------------------------------------------

describe('toFiniteNumber', () => {
  it('reads a Prisma.Decimal through toNumber()', () => {
    expect(toFiniteNumber({ toNumber: () => 12.5 })).toBe(12.5);
  });

  it('accepts numeric strings from raw aggregates', () => {
    expect(toFiniteNumber('1250.75')).toBe(1250.75);
  });

  it('degrades null/NaN/unknown shapes to 0 rather than leaking NaN into a JSON response', () => {
    expect(toFiniteNumber(null)).toBe(0);
    expect(toFiniteNumber(undefined)).toBe(0);
    expect(toFiniteNumber(Number.NaN)).toBe(0);
    expect(toFiniteNumber({})).toBe(0);
  });
});

describe('groupCountsBy / groupSumsBy', () => {
  it('builds a histogram from groupBy rows', () => {
    expect(groupCountsBy(counts('status', { ACTIVE: 3, INACTIVE: 1 }), 'status')).toEqual({ ACTIVE: 3, INACTIVE: 1 });
  });

  it('treats a group row with no _count as an empty bucket rather than NaN', () => {
    expect(groupCountsBy([{ status: 'ACTIVE' }], 'status')).toEqual({ ACTIVE: 0 });
  });

  it('sums a Decimal _sum payload per bucket', () => {
    const rows = [
      { workloadType: 'TEACHING', _sum: { hoursPerWeek: { toNumber: () => 12 } } },
      { workloadType: 'TEACHING', _sum: { hoursPerWeek: { toNumber: () => 6 } } },
    ];
    expect(groupSumsBy(rows, 'workloadType', 'hoursPerWeek')).toEqual({ TEACHING: 18 });
  });
});

// ---------------------------------------------------------------------------
// SaaS rollup
// ---------------------------------------------------------------------------

const SUB_A = {
  id: 'sub-a',
  tenantId: 'tenant-a',
  status: 'ACTIVE',
  billingCycle: 'ANNUAL',
  currentPeriodStart: new Date('2026-01-01T00:00:00.000Z'),
  currentPeriodEnd: new Date('2026-12-31T00:00:00.000Z'),
  canceledAt: null,
  // 120000/12 = 10000 per month, plus 400 students * 12000/12 = 400000.
  plan: { priceCents: 120_000 },
  items: [{ itemType: 'PER_STUDENT', quantity: 400, unitPriceCents: 12_000 }],
};

const SUB_B = {
  id: 'sub-b',
  tenantId: 'tenant-b',
  status: 'CANCELED',
  billingCycle: 'MONTHLY',
  currentPeriodStart: new Date('2026-02-01T00:00:00.000Z'),
  currentPeriodEnd: new Date('2026-03-31T00:00:00.000Z'),
  // Canceled two days after PERIOD opens, so it was still a paying subscriber through PERIOD.
  canceledAt: new Date('2026-03-04T00:00:00.000Z'),
  plan: { priceCents: 50_000 },
  items: [],
};

const TENANTS = [
  { id: 'tenant-a', name: 'Alpha', slug: 'alpha', status: 'ACTIVE' },
  { id: 'tenant-b', name: 'Beta', slug: 'beta', status: 'CANCELED' },
];

describe('liveSubscriptionWhere', () => {
  const where = liveSubscriptionWhere(PERIOD.to) as Record<string, unknown>;
  const branches = where['OR'] as Record<string, unknown>[];

  it('counts PAST_DUE as still recurring (it occupies a slot and still owes money)', () => {
    expect((branches[0]?.['status'] as { in: string[] }).in).toEqual(['ACTIVE', 'TRIALING', 'PAST_DUE']);
  });

  it('never counts a SUSPENDED subscription as revenue', () => {
    expect(JSON.stringify(where)).not.toContain('SUSPENDED');
  });

  it('reconstructs history so churn is visible in the bucket it happened', () => {
    // Without these two branches every churned tenant would vanish from every historical bucket
    // and both churn rates would read as a flat zero - the failure mode this exists to prevent.
    expect(branches[1]).toEqual({ status: 'CANCELED', canceledAt: { gt: PERIOD.to } });
    expect(branches[2]).toEqual({ status: 'EXPIRED', currentPeriodEnd: { gt: PERIOD.to } });
  });

  it('anchors on the period start so a subscription that has not begun is excluded', () => {
    expect(where['currentPeriodStart']).toEqual({ lte: PERIOD.to });
  });
});

describe('computeSaasRollup', () => {
  it('normalizes an annual contract to a monthly figure instead of inflating MRR 12x', async () => {
    const prisma = makeFake({ subscription: { findMany: [SUB_A] } });
    const metrics = await computeSaasRollup(prisma, { period: PERIOD });
    expect(metrics.mrrCents).toBe(410_000);
    expect(metrics.arrCents).toBe(4_920_000);
  });

  it('keeps a tenant that had not yet been charged out of MRR entirely', async () => {
    const prisma = makeFake({ subscription: { findMany: [] } });
    const metrics = await computeSaasRollup(prisma, { period: PERIOD });
    expect(metrics.mrrCents).toBe(0);
    expect(metrics.recurringSubscriptionCount).toBe(0);
  });

  it('reconstructs a mid-window cancellation into churn instead of a flat zero', async () => {
    const prisma = makeFake({ subscription: { findMany: [SUB_A, SUB_B] }, tenant: { findMany: TENANTS } });

    // Before the cancellation both tenants are live: sub-b's canceledAt is in the future, so its
    // CURRENT CANCELED status is reconstructed back to the paying state it was in.
    const before = await computeSaasRollup(prisma, { period: PERIOD });
    expect(before.mrrCents).toBe(460_000);
    expect(before.churnedTenantCount).toBe(0);
    expect(before.mrrChurnPercent).toBe(0);

    // In the bucket the cancellation takes effect, tenant-b drops out of the revenue map and is
    // reported as churn - not as "contraction" and not as nothing at all.
    const after = await computeSaasRollup(prisma, { period: CHURN_BUCKET });
    expect(after.mrrCents).toBe(410_000);
    expect(after.churnedTenantCount).toBe(1);
    expect(after.churnedMrrCents).toBe(50_000);
    expect(after.mrrChurnPercent).toBe(10.87);
    expect(after.customerChurnPercent).toBe(50);
    expect(after.netNewMrrCents).toBe(-50_000);
    expect(after.topTenantsByMrr.map((row) => row.tenantSlug)).toEqual(['alpha']);
  });

  it('costs a fixed, small number of round trips so the read path cannot drift toward N+1', async () => {
    const prisma = makeFake();
    await computeSaasRollup(prisma, { period: PERIOD });
    // 8 independent aggregates + 2 subscription loads. A regression that adds a per-tenant or
    // per-row query would show up here first.
    expect(prisma.calls).toHaveLength(10);
  });

  it('separates tenants onboarded in the window from new paying logos', async () => {
    const prisma = makeFake({
      subscription: { findMany: [SUB_A] },
      tenant: { findMany: TENANTS, count: 1 },
    });
    const metrics = await computeSaasRollup(prisma, { period: PERIOD });
    expect(metrics.createdTenantCount).toBe(1);
    expect(metrics.totalTenantCount).toBe(2);
    // SUSPENDED/CANCELED are not live customers; only ACTIVE and TRIAL are.
    expect(metrics.activeTenantCount).toBe(1);
    expect(metrics.tenantCountByStatus).toEqual({ ACTIVE: 1, CANCELED: 1 });
  });

  it('excludes DRAFT/VOID invoices from billed revenue', async () => {
    const prisma = makeFake({ invoice: { aggregate: { _sum: { totalCents: 500_000 } } } });
    await computeSaasRollup(prisma, { period: PERIOD });
    const where = prisma.argsFor('invoice', 'aggregate')?.['where'] as Args;
    expect((where['status'] as { in: string[] }).in).toEqual(['ISSUED', 'PAID', 'OVERDUE']);
    expect(where['periodStart']).toEqual({ gte: PERIOD.from, lt: PERIOD.to });
  });

  it('never reports negative receivables when a window over-collects', async () => {
    const prisma = makeFake({
      invoice: { aggregate: { _sum: { totalCents: 100_000 } } },
      payment: { aggregate: { _sum: { amountCents: 140_000 } } },
    });
    const metrics = await computeSaasRollup(prisma, { period: PERIOD });
    expect(metrics.billedCents).toBe(100_000);
    expect(metrics.collectedCents).toBe(140_000);
    expect(metrics.outstandingCents).toBe(0);
  });

  it('reads the metered student count off PER_STUDENT subscription items, not a per-tenant Student fan-out', async () => {
    const prisma = makeFake({ subscriptionItem: { aggregate: { _sum: { quantity: 1_250 } } } });
    const metrics = await computeSaasRollup(prisma, { period: PERIOD });
    expect(metrics.meteredStudentCount).toBe(1_250);
    expect(prisma.argsFor('subscriptionItem', 'aggregate')?.['where']).toEqual({ itemType: 'PER_STUDENT' });
    // No cross-tenant Student scan at all: it would be the single most expensive query in the
    // product on a platform with thousands of tenants.
    expect(prisma.calls.filter((call) => call.delegate === 'student')).toHaveLength(0);
  });

  it('reads active users as a login window, not a status column', async () => {
    const prisma = makeFake({ user: { count: 42 } });
    const metrics = await computeSaasRollup(prisma, { period: PERIOD });
    const calls = prisma.calls.filter((call) => call.delegate === 'user');
    const active = (calls[1]?.args['where'] ?? {}) as Args;
    expect(active['lastLoginAt']).toEqual({ gte: PERIOD.from, lt: PERIOD.to });
    expect(metrics.activeUserCount).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// College rollup
// ---------------------------------------------------------------------------

const HOD_SCOPE: CollegeRollupScope = {
  tenantId: 'tenant-1',
  filter: { isGlobal: false, campusIds: [], departmentIds: ['dept-1'], programIds: ['prog-1', 'prog-2'] },
  admissionCampusIds: ['campus-1'],
};

function collegeFake(overrides: Record<string, Partial<Record<Method, Responder>>> = {}) {
  return makeFake({
    student: { count: 120, groupBy: counts('status', { ENROLLED: 100, ACTIVE: 20 }) },
    admissionApplication: {
      count: 44,
      groupBy: counts('status', { INITIATED: 20, SUBMITTED: 12, OFFERED: 5, ENROLLED: 3, REJECTED: 4 }),
    },
    studentAttendance: { groupBy: counts('status', { PRESENT: 70, LATE: 10, ABSENT: 15, LEAVE: 5 }) },
    studentFee: {
      aggregate: (args: Args) => {
        const where = args['where'] as Args;
        return (where['status'] as string | undefined) === 'OVERDUE'
          ? { _sum: { amountCents: 40_000, paidCents: 10_000, waivedCents: 0 } }
          : { _sum: { amountCents: 1_000_000 } };
      },
      groupBy: counts('status', { PAID: 30, PARTIALLY_PAID: 8, OVERDUE: 6 }),
    },
    studentPayment: { aggregate: { _sum: { amountCents: 600_000 } } },
    studentResult: {
      count: 80,
      groupBy: counts('outcome', { PASS: 70, FAIL: 10, INCOMPLETE: 25 }),
      aggregate: { _avg: { percentage: 72.4567 } },
    },
    employee: { count: 20 },
    facultyWorkload: {
      groupBy: [
        { workloadType: 'TEACHING', _sum: { hoursPerWeek: 14 } },
        { workloadType: 'ADMINISTRATIVE', _sum: { hoursPerWeek: 6 } },
      ],
    },
    placementOutcome: {
      findMany: [
        { studentId: 's1', outcomeStatus: 'PLACED', finalPackageCents: 800_000, createdAt: new Date('2026-03-01T10:00:00.000Z') },
        { studentId: 's2', outcomeStatus: 'PLACED', finalPackageCents: 600_000, createdAt: new Date('2026-03-01T11:00:00.000Z') },
        { studentId: 's3', outcomeStatus: 'NOT_PLACED', finalPackageCents: null, createdAt: new Date('2026-03-01T12:00:00.000Z') },
        { studentId: 's4', outcomeStatus: 'OPTED_OUT', finalPackageCents: null, createdAt: new Date('2026-03-01T13:00:00.000Z') },
      ],
    },
    studentHostelBooking: { count: 30 },
    studentLibraryLoan: { count: 25 },
    studentTransportPass: { count: 15 },
    user: { count: 9 },
    ...overrides,
  });
}

describe('computeCollegeRollup', () => {
  it('computes the admissions funnel as a pass-through of the exclusive status histogram', async () => {
    const metrics = await computeCollegeRollup(collegeFake(), { scope: { tenantId: 'tenant-1' }, period: PERIOD });
    const byStage = Object.fromEntries(metrics.admissionFunnel.map((stage) => [stage.stage, stage.count]));
    expect(byStage['INITIATED']).toBe(20);
    expect(byStage['OFFERED']).toBe(5);
    expect(metrics.admissionFunnel.map((stage) => stage.stage)).not.toContain('REJECTED');
    // Rejected rows stay visible in the raw breakdown, just not plotted as a funnel stage.
    expect(metrics.admissionApplicationCountByStatus['REJECTED']).toBe(4);
    // 3 enrolled of the 40 applications sitting in the pipeline (20+12+5+3), not of 44 total.
    expect(metrics.admissionConversionPercent).toBe(7.5);
  });

  it('counts LATE as attending and derives the rate from the histogram', async () => {
    const metrics = await computeCollegeRollup(collegeFake(), { scope: { tenantId: 'tenant-1' }, period: PERIOD });
    expect(metrics.attendanceMarkedCount).toBe(100);
    expect(metrics.attendancePresentCount).toBe(80);
    expect(metrics.attendanceRatePercent).toBe(80);
  });

  it('computes fee collection, outstanding and the overdue balance', async () => {
    const metrics = await computeCollegeRollup(collegeFake(), { scope: { tenantId: 'tenant-1' }, period: PERIOD });
    expect(metrics.feesBilledCents).toBe(1_000_000);
    expect(metrics.feesCollectedCents).toBe(600_000);
    expect(metrics.feesOutstandingCents).toBe(400_000);
    expect(metrics.collectionRatePercent).toBe(60);
    // Outstanding on overdue lines is a per-row difference of three columns, so it cannot be a
    // plain _sum; the rollup subtracts it rather than pulling the rows into Node.
    expect(metrics.feesOverdueCents).toBe(30_000);
  });

  it('excludes INCOMPLETE results from the pass rate denominator', async () => {
    const metrics = await computeCollegeRollup(collegeFake(), { scope: { tenantId: 'tenant-1' }, period: PERIOD });
    expect(metrics.resultsPublishedCount).toBe(80);
    expect(metrics.resultsPassPercent).toBe(87.5);
    expect(metrics.averagePercentage).toBe(72.46);
  });

  it('keeps a null average rather than 0 when nothing has been published', async () => {
    const metrics = await computeCollegeRollup(collegeFake({ studentResult: { aggregate: { _avg: { percentage: null } } } }), {
      scope: { tenantId: 'tenant-1' },
      period: PERIOD,
    });
    expect(metrics.averagePercentage).toBeNull();
  });

  it('averages faculty workload per active faculty member, and 0 (not NaN) with no faculty', async () => {
    const metrics = await computeCollegeRollup(collegeFake(), { scope: { tenantId: 'tenant-1' }, period: PERIOD });
    expect(metrics.facultyWorkloadHoursPerWeek).toBe(20);
    expect(metrics.averageFacultyWorkloadHours).toBe(1);

    const noFaculty = await computeCollegeRollup(collegeFake({ employee: { count: 0 } }), {
      scope: { tenantId: 'tenant-1' },
      period: PERIOD,
    });
    expect(noFaculty.averageFacultyWorkloadHours).toBe(0);
  });

  it('dedupes a student who has outcomes in two academic years and averages only placed packages', async () => {
    const metrics = await computeCollegeRollup(collegeFake(), { scope: { tenantId: 'tenant-1' }, period: PERIOD });
    expect(metrics.placementEligibleCount).toBe(4);
    expect(metrics.placementPlacedCount).toBe(2);
    expect(metrics.placementRatePercent).toBe(50);
    expect(metrics.averagePackageCents).toBe(700_000);
  });

  it('keeps a null average package when nobody was placed', async () => {
    const metrics = await computeCollegeRollup(
      collegeFake({
        placementOutcome: {
          findMany: [{ studentId: 's1', outcomeStatus: 'NOT_PLACED', finalPackageCents: null, createdAt: new Date() }],
        },
      }),
      { scope: { tenantId: 'tenant-1' }, period: PERIOD },
    );
    expect(metrics.averagePackageCents).toBeNull();
    expect(metrics.placementRatePercent).toBe(0);
  });

  it('reads amenities as current occupancy, excluding REQUESTED/RETURNED/CANCELLED', async () => {
    const prisma = collegeFake();
    const metrics = await computeCollegeRollup(prisma, { scope: { tenantId: 'tenant-1' }, period: PERIOD });
    expect(metrics.hostelOccupiedCount).toBe(30);
    expect(metrics.libraryActiveLoanCount).toBe(25);
    expect(metrics.transportActivePassCount).toBe(15);
    expect((prisma.argsFor('studentHostelBooking', 'count')?.['where'] as Args)['status']).toEqual({
      in: ['ALLOCATED', 'CHECKED_IN'],
    });
    // OVERDUE loans are still out - the copy is emphatically not back on the shelf.
    expect((prisma.argsFor('studentLibraryLoan', 'count')?.['where'] as Args)['status']).toEqual({
      in: ['ISSUED', 'OVERDUE'],
    });
  });

  it('reports active users for a tenant-wide caller', async () => {
    const metrics = await computeCollegeRollup(collegeFake(), { scope: { tenantId: 'tenant-1' }, period: PERIOD });
    expect(metrics.activeUserCount).toBe(9);
  });

  it('returns null active users - never an institution-wide leak or a fake 0 - for a narrowed scope', async () => {
    const prisma = collegeFake();
    const metrics = await computeCollegeRollup(prisma, { scope: HOD_SCOPE, period: PERIOD });
    // User has no campus/department/program dimension, so it cannot be attributed to a department.
    expect(metrics.activeUserCount).toBeNull();
    // And it must not even run the query that would leak the number.
    expect(prisma.calls.filter((call) => call.delegate === 'user')).toHaveLength(0);
  });

  it('scopes students by campus and program and excludes archived students', async () => {
    const prisma = collegeFake();
    await computeCollegeRollup(prisma, { scope: HOD_SCOPE, period: PERIOD });
    const where = prisma.argsFor('student', 'count')?.['where'] as Args;
    expect(where['tenantId']).toBe('tenant-1');
    expect(where['deletedAt']).toBeNull();
    expect(where['createdAt']).toEqual({ lt: PERIOD.to });
    expect(where['OR']).toEqual([{ programId: { in: ['prog-1', 'prog-2'] } }]);
    // The department grant's campus must not appear, or a HOD would see the whole campus.
    expect(JSON.stringify(where)).not.toContain('campus-1');
  });

  it('reaches children through a relation predicate instead of an IN list of student ids', async () => {
    const prisma = collegeFake();
    await computeCollegeRollup(prisma, { scope: HOD_SCOPE, period: PERIOD });
    const lookups: Array<[string, Method]> = [
      ['studentAttendance', 'groupBy'],
      ['studentResult', 'count'],
      ['studentPayment', 'aggregate'],
      ['studentHostelBooking', 'count'],
    ];
    for (const [delegate, method] of lookups) {
      const where = prisma.argsFor(delegate, method)?.['where'] as Args;
      const relation = where['student'] as { is: Args } | undefined;
      expect(relation?.is['tenantId']).toBe('tenant-1');
      // A materialized id list is the failure mode this design exists to avoid.
      expect(JSON.stringify(where)).not.toContain('studentId');
    }
  });

  it('resolves the admissions funnel through campuses because applications carry no program', async () => {
    const prisma = collegeFake();
    await computeCollegeRollup(prisma, { scope: HOD_SCOPE, period: PERIOD });
    const where = prisma.argsFor('admissionApplication', 'count')?.['where'] as Args;
    expect(where['campusId']).toEqual({ in: ['campus-1'] });
  });

  it('fails closed when a narrowed grant resolves to no campus, department or program', () => {
    const empty: AnalyticsScopeFilter = { isGlobal: false, campusIds: [], departmentIds: [], programIds: [] };
    const where = studentWhere({ tenantId: 'tenant-1', filter: empty }, PERIOD.to);
    // An impossible id rather than an absent filter: "no ids" must never mean "everything".
    expect(where['id']).toBe('00000000-0000-0000-0000-000000000000');
    expect(where['OR']).toBeUndefined();
  });

  it('costs a fixed number of round trips regardless of tenant size', async () => {
    const prisma = collegeFake();
    await computeCollegeRollup(prisma, { scope: { tenantId: 'tenant-1' }, period: PERIOD });
    // 20 independent, indexed aggregates. A regression that turned one of these into a per-student
    // query would show up here rather than as a dashboard timeout in production.
    expect(prisma.calls).toHaveLength(20);
  });
});

// ---------------------------------------------------------------------------
// Snapshot persistence
// ---------------------------------------------------------------------------

describe('upsertAnalyticsSnapshot', () => {
  it('keys a tenant row on (scope, tenantId, granularity, periodStart) so the read is a point lookup', async () => {
    const prisma = makeFake();
    await upsertAnalyticsSnapshot(prisma, {
      scope: 'TENANT',
      scopeKey: 'tenant-1',
      tenantId: 'tenant-1',
      period: PERIOD,
      metrics: { studentCount: 1 },
    });
    const args = prisma.argsFor('analyticsSnapshot', 'upsert') as Args;
    expect(args['where']).toEqual({
      scope_scopeKey_granularity_periodStart: {
        scope: 'TENANT',
        scopeKey: 'tenant-1',
        granularity: 'DAILY',
        periodStart: PERIOD.from,
      },
    });
    expect((args['create'] as Args)['tenantId']).toBe('tenant-1');
    expect((args['create'] as Args)['periodEnd']).toEqual(PERIOD.to);
  });

  it('writes a platform row with a non-null scopeKey and no tenant', async () => {
    const prisma = makeFake();
    await upsertAnalyticsSnapshot(prisma, { scope: 'PLATFORM', scopeKey: 'platform', period: PERIOD, metrics: {} });
    const create = prisma.argsFor('analyticsSnapshot', 'upsert')?.['create'] as Args;
    expect(create['scope']).toBe('PLATFORM');
    expect(create['scopeKey']).toBe('platform');
    expect(create['tenantId']).toBeNull();
  });

  it('refuses to write a tenant row with no tenantId, or a platform row with a tenant scopeKey', async () => {
    const prisma = makeFake();
    await expect(
      upsertAnalyticsSnapshot(prisma, { scope: 'TENANT', scopeKey: 'tenant-1', period: PERIOD, metrics: {} }),
    ).rejects.toThrow(/requires a tenantId/);
    await expect(
      upsertAnalyticsSnapshot(prisma, { scope: 'PLATFORM', scopeKey: 'tenant-1', period: PERIOD, metrics: {} }),
    ).rejects.toThrow(/scopeKey "platform"/);
  });

  it('recomputes rather than appends, so a re-run of the sweep is idempotent', async () => {
    const prisma = makeFake();
    const write = { scope: 'TENANT' as const, scopeKey: 'tenant-1', tenantId: 'tenant-1', period: PERIOD };
    await upsertAnalyticsSnapshot(prisma, { ...write, metrics: { v: 1 } });
    await upsertAnalyticsSnapshot(prisma, { ...write, metrics: { v: 2 } });
    const calls = prisma.calls.filter((call) => call.method === 'upsert');
    expect(calls).toHaveLength(2);
    // Same identity both times -> the unique index absorbs it as an update, not a duplicate row.
    expect(JSON.stringify(calls[0]?.args['where'])).toBe(JSON.stringify(calls[1]?.args['where']));
    expect(((calls[1]?.args['update'] ?? {}) as Args)['metrics']).toEqual({ v: 2 });
  });
});

// ---------------------------------------------------------------------------
// Drift guard: the funnel order must stay in step with the real Prisma enum
// ---------------------------------------------------------------------------

describe('admission funnel order vs. the Prisma enum', () => {
  const schema = readFileSync(join(__dirname, '..', '..', 'database', 'prisma', 'schema.prisma'), 'utf8');
  const enumBody = /enum AdmissionApplicationStatus \{([\s\S]*?)\n\}/.exec(schema)?.[1] ?? '';
  const values = new Set(
    enumBody
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('//'))
      .map((line) => line.split(/\s/)[0] ?? '')
      .filter((token) => token.length > 0),
  );

  it('found the enum (guards against a silent no-op assertion)', () => {
    expect(values.size).toBeGreaterThan(0);
    expect(values.has('INITIATED')).toBe(true);
    expect(values.has('ENROLLED')).toBe(true);
  });

  it('every funnel stage is a real AdmissionApplicationStatus value', () => {
    // A renamed or removed status would otherwise silently drop a bar from the funnel chart.
    for (const stage of ADMISSION_FUNNEL_ORDER) {
      expect(values.has(stage)).toBe(true);
    }
  });

  it('plots no terminal status as a stage', () => {
    for (const terminal of ADMISSION_TERMINAL_STATUSES) {
      expect(values.has(terminal)).toBe(true);
      expect(ADMISSION_FUNNEL_ORDER as readonly string[]).not.toContain(terminal);
    }
  });

  it('runs from the first pipeline step to the last, with no repeats', () => {
    expect(ADMISSION_FUNNEL_ORDER[0]).toBe('INITIATED');
    expect(ADMISSION_FUNNEL_ORDER[ADMISSION_FUNNEL_ORDER.length - 1]).toBe('ENROLLED');
    expect(new Set(ADMISSION_FUNNEL_ORDER).size).toBe(ADMISSION_FUNNEL_ORDER.length);
  });

  it('accounts for every enum value, so a new status cannot be silently omitted', () => {
    const funnel = ADMISSION_FUNNEL_ORDER as readonly string[];
    const terminals = ADMISSION_TERMINAL_STATUSES as readonly string[];
    const unmapped = [...values].filter((value) => !funnel.includes(value) && !terminals.includes(value));
    expect(unmapped).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The shared window contract the rollup relies on
// ---------------------------------------------------------------------------

describe('rollup window contract', () => {
  it('drops a partial leading day instead of dragging every rate down with it', () => {
    // `from` is mid-day, so 2026-03-01 is not a whole bucket and is skipped: 03-02..03-07.
    const periods = resolvePeriods(new Date('2026-03-01T13:37:00.000Z'), new Date('2026-03-08T00:00:00.000Z'), 'DAILY');
    expect(periods).toHaveLength(6);
    expect(periods[0]?.from.toISOString()).toBe('2026-03-02T00:00:00.000Z');
    expect(periods[periods.length - 1]?.to.toISOString()).toBe('2026-03-08T00:00:00.000Z');
  });
});
