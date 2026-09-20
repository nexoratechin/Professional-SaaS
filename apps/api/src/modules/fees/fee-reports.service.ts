/**
 * FeeReportsService — read-only finance analytics over the ledger: outstanding balances per
 * student, collections grouped by day/method, and demand status tallies. CSV export ships the
 * outstanding roll with a UTF-8 BOM so Excel renders paise correctly.
 */
import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@college-erp/database';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import {
  CollectionsReportQueryDto,
  DemandStatusReportQueryDto,
  OutstandingReportQueryDto,
} from './fees.dto';

type Client = PrismaClient;

const OPEN_LINE_STATUSES = ['ISSUED', 'OVERDUE', 'PARTIALLY_PAID'];

@Injectable()
export class FeeReportsService {
  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  private get client(): Client {
    return this.tenantPrisma.client as Client;
  }

  /** Per-student outstanding roll: open lines aggregated, optionally filtered by program/section. */
  async outstanding(tenantId: string, query: OutstandingReportQueryDto) {
    const studentWhere: Record<string, unknown> = {};
    if (query.programId) studentWhere.programId = query.programId;
    if (query.sectionId) studentWhere.sectionId = query.sectionId;

    const studentFilter = {
      tenantId,
      ...(Object.keys(studentWhere).length ? { OR: [studentWhere] } : {}),
    } as Record<string, unknown>;

    const [aggregated, totalStudents] = await Promise.all([
      this.client.studentFee.groupBy({
        by: ['studentId'],
        where: {
          tenantId,
          status: { in: OPEN_LINE_STATUSES },
          ...(Object.keys(studentWhere).length ? { student: studentWhere } : {}),
        },
        _sum: { amountCents: true, paidCents: true, waivedCents: true, lateFeeCents: true },
        _count: { _all: true },
      }),
      this.client.student.count({ where: studentFilter }),
    ]);

    const studentIds = aggregated.map((a) => a.studentId);
    const students = studentIds.length
      ? await this.client.student.findMany({
          where: { tenantId, id: { in: studentIds } },
          select: { id: true, fullName: true, admissionNumber: true, program: { select: { name: true } }, section: { select: { name: true } } },
        })
      : [];
    const byId = new Map(students.map((s) => [s.id, s]));

    const rows = aggregated
      .map((a) => {
        const sum = a._sum as Record<string, number | null>;
        const totalCents = (sum.amountCents ?? 0) + (sum.lateFeeCents ?? 0) - (sum.waivedCents ?? 0);
        const paidCents = sum.paidCents ?? 0;
        const student = byId.get(a.studentId);
        return {
          studentId: a.studentId,
          fullName: student?.fullName ?? null,
          admissionNumber: student?.admissionNumber ?? null,
          programName: student?.program?.name ?? null,
          sectionName: student?.section?.name ?? null,
          openLineCount: a._count._all,
          outstandingCents: Math.max(0, totalCents - paidCents),
        };
      })
      .filter((r) => (query.overdueOnly ? r.outstandingCents > 0 : true));

    rows.sort((x, y) => y.outstandingCents - x.outstandingCents);
    const totalOutstandingCents = rows.reduce((s, r) => s + r.outstandingCents, 0);

    const skip = query.skip ?? 0;
    const take = query.take ?? 100;
    const data = rows.slice(skip, skip + take);

    return { data, total: rows.length, studentPopulation: totalStudents, totalOutstandingCents };
  }

  /** Collections grouped by calendar day and payment method within [from, to]. */
  async collections(tenantId: string, query: CollectionsReportQueryDto) {
    const where: Record<string, unknown> = { tenantId, status: { in: ['SUCCEEDED', 'REFUNDED'] } };
    if (query.from) where.paymentDate = { ...((where.paymentDate as object) ?? {}), gte: new Date(query.from) };
    if (query.to) where.paymentDate = { ...((where.paymentDate as object) ?? {}), lte: new Date(query.to) };
    if (query.studentId) where.studentId = query.studentId;

    const [aggregated, byMethod] = await Promise.all([
      this.client.studentPayment.groupBy({
        by: ['paymentDate', 'status'],
        where,
        _sum: { amountCents: true },
        orderBy: [{ paymentDate: 'asc' }],
      }),
      this.client.studentPayment.groupBy({
        by: ['method'],
        where: { ...where, status: 'SUCCEEDED' },
        _sum: { amountCents: true },
        _count: { _all: true },
      }),
    ]);

    const dateBuckets = aggregated.map((a) => ({
      date: a.paymentDate.toISOString().slice(0, 10),
      status: a.status,
      amountCents: a._sum.amountCents ?? 0,
    }));

    const totalCollectedCents = aggregated
      .filter((a) => a.status === 'SUCCEEDED')
      .reduce((s, a) => s + (a._sum.amountCents ?? 0), 0);

    return {
      dateBuckets,
      totalCollectedCents,
      byMethod: byMethod.map((m) => ({
        method: m.method,
        amountCents: m._sum.amountCents ?? 0,
        count: m._count._all,
      })),
    };
  }

  /** Demand status tally, optionally sliced by term or program. */
  async demandStatus(tenantId: string, query: DemandStatusReportQueryDto) {
    const where: Record<string, unknown> = { tenantId };
    if (query.termId) where.termId = query.termId;
    if (query.programId) where.student = { programId: query.programId };

    const [byStatus, totals] = await Promise.all([
      this.client.feeDemand.groupBy({
        by: ['status'],
        where,
        _sum: { totalCents: true, paidCents: true, waivedCents: true, lateFeeCents: true },
        _count: { _all: true },
      }),
      this.client.feeDemand.aggregate({
        where,
        _sum: { totalCents: true, paidCents: true, waivedCents: true, lateFeeCents: true },
        _count: { _all: true },
      }),
    ]);

    const grand = totals._sum;
    const totalOutstandingCents = Math.max(
      0,
      (grand.totalCents ?? 0) + (grand.lateFeeCents ?? 0) - (grand.paidCents ?? 0) - (grand.waivedCents ?? 0),
    );

    return {
      byStatus: byStatus.map((s) => ({
        status: s.status,
        demandCount: s._count._all,
        billedCents: s._sum.totalCents ?? 0,
        paidCents: s._sum.paidCents ?? 0,
        waivedCents: s._sum.waivedCents ?? 0,
        lateFeeCents: s._sum.lateFeeCents ?? 0,
      })),
      totalDemands: totals._count,
      totalBilledCents: grand.totalCents ?? 0,
      totalCollectedCents: grand.paidCents ?? 0,
      totalOutstandingCents,
    };
  }

  /** UTF-8 BOM-prefixed CSV of the outstanding roll for FEES_EXPORT. */
  async outstandingCsv(tenantId: string, query: OutstandingReportQueryDto): Promise<string> {
    const report = await this.outstanding(tenantId, { ...query, skip: 0, take: 1000 });
    const header = ['Student', 'Admission No', 'Program', 'Section', 'Open Lines', 'Outstanding (paise)'];
    const lines = report.data.map((r) =>
      [r.fullName ?? '', r.admissionNumber ?? '', r.programName ?? '', r.sectionName ?? '', String(r.openLineCount), String(r.outstandingCents)]
        .map((cell) => `"${cell.replace(/"/g, '""')}"`)
        .join(','),
    );
    return '\uFEFF' + [header.join(','), ...lines].join('\n');
  }
}