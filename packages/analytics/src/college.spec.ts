import {
  ADMISSION_FUNNEL_ORDER,
  buildAdmissionFunnel,
  averageOf,
  analyticsScopeFilterFromGrants,
  computeAttendanceRatePercent,
  computeFeeCollection,
  computePassRatePercent,
  funnelConversionPercent,
  matchesAnalyticsScope,
} from './college';

describe('buildAdmissionFunnel', () => {
  it('passes the current-status histogram through as the funnel (statuses are exclusive)', () => {
    const funnel = buildAdmissionFunnel({ INITIATED: 100, SUBMITTED: 90, OFFERED: 40, ENROLLED: 35 });
    const byStage = Object.fromEntries(funnel.map((stage) => [stage.stage, stage.count]));
    expect(byStage['INITIATED']).toBe(100);
    expect(byStage['SUBMITTED']).toBe(90);
    expect(byStage['OFFERED']).toBe(40);
    expect(byStage['ENROLLED']).toBe(35);
    // A cumulative sum would claim 100 applications reached OFFERED; the data does not say that.
    expect(funnel).toHaveLength(ADMISSION_FUNNEL_ORDER.length);
    expect(funnel.reduce((sum, stage) => sum + stage.count, 0)).toBe(265);
  });

  it('scales every bar against the whole pipeline, not against the INITIATED bucket', () => {
    const funnel = buildAdmissionFunnel({ INITIATED: 200, SUBMITTED: 100, ENROLLED: 50 });
    expect(funnel.find((stage) => stage.stage === 'INITIATED')?.percentOfTop).toBe(57.14);
    expect(funnel.find((stage) => stage.stage === 'SUBMITTED')?.percentOfTop).toBe(28.57);
    expect(funnel.find((stage) => stage.stage === 'ENROLLED')?.percentOfTop).toBe(14.29);
  });

  it('excludes terminal statuses (rejected/cancelled) from the funnel entirely', () => {
    const funnel = buildAdmissionFunnel({ SUBMITTED: 30, REJECTED: 20, CANCELLED: 5 });
    const knownStages = new Set<string>(ADMISSION_FUNNEL_ORDER);
    // No stage picked up the rejected/cancelled rows.
    expect(funnel.reduce((sum, stage) => sum + stage.count, 0)).toBe(30);
    expect(funnel.filter((stage) => !knownStages.has(stage.stage))).toEqual([]);
    // The single live stage is the whole pipeline, so it is 100%.
    expect(funnel.find((stage) => stage.stage === 'SUBMITTED')).toEqual({
      stage: 'SUBMITTED',
      count: 30,
      percentOfTop: 100,
    });
    expect(funnel.find((stage) => stage.stage === 'INITIATED')?.count).toBe(0);
  });

  it('produces zeroed stages for an empty histogram', () => {
    const funnel = buildAdmissionFunnel({});
    expect(funnel.every((stage) => stage.count === 0)).toBe(true);
    expect(funnelConversionPercent(funnel)).toBe(0);
  });
});

describe('funnelConversionPercent', () => {
  it('measures enrolled against the whole pipeline, not the INITIATED bucket', () => {
    const funnel = buildAdmissionFunnel({ INITIATED: 200, ENROLLED: 40 });
    // 40 enrolled out of the 240 applications currently in the pipeline. Dividing by the
    // INITIATED count alone would wrongly report 20%.
    expect(funnelConversionPercent(funnel)).toBe(16.67);
  });

  it('returns 0 when the pipeline is empty', () => {
    expect(funnelConversionPercent(buildAdmissionFunnel({ REJECTED: 5 }))).toBe(0);
  });
});

describe('computeAttendanceRatePercent', () => {
  it('counts LATE as attending but not ABSENT', () => {
    expect(computeAttendanceRatePercent({ PRESENT: 70, LATE: 10, ABSENT: 15, LEAVE: 5 })).toEqual({
      marked: 100,
      present: 80,
      ratePercent: 80,
    });
  });

  it('returns 0 rather than NaN when nothing was marked', () => {
    expect(computeAttendanceRatePercent({}).ratePercent).toBe(0);
  });
});

describe('computeFeeCollection', () => {
  it('derives outstanding from billed minus collected and passes overdue through', () => {
    expect(computeFeeCollection(100_00, 60_00, 10_00)).toEqual({
      outstandingCents: 40_00,
      overdueCents: 10_00,
      collectionRatePercent: 60,
    });
  });

  it('never reports negative outstanding when over-collected (credits/adjustments)', () => {
    expect(computeFeeCollection(100_00, 100_00, 0).outstandingCents).toBe(0);
  });
});

describe('computePassRatePercent', () => {
  it('excludes INCOMPLETE rows from the denominator', () => {
    const result = computePassRatePercent({ PASS: 80, FAIL: 20, INCOMPLETE: 50 });
    expect(result).toEqual({ passPercent: 80, passCount: 80, gradedCount: 100 });
  });

  it('counts PASS_WITH_GRACE as a pass', () => {
    expect(computePassRatePercent({ PASS: 5, PASS_WITH_GRACE: 5, FAIL: 10 }).passPercent).toBe(50);
  });
});

describe('averageOf', () => {
  it('ignores null/undefined/NaN', () => {
    expect(averageOf([10, null, 20, undefined, Number.NaN])).toBe(15);
  });

  it('returns null for an empty sample so callers can show n/a instead of 0', () => {
    expect(averageOf([null, undefined])).toBeNull();
  });
});

describe('analytics scope filtering', () => {
  it('treats a GLOBAL grant as unrestricted', () => {
    const filter = analyticsScopeFilterFromGrants([{ scopeType: 'GLOBAL' }]);
    expect(filter.isGlobal).toBe(true);
    expect(matchesAnalyticsScope({ campusId: 'c1', programId: 'p1' }, filter)).toBe(true);
  });

  it('matches a program-scoped grant by program id', () => {
    const filter = analyticsScopeFilterFromGrants([{ scopeType: 'PROGRAM', programId: 'p1' }]);
    expect(matchesAnalyticsScope({ campusId: 'c1', programId: 'p1' }, filter)).toBe(true);
    expect(matchesAnalyticsScope({ campusId: 'c1', programId: 'p2' }, filter)).toBe(false);
  });

  it('matches a department grant by its resolved department id', () => {
    const filter = analyticsScopeFilterFromGrants([{ scopeType: 'DEPARTMENT', departmentId: 'd1', campusId: 'c1' }]);
    expect(matchesAnalyticsScope({ campusId: 'c1', departmentId: 'd1', programId: null }, filter)).toBe(true);
  });

  it('does NOT let a department grant leak to a sibling department in the same campus', () => {
    // This is the regression that matters: the grant carries campusId=c1 as a parent pointer, but
    // it must not be read as campus-wide access.
    const filter = analyticsScopeFilterFromGrants([{ scopeType: 'DEPARTMENT', departmentId: 'd1', campusId: 'c1' }]);
    expect(filter.campusIds).toEqual([]);
    expect(matchesAnalyticsScope({ campusId: 'c1', departmentId: 'd2', programId: null }, filter)).toBe(false);
    // A record with no department at all cannot be attributed to the granted department, so it
    // fails closed rather than being swept in.
    expect(matchesAnalyticsScope({ campusId: 'c1', departmentId: null, programId: null }, filter)).toBe(false);
  });

  it('matches a program inside a granted department through the department id', () => {
    const filter = analyticsScopeFilterFromGrants([{ scopeType: 'DEPARTMENT', departmentId: 'd1', campusId: 'c1' }]);
    expect(matchesAnalyticsScope({ campusId: 'c1', departmentId: 'd1', programId: 'pX' }, filter)).toBe(true);
  });

  it('matches by campus as the outermost level', () => {
    const filter = analyticsScopeFilterFromGrants([{ scopeType: 'CAMPUS', campusId: 'c9' }]);
    expect(matchesAnalyticsScope({ campusId: 'c9', programId: null }, filter)).toBe(true);
    expect(matchesAnalyticsScope({ campusId: 'c1', programId: null }, filter)).toBe(false);
  });

  it('denies everything when no ids were granted', () => {
    const filter = analyticsScopeFilterFromGrants([]);
    expect(matchesAnalyticsScope({ campusId: 'c1', programId: null }, filter)).toBe(false);
  });
});
