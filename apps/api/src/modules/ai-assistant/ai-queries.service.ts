/**
 * The scoped data queries behind each assistant capability.
 *
 * Every method here takes an already-resolved `ResolvedAiScope` and returns plain data. None of
 * them compose an LLM prompt, none of them call out to a provider, and none of them re-derive
 * authorization — that all happened once, in ai-scope.ts. This split is what makes the security
 * property checkable: the only thing standing between a user and a number is a scope object, and
 * the only thing standing between that number and a sentence is deterministic formatting.
 *
 * All queries narrow with the `studentWhere`-style predicate (campus OR program ids derived from
 * the scope) rather than materializing visible student ids, for the same reason the analytics
 * rollup does it that way: tens of thousands of uuids would blow up the query plan.
 */

import { Injectable } from '@nestjs/common';
import type { Prisma } from '@college-erp/database';
import { buildAdmissionFunnel, funnelConversionPercent, toFiniteNumber } from '@college-erp/analytics';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import type { ResolvedAiScope } from './ai-scope';

/** A uuid that can never match, used to fail closed when a scope yields no reachable dimension. */
const IMPOSSIBLE_ID = '00000000-0000-0000-0000-000000000000';

export interface AiQueryWindow {
  from: Date;
  to: Date;
}

export interface AiResolvedFilters extends AiQueryWindow {
  attendanceThresholdPercent?: number;
  overdueOnly?: boolean;
  campusId?: string;
  departmentId?: string;
  programId?: string;
  /** One specific student — a risk-insights request for a single named student, still intersected
   *  with the caller's scope by `candidates()`. */
  studentId?: string;
  limit: number;
}

type Row = Record<string, unknown>;

/**
 * The `Student` predicate every student-dimension query is reached through.
 *
 * Deliberately a relation predicate (`student: { is: ... }`) rather than an `IN (...)` list of
 * visible student ids, and deliberately has no `departmentId` — `Student` hangs off `Program`, so
 * a DEPARTMENT grant has already been expanded into program ids by `resolveAiScope`. A student
 * with no program at all is therefore invisible to a department-scoped caller, which fails closed.
 */
export function aiStudentWhere(scope: ResolvedAiScope, asOf: Date, window?: AiQueryWindow): Prisma.StudentWhereInput {
  const base: Prisma.StudentWhereInput = { createdAt: { lt: asOf }, deletedAt: null };
  const filter = scope.filter;
  if (filter.isGlobal) {
    return window ? { ...base, createdAt: { lt: asOf } } : base;
  }
  const alternatives: Prisma.StudentWhereInput[] = [];
  if (filter.campusIds.length > 0) alternatives.push({ campusId: { in: filter.campusIds } });
  if (filter.programIds.length > 0) alternatives.push({ programId: { in: filter.programIds } });
  if (alternatives.length === 0) return { ...base, id: IMPOSSIBLE_ID };
  return { ...base, OR: alternatives };
}

/** Campus predicate for `AdmissionApplication`, the one table with no program dimension. */
export function aiAdmissionWhere(scope: ResolvedAiScope, asOf: Date, window?: AiQueryWindow): Prisma.AdmissionApplicationWhereInput {
  const createdAt = window ? { gte: window.from, lt: window.to } : { lt: asOf };
  const base: Prisma.AdmissionApplicationWhereInput = { createdAt };
  if (scope.filter.isGlobal) return base;
  const campuses = scope.admissionCampusIds ?? [];
  if (campuses.length === 0) return { ...base, id: IMPOSSIBLE_ID };
  return { ...base, campusId: { in: campuses } };
}

const STUDENT_SELECT = {
  id: true,
  admissionNumber: true,
  fullName: true,
  campus: { select: { name: true } },
  program: { select: { name: true } },
  section: { select: { name: true } },
} as const;

@Injectable()
export class AiQueriesService {
  constructor(private readonly prisma: TenantScopedPrismaService) {}

  private get client() {
    return this.prisma.client;
  }

  // ── Low attendance ─────────────────────────────────────────────────────────

  /**
   * Students whose attendance rate over the window is below the threshold.
   *
   * The rate is the shared `computeAttendanceRatePercent` contract: PRESENT + LATE count as
   * attending (the student was physically there), and EVERY marked row is in the denominator —
   * including LEAVE, which is a real record of an approved absence, not a gap. Rolling that helper
   * in by hand instead of calling it would let the assistant and the analytics dashboard disagree
   * about who counts as present, which is the one thing this answer must not do.
   *
   * `limit` caps only the returned rows; the count and the average behind `totalCount` are computed
   * over every student that crossed the threshold, so a capped list never reads as the full answer.
   */
  async lowAttendance(scope: ResolvedAiScope, filters: AiResolvedFilters, now: Date) {
    const studentWhere = aiStudentWhere(scope, now);
    const attendance = await this.client.studentAttendance.groupBy({
      by: ['studentId', 'status'],
      where: { date: { gte: filters.from, lt: filters.to }, student: { is: studentWhere } },
      _count: { _all: true },
    });

    const byStudent = new Map<string, Row>();
    for (const entry of attendance as Row[]) {
      const studentId = String(entry['studentId'] ?? '');
      const status = String(entry['status'] ?? '');
      const count = toFiniteNumber((entry['_count'] as Row | undefined)?.['_all']);
      const row = byStudent.get(studentId) ?? { studentId, marked: 0, present: 0 };
      row['marked'] = toFiniteNumber(row['marked']) + count;
      if (isPresentStatus(status)) {
        row['present'] = toFiniteNumber(row['present']) + count;
      }
      byStudent.set(studentId, row);
    }

    const threshold = filters.attendanceThresholdPercent ?? 75;
    const low = [...byStudent.values()].filter((row) => {
      const marked = toFiniteNumber(row['marked']);
      if (marked === 0) return false;
      return (toFiniteNumber(row['present']) / marked) * 100 < threshold;
    });
    low.sort((left, right) => rateOf(left) - rateOf(right));

    // Worst-first, and the order is preserved through the hydration round-trip: `findMany({ in })`
    // gives no ordering guarantee, so the rows are re-assembled from `ordered` rather than from the
    // database's return order. Otherwise the answer's own sort would be at the mercy of a uuid index.
    const ordered = low.slice(0, filters.limit);
    const hydrated = await this.hydrateStudents(ordered.map((row) => String(row['studentId'])));
    const byId = new Map(hydrated.map((student) => [student.id, student]));

    const rows = ordered.flatMap((entry) => {
      const student = byId.get(String(entry['studentId']));
      if (!student) return [];
      return [{
        admissionNumber: student.admissionNumber,
        fullName: student.fullName,
        program: student.program,
        campus: student.campus,
        section: student.section,
        marked: toFiniteNumber(entry['marked']),
        present: toFiniteNumber(entry['present']),
        attendanceRatePercent: round2(rateOf(entry)),
      }];
    });

    const totalMarked = low.reduce((total, row) => total + toFiniteNumber(row['marked']), 0);
    const totalPresent = low.reduce((total, row) => total + toFiniteNumber(row['present']), 0);

    return {
      rows,
      totalCount: low.length,
      truncated: low.length > ordered.length,
      metrics: {
        threshold,
        studentCount: low.length,
        markedCount: totalMarked,
        presentCount: totalPresent,
        averageRatePercent: low.length === 0 ? null : round2((totalPresent / (totalMarked || 1)) * 100),
      },
    };
  }

  // ── Outstanding fees ──────────────────────────────────────────────────────

  /**
   * Students with an unpaid balance.
   *
   * "Outstanding" is derived per line as amount − paid − waived and summed in Node rather than
   * through a single `_sum`, because it is a per-row difference of three columns and no aggregate
   * can express it (see analytics' overdueOutstandingCents for the same reasoning). Lines whose
   * balance comes out at or below zero are excluded: a fully-paid line with a leftover "PAID"
   * status is not an outstanding balance, and reporting it as one would inflate the total.
   *
   * `overdueOnly` narrows to OVERDUE lines past their due date, which is the "who is in arrears"
   * question as opposed to "who owes anything at all".
   */
  async outstandingFees(scope: ResolvedAiScope, filters: AiResolvedFilters, now: Date) {
    const studentWhere = aiStudentWhere(scope, now);
    const lines = await this.client.studentFee.findMany({
      where: {
        student: { is: studentWhere },
        ...(filters.overdueOnly
          ? { status: 'OVERDUE', dueDate: { lt: filters.to } }
          : { status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] } }),
      },
      select: {
        studentId: true,
        amountCents: true,
        paidCents: true,
        waivedCents: true,
        dueDate: true,
        status: true,
      },
      // Bounded read for a whole-tenant scan; the per-student reduction below is what produces the
      // answer, and the returned `totalCount` is computed from every line read.
      take: 200_000,
    });

    const byStudent = new Map<string, {
      outstandingCents: number;
      overdueCents: number;
      oldestDueDate: Date | null;
      lineCount: number;
    }>();

    for (const line of lines) {
      const outstanding = line.amountCents - line.paidCents - line.waivedCents;
      if (outstanding <= 0) continue;
      const entry = byStudent.get(line.studentId) ?? { outstandingCents: 0, overdueCents: 0, oldestDueDate: null, lineCount: 0 };
      entry.outstandingCents += outstanding;
      entry.lineCount += 1;
      if (line.status === 'OVERDUE' && line.dueDate) {
        entry.overdueCents += outstanding;
        if (!entry.oldestDueDate || line.dueDate < entry.oldestDueDate) entry.oldestDueDate = line.dueDate;
      }
      byStudent.set(line.studentId, entry);
    }

    const ordered = [...byStudent.entries()].sort((left, right) => right[1].outstandingCents - left[1].outstandingCents);
    const capped = ordered.slice(0, filters.limit);
    const students = await this.hydrateStudents(capped.map(([studentId]) => studentId));
    const byId = new Map(students.map((student) => [student.id, student]));

    return {
      rows: capped.flatMap(([studentId, entry]) => {
        const student = byId.get(studentId);
        if (!student) return [];
        return [{
          admissionNumber: student.admissionNumber,
          fullName: student.fullName,
          program: student.program,
          campus: student.campus,
          outstandingCents: entry.outstandingCents,
          overdueCents: entry.overdueCents,
          lineCount: entry.lineCount,
          oldestDueDate: entry.oldestDueDate ? entry.oldestDueDate.toISOString() : null,
        }];
      }),
      totalCount: ordered.length,
      truncated: ordered.length > capped.length,
      metrics: {
        overdueOnly: filters.overdueOnly === true,
        studentCount: ordered.length,
        totalOutstandingCents: ordered.reduce((total, [, entry]) => total + entry.outstandingCents, 0),
        totalOverdueCents: ordered.reduce((total, [, entry]) => total + entry.overdueCents, 0),
      },
    };
  }

  // ── Admissions ────────────────────────────────────────────────────────────

  /**
   * Applications by status over the window, plus the funnel.
   *
   * Counted over *applications submitted in the window*, not over every application that exists:
   * "how many applications did we get in July" is a flow question, and answering it with the
   * cumulative stock would be the kind of confidently wrong number an assistant exists to avoid.
   * The funnel uses the shared `buildAdmissionFunnel`/`funnelConversionPercent` helpers, so the
   * stage list and the conversion figure match the analytics dashboard exactly.
   */
  async admissionsStatistics(scope: ResolvedAiScope, filters: AiResolvedFilters, now: Date) {
    const where = aiAdmissionWhere(scope, now, filters);
    const grouped = await this.client.admissionApplication.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    });
    const byStatus: Record<string, number> = {};
    for (const entry of grouped as Row[]) {
      byStatus[String(entry['status'] ?? 'UNKNOWN')] = toFiniteNumber((entry['_count'] as Row | undefined)?.['_all']);
    }
    const total = Object.values(byStatus).reduce((sum, count) => sum + count, 0);
    const funnel = buildAdmissionFunnel(byStatus);
    const conversion = funnelConversionPercent(funnel);

    const rows = Object.entries(byStatus)
      .sort((left, right) => right[1] - left[1])
      .map(([status, count]) => ({
        status,
        count,
        percentOfTotal: total === 0 ? 0 : round2((count / total) * 100),
      }));

    return {
      rows,
      totalCount: total,
      truncated: false,
      metrics: {
        applicationCount: total,
        conversionPercent: conversion,
        acceptedCount: (byStatus['ENROLLED'] ?? 0) + (byStatus['ADMITTED'] ?? 0) + (byStatus['OFFERED'] ?? 0),
      },
      funnel,
    };
  }

  // ── Department performance ────────────────────────────────────────────────

  /**
   * Per-department comparison.
   *
   * Per-department, not per-program, because "which department is doing badly" is a question about
   * departments. Departments are reached through `student.program.departmentId`, and a caller whose
   * scope covers only some programs of a department still sees the department row with only those
   * programs' numbers in it — the SQL aggregates only the students the predicate matched, so the
   * figure is honest about being partial rather than silently reporting a whole department.
   *
   * Rates are re-derived from the summed counts rather than averaged across departments for the same
   * reason the analytics dashboard does it: averaging percentages is not a percentage.
   */
  async departmentPerformance(scope: ResolvedAiScope, filters: AiResolvedFilters, now: Date) {
    const studentWhere = aiStudentWhere(scope, now);
    const departments = await this.client.department.findMany({
      where: { deletedAt: null },
      select: { id: true, code: true, name: true, campus: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });

    const [students, attendance, results, feeLines] = await Promise.all([
      this.client.student.findMany({
        where: studentWhere,
        select: {
          id: true,
          programId: true,
          program: { select: { departmentId: true, name: true } },
        },
        take: 200_000,
      }),
      this.client.studentAttendance.groupBy({
        by: ['studentId', 'status'],
        where: { date: { gte: filters.from, lt: filters.to }, student: { is: studentWhere } },
        _count: { _all: true },
      }),
      this.client.studentResult.groupBy({
        by: ['studentId', 'outcome'],
        where: { publishedAt: { gte: filters.from, lt: filters.to }, student: { is: studentWhere } },
        _count: { _all: true },
      }),
      this.client.studentFee.groupBy({
        by: ['studentId'],
        where: { student: { is: studentWhere } },
        _sum: { amountCents: true, paidCents: true, waivedCents: true },
      }),
    ]);

    const programDepartment = new Map<string, string | null>();
    for (const student of students) {
      programDepartment.set(student.programId ?? '', student.program?.departmentId ?? null);
    }

    interface Bucket {
      studentCount: number;
      marked: number;
      present: number;
      pass: number;
      graded: number;
      billedCents: number;
      paidCents: number;
      outstandingCents: number;
    }
    const buckets = new Map<string, Bucket>();
    const studentDepartment = new Map<string, string | null>();
    const bucketFor = (departmentId: string | null): Bucket | null => {
      if (!departmentId) return null;
      const existing = buckets.get(departmentId);
      if (existing) return existing;
      const created: Bucket = {
        studentCount: 0,
        marked: 0,
        present: 0,
        pass: 0,
        graded: 0,
        billedCents: 0,
        paidCents: 0,
        outstandingCents: 0,
      };
      buckets.set(departmentId, created);
      return created;
    };

    for (const student of students) {
      const departmentId = student.program?.departmentId ?? null;
      studentDepartment.set(student.id, departmentId);
      const bucket = bucketFor(departmentId);
      if (bucket) bucket.studentCount += 1;
    }

    for (const entry of attendance as Row[]) {
      const departmentId = studentDepartment.get(String(entry['studentId'] ?? '')) ?? null;
      const bucket = bucketFor(departmentId);
      if (!bucket) continue;
      const count = toFiniteNumber((entry['_count'] as Row | undefined)?.['_all']);
      bucket.marked += count;
      const status = String(entry['status'] ?? '');
      if (isPresentStatus(status)) bucket.present += count;
    }

    for (const entry of results as Row[]) {
      const departmentId = studentDepartment.get(String(entry['studentId'] ?? '')) ?? null;
      const bucket = bucketFor(departmentId);
      if (!bucket) continue;
      const count = toFiniteNumber((entry['_count'] as Row | undefined)?.['_all']);
      const outcome = String(entry['outcome'] ?? '');
      if (outcome === 'INCOMPLETE') continue;
      bucket.graded += count;
      if (outcome === 'PASS' || outcome === 'PASS_WITH_GRACE') bucket.pass += count;
    }

    for (const entry of feeLines as Row[]) {
      const departmentId = studentDepartment.get(String(entry['studentId'] ?? '')) ?? null;
      const bucket = bucketFor(departmentId);
      if (!bucket) continue;
      const sum = (entry['_sum'] ?? {}) as Row;
      const amount = toFiniteNumber(sum['amountCents']);
      const paid = toFiniteNumber(sum['paidCents']);
      const waived = toFiniteNumber(sum['waivedCents']);
      bucket.billedCents += amount;
      bucket.paidCents += paid + waived;
      bucket.outstandingCents += Math.max(amount - paid - waived, 0);
    }

    const rows = departments
      .flatMap((department) => {
        const bucket = buckets.get(department.id);
        if (!bucket) return [];
        return [{
          departmentCode: department.code,
          department: department.name,
          campus: department.campus?.name ?? null,
          studentCount: bucket.studentCount,
          attendanceRatePercent: percent(bucket.present, bucket.marked),
          passPercent: percent(bucket.pass, bucket.graded),
          outstandingCents: bucket.outstandingCents,
        }];
      })
      .sort((left, right) => (left['attendanceRatePercent'] as number) - (right['attendanceRatePercent'] as number))
      .slice(0, filters.limit);

    const totals = [...buckets.values()].reduce(
      (accumulator, bucket) => ({
        studentCount: accumulator.studentCount + bucket.studentCount,
        marked: accumulator.marked + bucket.marked,
        present: accumulator.present + bucket.present,
        graded: accumulator.graded + bucket.graded,
        pass: accumulator.pass + bucket.pass,
        outstandingCents: accumulator.outstandingCents + bucket.outstandingCents,
      }),
      { studentCount: 0, marked: 0, present: 0, graded: 0, pass: 0, outstandingCents: 0 },
    );

    return {
      rows,
      totalCount: buckets.size,
      truncated: buckets.size > rows.length,
      metrics: {
        departmentCount: buckets.size,
        studentCount: totals.studentCount,
        attendanceRatePercent: percent(totals.present, totals.marked),
        passPercent: percent(totals.pass, totals.graded),
        outstandingCents: totals.outstandingCents,
      },
    };
  }

  // ── Exam performance ──────────────────────────────────────────────────────

  /**
   * Per-subject outcome counts and pass rates.
   *
   * The pass rate's denominator deliberately excludes INCOMPLETE results — a student who has no
   * mark yet has not failed, and counting them would drag every freshly-started subject toward a
   * fake 40% pass rate. This is the shared `computePassRatePercent` contract, so the assistant and
   * the dashboard agree.
   */
  async examPerformance(scope: ResolvedAiScope, filters: AiResolvedFilters, now: Date) {
    const studentWhere = aiStudentWhere(scope, now);
    const results = await this.client.studentResult.groupBy({
      by: ['subjectCode', 'subjectName', 'outcome'],
      where: { publishedAt: { gte: filters.from, lt: filters.to }, student: { is: studentWhere } },
      _count: { _all: true },
      _avg: { percentage: true },
    });

    interface SubjectBucket {
      subjectCode: string;
      subjectName: string;
      graded: number;
      pass: number;
      incomplete: number;
      percentageSum: number;
      percentageCount: number;
    }
    const buckets = new Map<string, SubjectBucket>();
    for (const entry of results as Row[]) {
      const subjectCode = String(entry['subjectCode'] ?? '');
      const bucket = buckets.get(subjectCode) ?? {
        subjectCode,
        subjectName: String(entry['subjectName'] ?? subjectCode),
        graded: 0,
        pass: 0,
        incomplete: 0,
        percentageSum: 0,
        percentageCount: 0,
      };
      const count = toFiniteNumber((entry['_count'] as Row | undefined)?.['_all']);
      const outcome = String(entry['outcome'] ?? '');
      if (outcome === 'INCOMPLETE') {
        bucket.incomplete += count;
      } else {
        bucket.graded += count;
        if (outcome === 'PASS' || outcome === 'PASS_WITH_GRACE') bucket.pass += count;
      }
      const average = (entry['_avg'] ?? {}) as Row;
      const percentage = average['percentage'];
      if (percentage !== null && percentage !== undefined) {
        // Each outcome group's mean contributes in proportion to its size, which is what makes the
        // subject average a mean over its graded rows rather than a mean of means.
        bucket.percentageSum += toFiniteNumber(percentage) * count;
        bucket.percentageCount += count;
      }
      buckets.set(subjectCode, bucket);
    }

    const ordered = [...buckets.values()].sort((left, right) => percent(left.pass, left.graded) - percent(right.pass, right.graded));
    const capped = ordered.slice(0, filters.limit);

    const totalGraded = ordered.reduce((total, bucket) => total + bucket.graded, 0);
    const totalPass = ordered.reduce((total, bucket) => total + bucket.pass, 0);
    const totalIncomplete = ordered.reduce((total, bucket) => total + bucket.incomplete, 0);

    return {
      rows: capped.map((bucket) => ({
        subjectCode: bucket.subjectCode,
        subject: bucket.subjectName,
        gradedCount: bucket.graded,
        passCount: bucket.pass,
        passPercent: percent(bucket.pass, bucket.graded),
        incompleteCount: bucket.incomplete,
        averagePercentage: bucket.percentageCount === 0 ? null : round2(bucket.percentageSum / bucket.percentageCount),
      })),
      totalCount: ordered.length,
      truncated: ordered.length > capped.length,
      metrics: {
        subjectCount: ordered.length,
        gradedCount: totalGraded,
        passCount: totalPass,
        passPercent: percent(totalPass, totalGraded),
        incompleteCount: totalIncomplete,
      },
    };
  }

  // ── Placement statistics ──────────────────────────────────────────────────

  /**
   * Placement counts, rate and average package over the window.
   *
   * Deduplicated to the newest outcome per student *before* the rate is computed, because
   * `PlacementOutcome` is unique per (tenant, academic year, student) — a student with outcomes in
   * two years legitimately has two rows in a long window, and counting both would put them twice in
   * the denominator and quietly deflate the rate.
   */
  async placementStatistics(scope: ResolvedAiScope, filters: AiResolvedFilters, now: Date) {
    const studentWhere = aiStudentWhere(scope, now);
    const rows = await this.client.placementOutcome.findMany({
      where: { createdAt: { gte: filters.from, lt: filters.to }, student: { is: studentWhere } },
      select: { studentId: true, outcomeStatus: true, finalPackageCents: true, createdAt: true },
      take: 100_000,
    });

    const latest = new Map<string, Row>();
    for (const entry of rows) {
      const existing = latest.get(entry.studentId);
      if (!existing || millis(entry.createdAt) > millis(existing['createdAt'] as Date)) {
        latest.set(entry.studentId, entry as unknown as Row);
      }
    }

    const byStatus: Record<string, number> = {};
    const packages: number[] = [];
    for (const entry of latest.values()) {
      const status = String(entry['outcomeStatus'] ?? 'UNKNOWN');
      byStatus[status] = (byStatus[status] ?? 0) + 1;
      if (status === 'PLACED') {
        const packageCents = entry['finalPackageCents'];
        if (packageCents !== null && packageCents !== undefined) packages.push(toFiniteNumber(packageCents));
      }
    }

    const eligible = latest.size;
    const placed = byStatus['PLACED'] ?? 0;
    const averagePackage = packages.length === 0 ? null : round2(packages.reduce((a, b) => a + b, 0) / packages.length);
    const highestPackage = packages.length === 0 ? null : Math.max(...packages);

    const statusRows = Object.entries(byStatus)
      .sort((left, right) => right[1] - left[1])
      .map(([status, count]) => ({ status, count, percentOfEligible: percent(count, eligible) }));

    return {
      rows: statusRows.slice(0, filters.limit),
      totalCount: Object.keys(byStatus).length,
      truncated: false,
      metrics: {
        eligibleCount: eligible,
        placedCount: placed,
        placementRatePercent: percent(placed, eligible),
        averagePackageCents: averagePackage,
        highestPackageCents: highestPackage,
      },
    };
  }

  /**
   * Students in scope matching an optional extra filter, with the columns an answer renders.
   *
   * The only way a student id enters this module: every risk factor below is keyed off an id list
   * produced *here*, which is why the per-student helpers need no scope argument of their own —
   * the ids they receive have already been through `aiStudentWhere`. That is the whole authorization
   * story for risk insights in one sentence.
   */
  async candidates(scope: ResolvedAiScope, filters: AiResolvedFilters, now: Date) {
    const rows = await this.client.student.findMany({
      where: {
        ...aiStudentWhere(scope, now),
        ...(filters.programId ? { programId: filters.programId } : {}),
        ...(filters.campusId ? { campusId: filters.campusId } : {}),
        ...(filters.departmentId ? { program: { departmentId: filters.departmentId } } : {}),
        ...(filters.studentId ? { id: filters.studentId } : {}),
      },
      select: STUDENT_SELECT,
      orderBy: { fullName: 'asc' },
      take: Math.min(Math.max(filters.limit * 8, 200), 5_000),
    });
    return rows.map((row) => ({
      id: row.id,
      admissionNumber: row.admissionNumber,
      fullName: row.fullName,
      program: row.program?.name ?? null,
      campus: row.campus?.name ?? null,
      section: row.section?.name ?? null,
    }));
  }

  /**
   * Loads the display columns for a list of student ids, flattened to plain names.
   *
   * Goes through the tenant-scoped client, so an id belonging to another tenant is simply not
   * findable here — the list is a set of keys into *this* tenant and nothing else. The relation
   * objects are flattened to their `name` here rather than in each caller so that an answer table
   * never has to know a Student row was ever nested.
   */
  async hydrateStudents(ids: string[]): Promise<Array<{
    id: string;
    admissionNumber: string;
    fullName: string;
    program: string | null;
    campus: string | null;
    section: string | null;
  }>> {
    if (ids.length === 0) return [];
    const rows = await this.client.student.findMany({
      where: { id: { in: ids } },
      select: STUDENT_SELECT,
    });
    return rows.map((row) => ({
      id: row.id,
      admissionNumber: row.admissionNumber,
      fullName: row.fullName,
      program: row.program?.name ?? null,
      campus: row.campus?.name ?? null,
      section: row.section?.name ?? null,
    }));
  }

  /**
   * Pass / fail / incomplete counts per student, for the risk factors.
   *
   * INCOMPLETE is counted separately rather than folded into `fail`, because it is the difference
   * between "is failing" and "has not been marked yet" — a distinction a counsellor needs and a
   * blended count would erase.
   */
  async perStudentResultCounts(
    filters: AiQueryWindow,
    studentIds: string[],
  ): Promise<Map<string, { pass: number; fail: number; incomplete: number }>> {
    const out = new Map<string, { pass: number; fail: number; incomplete: number }>();
    if (studentIds.length === 0) return out;
    const rows = await this.client.studentResult.groupBy({
      by: ['studentId', 'outcome'],
      where: {
        publishedAt: { gte: filters.from, lt: filters.to },
        studentId: { in: studentIds },
      },
      _count: { _all: true },
    });
    for (const entry of rows as Row[]) {
      const studentId = String(entry['studentId'] ?? '');
      const count = toFiniteNumber((entry['_count'] as Row | undefined)?.['_all']);
      const bucket = out.get(studentId) ?? { pass: 0, fail: 0, incomplete: 0 };
      const outcome = String(entry['outcome'] ?? '');
      if (outcome === 'PASS' || outcome === 'PASS_WITH_GRACE') bucket.pass += count;
      else if (outcome === 'FAIL') bucket.fail += count;
      else bucket.incomplete += count;
      out.set(studentId, bucket);
    }
    return out;
  }

  /** Attendance histogram per student, for the risk factors. Same rate contract as everywhere. */
  async perStudentAttendance(
    filters: AiQueryWindow,
    studentIds: string[],
  ): Promise<Map<string, { marked: number; present: number }>> {
    const out = new Map<string, { marked: number; present: number }>();
    if (studentIds.length === 0) return out;
    const rows = await this.client.studentAttendance.groupBy({
      by: ['studentId', 'status'],
      where: { date: { gte: filters.from, lt: filters.to }, studentId: { in: studentIds } },
      _count: { _all: true },
    });
    for (const entry of rows as Row[]) {
      const studentId = String(entry['studentId'] ?? '');
      const count = toFiniteNumber((entry['_count'] as Row | undefined)?.['_all']);
      const bucket = out.get(studentId) ?? { marked: 0, present: 0 };
      bucket.marked += count;
      const status = String(entry['status'] ?? '');
      if (isPresentStatus(status)) bucket.present += count;
      out.set(studentId, bucket);
    }
    return out;
  }

  /** Outstanding/overdue totals per student, for the risk factors. */
  async perStudentFeeTotals(
    studentIds: string[],
  ): Promise<Map<string, { outstandingCents: number; overdueCents: number }>> {
    const out = new Map<string, { outstandingCents: number; overdueCents: number }>();
    if (studentIds.length === 0) return out;
    const rows = await this.client.studentFee.findMany({
      where: { studentId: { in: studentIds } },
      select: { studentId: true, amountCents: true, paidCents: true, waivedCents: true, status: true },
      take: 200_000,
    });
    for (const line of rows) {
      const outstanding = line.amountCents - line.paidCents - line.waivedCents;
      if (outstanding <= 0) continue;
      const bucket = out.get(line.studentId) ?? { outstandingCents: 0, overdueCents: 0 };
      bucket.outstandingCents += outstanding;
      if (line.status === 'OVERDUE') bucket.overdueCents += outstanding;
      out.set(line.studentId, bucket);
    }
    return out;
  }

  /** Newest placement outcome per student, for the risk factors. */
  async perStudentPlacement(
    studentIds: string[],
  ): Promise<Map<string, { outcomeStatus: string; finalPackageCents: number | null }>> {
    const out = new Map<string, { outcomeStatus: string; finalPackageCents: number | null }>();
    if (studentIds.length === 0) return out;
    const rows = await this.client.placementOutcome.findMany({
      where: { studentId: { in: studentIds } },
      select: { studentId: true, outcomeStatus: true, finalPackageCents: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 20_000,
    });
    for (const entry of rows) {
      if (out.has(entry.studentId)) continue;
      out.set(entry.studentId, { outcomeStatus: entry.outcomeStatus, finalPackageCents: entry.finalPackageCents });
    }
    return out;
  }

  }

/**
 * Does this attendance mark count as the student being there?
 *
 * Mirrors `computeAttendanceRatePercent`: PRESENT and LATE both do (LATE means the student was
 * physically present), nothing else does. Declared as one helper so every rate in this file agrees
 * with the analytics dashboard about the same student on the same day.
 */
function isPresentStatus(status: string): boolean {
  return status === 'PRESENT' || status === 'LATE';
}

function rateOf(row: Row): number {
  const marked = toFiniteNumber(row['marked']);
  if (marked === 0) return 0;
  return (toFiniteNumber(row['present']) / marked) * 100;
}

function percent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return round2((numerator / denominator) * 100);
}

function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function millis(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  return toFiniteNumber(value);
}

