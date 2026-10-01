import { BadRequestException } from '@nestjs/common';
import { assertKnownAiIntent, DEFAULT_ATTENDANCE_THRESHOLD_PERCENT, extractSlots, routeAiQuestion } from './ai-intent-router';

/**
 * The router is the component that decides which source permission an answer will be resolved
 * against, so its behaviour is a security property, not just a UX one. These tests pin the two
 * things that matter: the *priority* between intents (an action beats a data read; a specific
 * finding beats an aggregate), and the *conservatism* of slot extraction (no guessing at a window).
 */
describe('routeAiQuestion', () => {
  it('routes an at-risk question to the risk intent', () => {
    expect(routeAiQuestion('Which students are at risk of dropping out?').intent).toBe('STUDENT_RISK_INSIGHTS');
  });

  it('prefers an action over the data it acts on', () => {
    // "report" would otherwise lose to the attendance intent it mentions; the user wants a report.
    expect(routeAiQuestion('Generate an attendance report for the last 30 days').intent).toBe('REPORT_GENERATION');
    // Same for drafting over the low-attendance data it is about.
    expect(routeAiQuestion('Draft an email to guardians of students with low attendance').intent).toBe('COMMUNICATION_DRAFT');
  });

  it('routes the documented example phrasings for each data intent', () => {
    expect(routeAiQuestion('Show students with attendance below 75%').intent).toBe('LOW_ATTENDANCE_STUDENTS');
    expect(routeAiQuestion('Who has outstanding fees?').intent).toBe('OUTSTANDING_FEES');
    expect(routeAiQuestion('How many applications did we get this year?').intent).toBe('ADMISSIONS_STATISTICS');
    expect(routeAiQuestion('Which subjects have the highest failure rate?').intent).toBe('EXAM_PERFORMANCE');
    expect(routeAiQuestion('What is the placement rate and average package this year?').intent).toBe('PLACEMENT_STATISTICS');
    expect(routeAiQuestion('Compare department performance').intent).toBe('DEPARTMENT_PERFORMANCE');
    expect(routeAiQuestion('Give me an overview of the college').intent).toBe('ANALYTICS_OVERVIEW');
  });

  it('returns null (not a guess) for an unmapped phrasing, so it is logged as UNSUPPORTED', () => {
    const result = routeAiQuestion('hello there, how are you?');
    expect(result.intent).toBeNull();
    expect(result.definition).toBeNull();
    expect(result.matchedPatterns).toEqual([]);
  });
});

describe('extractSlots', () => {
  const NOW = new Date('2026-10-01T00:00:00.000Z');

  it('reads a trailing window and a percentage threshold from one sentence', () => {
    const slots = extractSlots('attendance below 70% in the last 45 days', NOW);
    expect(slots.attendanceThresholdPercent).toBe(70);
    const days = Math.round(((slots.dateTo ?? NOW).getTime() - (slots.dateFrom ?? NOW).getTime()) / 86_400_000);
    expect(days).toBe(45);
  });

  it('flags an overdue-only fee question', () => {
    expect(extractSlots('which fees are past due', NOW).overdueOnly).toBe(true);
  });

  it('leaves the threshold undefined when the question states none, so the caller default applies', () => {
    const slots = extractSlots('show me low attendance', NOW);
    expect(slots.attendanceThresholdPercent).toBeUndefined();
    expect(DEFAULT_ATTENDANCE_THRESHOLD_PERCENT).toBe(75);
  });

  it('does not guess a window from a phrase that only might be a date', () => {
    const slots = extractSlots('attendance since the start of the term', NOW);
    expect(slots.dateFrom).toBeUndefined();
    expect(slots.dateTo?.getTime()).toBe(NOW.getTime());
  });
});

describe('assertKnownAiIntent', () => {
  it('returns the definition for a known intent', () => {
    expect(assertKnownAiIntent('ANALYTICS_OVERVIEW').intent).toBe('ANALYTICS_OVERVIEW');
  });

  it('rejects an unknown intent rather than silently falling back', () => {
    expect(() => assertKnownAiIntent('NOT_A_REAL_INTENT')).toThrow(BadRequestException);
  });
});
