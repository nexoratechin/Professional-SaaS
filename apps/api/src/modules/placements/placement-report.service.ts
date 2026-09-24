/**
 * Placement report service — the final placement state (PlacementOutcome per student per
 * academic year), placement statistics, department analytics and the generated placement report.
 * `PlacementOutcome` is the analytics anchor (unique per tenant/year/student): declaring an
 * outcome is the closes-the-books step that the report/statistics/analytics reads aggregate.
 *
 * All student-anchored reads are scoped to the caller's grants via placementStudentWhere.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AUDIT_ACTIONS, PERMISSION_KEYS as K, type AuthenticatedUser } from '@college-erp/auth';
import { Prisma } from '@college-erp/database';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { AuditService } from '../audit/audit.service';
import { PermissionsService } from '../rbac/permissions.service';
import { placementStudentWhere } from './placements-scope';
import { placementStudentSelect, recordPlacementAudit, toDate } from './placements-shared';
import * as Dto from './dto/placements.dto';

type Where = Record<string, unknown>;

@Injectable()
export class PlacementReportService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditService: AuditService,
    private readonly permissions: PermissionsService,
  ) {}

  // ── Outcomes ──────────────────────────────────────────────────────────────

  async listOutcomes(tenantId: string, user: AuthenticatedUser, query: Dto.QueryOutcomesDto) {
    const grants = await this.permissions.getScopeGrantsFor(tenantId, user.id, K.PLACEMENTS_VIEW);
    const studentWhere = placementStudentWhere(grants, user.id);
    const where: Where = {};
    if (query.academicYearId) where.academicYearId = query.academicYearId;
    if (query.studentId) where.studentId = query.studentId;
    if (query.driveId) where.driveId = query.driveId;
    if (query.outcomeStatus) where.outcomeStatus = query.outcomeStatus;
    if (!query.includeUnregistered) where.outcomeStatus = { not: 'UNREGISTERED' };
    if (studentWhere) where.student = studentWhere;

    const [data, total] = await Promise.all([
      this.tenantPrisma.client.placementOutcome.findMany({
        where,
        orderBy: [{ placedAt: 'desc' }, { updatedAt: 'desc' }],
        skip: query.skip ?? 0,
        take: query.take ?? 25,
        include: {
          student: { select: placementStudentSelect },
          academicYear: { select: { id: true, name: true, code: true } },
          drive: { select: { id: true, title: true, code: true } },
          offer: { select: { id: true, offerLetterNumber: true } },
          position: { select: { id: true, title: true } },
        },
      }),
      this.tenantPrisma.client.placementOutcome.count({ where }),
    ]);
    return { data, total };
  }

  async declareOutcome(tenantId: string, user: AuthenticatedUser, dto: Dto.DeclareOutcomeDto) {
    const student = await this.tenantPrisma.client.student.findFirst({ where: { id: dto.studentId, deletedAt: null } });
    if (!student) throw new NotFoundException('Student not found.');
    const year = await this.tenantPrisma.client.academicYear.findFirst({ where: { id: dto.academicYearId } });
    if (!year) throw new BadRequestException('Academic year not found.');

    const existing = await this.tenantPrisma.client.placementOutcome.findFirst({
      where: { academicYearId: dto.academicYearId, studentId: dto.studentId },
    });

    const packageCents = dto.finalPackageCents ?? (dto.offerId ? (await this.offerPackage(dto.offerId)) : null);
    const data = {
      academicYearId: dto.academicYearId,
      studentId: dto.studentId,
      driveId: dto.driveId,
      positionId: dto.positionId,
      offerId: dto.offerId,
      outcomeStatus: dto.outcomeStatus as Prisma.PlacementOutcomeUncheckedUpdateInput['outcomeStatus'],
      finalPackageCents: packageCents,
      placedAt: dto.outcomeStatus === 'PLACED' ? toDate(dto.placedAt, 'placedAt') ?? new Date() : toDate(dto.placedAt, 'placedAt'),
      remarks: dto.remarks,
      declaredByUserId: user.id,
      updatedBy: user.id,
    };

    const saved = existing
      ? await this.tenantPrisma.client.placementOutcome.update({ where: { id: existing.id }, data })
      : await this.tenantPrisma.client.placementOutcome.create({
          data: {
            ...data,
            tenantId,
            createdBy: user.id,
            updatedBy: undefined,
            outcomeStatus: dto.outcomeStatus as Prisma.PlacementOutcomeUncheckedCreateInput['outcomeStatus'],
          },
        });

    await recordPlacementAudit(
      this.auditService,
      { tenantId, actorUserId: user.id },
      existing ? AUDIT_ACTIONS.PLACEMENT_OUTCOME_UPDATED : AUDIT_ACTIONS.PLACEMENT_OUTCOME_DECLARED,
      'PlacementOutcome',
      saved.id,
      { academicYearId: dto.academicYearId, studentId: dto.studentId, outcomeStatus: dto.outcomeStatus, finalPackageCents: packageCents },
    );
    return saved;
  }

  async updateOutcome(tenantId: string, user: AuthenticatedUser, id: string, dto: Dto.UpdateOutcomeDto) {
    const outcome = await this.tenantPrisma.client.placementOutcome.findFirst({ where: { id } });
    if (!outcome) throw new NotFoundException('Outcome not found.');

    const finalPackageCents =
      dto.finalPackageCents !== undefined
        ? dto.finalPackageCents
        : dto.offerId
          ? await this.offerPackage(dto.offerId)
          : dto.outcomeStatus === 'PLACED'
            ? outcome.finalPackageCents
            : undefined;

    const data: Prisma.PlacementOutcomeUncheckedUpdateInput = {
      outcomeStatus: dto.outcomeStatus as Prisma.PlacementOutcomeUncheckedUpdateInput['outcomeStatus'],
      driveId: dto.driveId,
      positionId: dto.positionId,
      offerId: dto.offerId,
      finalPackageCents,
      placedAt: dto.placedAt !== undefined ? toDate(dto.placedAt, 'placedAt') : undefined,
      remarks: dto.remarks,
      declaredByUserId: user.id,
      updatedBy: user.id,
    };
    (Object.keys(data) as Array<keyof typeof data>).forEach((key) => {
      if (data[key] === undefined) delete data[key];
    });

    const updated = await this.tenantPrisma.client.placementOutcome.update({ where: { id }, data });
    await recordPlacementAudit(
      this.auditService,
      { tenantId, actorUserId: user.id },
      AUDIT_ACTIONS.PLACEMENT_OUTCOME_UPDATED,
      'PlacementOutcome',
      id,
      dto,
    );
    return updated;
  }

  private async offerPackage(offerId: string): Promise<number | null> {
    const offer = await this.tenantPrisma.client.placementOffer.findFirst({
      where: { id: offerId, status: { in: ['ACCEPTED', 'ISSUED'] } },
      select: { packageCents: true },
    });
    return offer?.packageCents ?? null;
  }

  // ── Statistics & analytics ────────────────────────────────────────────────

  async statistics(tenantId: string, user: AuthenticatedUser, query: Dto.StatisticsQueryDto) {
    const grants = await this.permissions.getScopeGrantsFor(tenantId, user.id, K.PLACEMENTS_VIEW);
    const studentWhere = placementStudentWhere(grants, user.id);
    const studentFilter: Where = studentWhere ? { student: studentWhere } : {};

    const yearFilter: Where = query.academicYearId ? { academicYearId: query.academicYearId } : {};

    const [
      totalCompanies,
      totalDrives,
      totalPositions,
      totalApplications,
      shortlistedCandidates,
      selectedCandidates,
      offersIssued,
      offersAccepted,
      joined,
      eligibleStudents,
      drivesByStatus,
      placedStudents,
      outcomesAll,
    ] = await Promise.all([
      this.tenantPrisma.client.placementCompany.count({ where: { deletedAt: null } }),
      this.tenantPrisma.client.placementDrive.count({ where: { deletedAt: null } }),
      this.tenantPrisma.client.placementPosition.count({ where: { deletedAt: null } }),
      this.tenantPrisma.client.placementApplication.count({ where: { ...studentFilter, status: { not: 'WITHDRAWN' } } }),
      this.tenantPrisma.client.placementApplication.count({ where: { ...studentFilter, status: 'SHORTLISTED' } }),
      this.tenantPrisma.client.placementSelection.count({ where: studentFilter }),
      this.tenantPrisma.client.placementOffer.count({ where: { deletedAt: null, status: 'ISSUED', ...studentFilter } }),
      this.tenantPrisma.client.placementOffer.count({ where: { deletedAt: null, status: 'ACCEPTED', ...studentFilter } }),
      this.tenantPrisma.client.placementJoining.count({ where: { status: 'JOINED', ...studentFilter } }),
      this.tenantPrisma.client.placementEligibility.groupBy({
        by: ['studentId'],
        where: { ...studentFilter, status: { in: ['ELIGIBLE', 'EXEMPTED'] } },
        _count: { _all: true },
      }),
      this.tenantPrisma.client.placementDrive.groupBy({ by: ['status'], where: { deletedAt: null }, _count: { _all: true } }),
      this.tenantPrisma.client.placementOutcome.count({ where: { ...yearFilter, ...studentFilter, outcomeStatus: 'PLACED' } }),
      this.tenantPrisma.client.placementOutcome.findMany({
        where: { ...yearFilter, ...studentFilter, outcomeStatus: { not: 'UNREGISTERED' } },
        select: {
          id: true,
          outcomeStatus: true,
          finalPackageCents: true,
          placedAt: true,
          academicYearId: true,
          student: { select: { id: true } },
          drive: { select: { id: true, title: true } },
          offer: { select: { id: true, offerLetterNumber: true } },
        },
        orderBy: { placedAt: 'desc' },
        take: 10,
      }),
    ]);

    const packages = outcomesAll.map((o) => o.finalPackageCents).filter((p): p is number => p !== null);
    const averagePackageCents = packages.length ? Math.round(packages.reduce((a, b) => a + b, 0) / packages.length) : null;
    const highestPackageCents = packages.length ? Math.max(...packages) : null;
    const lowestPackageCents = packages.length ? Math.min(...packages) : null;

    return {
      totalCompanies,
      totalDrives,
      totalPositions,
      totalApplications,
      shortlistedCandidates,
      selectedCandidates,
      offersIssued,
      offersAccepted,
      joined,
      placedStudents,
      eligibleStudents: new Set(eligibleStudents.map((e) => e.studentId)).size,
      drivesByStatus: Object.fromEntries(drivesByStatus.map((d) => [d.status, d._count._all])),
      averagePackageCents,
      highestPackageCents,
      lowestPackageCents,
      departmentAnalytics: await this.departmentAnalytics(tenantId, user, query.academicYearId),
      recentOutcomes: outcomesAll,
    };
  }

  /** Per-department (via program) placement analytics for the selected academic year. */
  async departmentAnalytics(tenantId: string, user: AuthenticatedUser, academicYearId?: string) {
    const grants = await this.permissions.getScopeGrantsFor(tenantId, user.id, K.PLACEMENTS_VIEW);
    const studentWhere = placementStudentWhere(grants, user.id);
    const studentFilter: Where = studentWhere ? { student: studentWhere } : {};
    const yearFilter: Where = academicYearId ? { academicYearId } : {};

    const outcomes = await this.tenantPrisma.client.placementOutcome.findMany({
      where: { ...yearFilter, ...studentFilter },
      select: {
        outcomeStatus: true,
        finalPackageCents: true,
        student: { select: { id: true, program: { select: { id: true, name: true, department: { select: { id: true, name: true } } } } } },
      },
    });

    const byProgram = new Map<
      string,
      { departmentId: string; departmentName: string; programId: string | null; programName: string | null; placed: number; notPlaced: number; optedOut: number; total: number; packages: number[] }
    >();

    for (const o of outcomes) {
      const program = o.student.program;
      const depId = program?.department?.id ?? null;
      const progId = program?.id ?? null;
      const key = progId ?? `na-${depId ?? 'x'}`;
      let bucket = byProgram.get(key);
      if (!bucket) {
        bucket = {
          departmentId: depId ?? '',
          departmentName: program?.department?.name ?? 'Unknown',
          programId: progId,
          programName: program?.name ?? null,
          placed: 0,
          notPlaced: 0,
          optedOut: 0,
          total: 1,
          packages: [],
        };
        byProgram.set(key, bucket);
      } else {
        bucket.total += 1;
      }
      if (o.outcomeStatus === 'PLACED') bucket.placed += 1;
      if (o.outcomeStatus === 'NOT_PLACED') bucket.notPlaced += 1;
      if (o.outcomeStatus === 'OPTED_OUT') bucket.optedOut += 1;
      if (o.outcomeStatus === 'PLACED' && o.finalPackageCents !== null) bucket.packages.push(o.finalPackageCents);
    }

    // Total registered students per program in the caller's scope, to compute placement rate.
    const groupedStudents = await this.tenantPrisma.client.student.groupBy({
      by: ['programId'],
      where: { deletedAt: null, ...(studentWhere ? (studentWhere as Where) : {}) },
      _count: { _all: true },
    });
    const programIds = groupedStudents.map((g) => g.programId).filter((p): p is string => p !== null);
    const programs = programIds.length
      ? await this.tenantPrisma.client.program.findMany({
          where: { id: { in: programIds }, deletedAt: null },
          select: { id: true, department: { select: { id: true, name: true } } },
        })
      : [];
    const programDepartment = new Map(programs.map((p) => [p.id, p.department]));
    const totalsByProgram = new Map(groupedStudents.map((g) => [g.programId, g._count._all]));

    const result: Array<{
      departmentId: string | null;
      departmentName: string;
      programId: string | null;
      programName: string | null;
      totalStudents: number;
      placed: number;
      optedOut: number;
      notPlaced: number;
      placementRate: number | null;
      averagePackageCents: number | null;
      highestPackageCents: number | null;
      lowestPackageCents: number | null;
    }> = [];

    for (const bucket of byProgram.values()) {
      const totals = bucket.programId ? totalsByProgram.get(bucket.programId) ?? 0 : 0;
      const department = bucket.programId ? programDepartment.get(bucket.programId) : undefined;
      const departmentId = bucket.departmentId || department?.id || null;
      const departmentName = bucket.departmentName || department?.name || 'Unknown';
      const avg = bucket.packages.length ? Math.round(bucket.packages.reduce((a, b) => a + b, 0) / bucket.packages.length) : null;
      result.push({
        departmentId,
        departmentName,
        programId: bucket.programId,
        programName: bucket.programName,
        totalStudents: totals,
        placed: bucket.placed,
        optedOut: bucket.optedOut,
        notPlaced: bucket.notPlaced,
        placementRate: totals > 0 ? Number(((bucket.placed / totals) * 100).toFixed(2)) : null,
        averagePackageCents: avg,
        highestPackageCents: bucket.packages.length ? Math.max(...bucket.packages) : null,
        lowestPackageCents: bucket.packages.length ? Math.min(...bucket.packages) : null,
      });
    }

    return result.sort((a, b) => (b.placed - a.placed) || a.departmentName.localeCompare(b.departmentName));
  }

  // ── Report ────────────────────────────────────────────────────────────────

  async generateReport(tenantId: string, user: AuthenticatedUser, dto: Dto.GeneratePlacementReportDto) {
    const grants = await this.permissions.getScopeGrantsFor(tenantId, user.id, K.PLACEMENTS_VIEW);
    const studentWhere = placementStudentWhere(grants, user.id);
    const studentFilter: Where = studentWhere ? { student: studentWhere } : {};
    const yearFilter: Where = dto.academicYearId ? { academicYearId: dto.academicYearId } : {};
    const driveFilter: Where = dto.driveId ? { driveId: dto.driveId } : {};

    const [totalEligible, totalApplied, totalShortlisted, totalSelected, totalOffers, offersAccepted, joined, placed, departmentAnalytics, outcomes, academicYear, drive] =
      await Promise.all([
        this.tenantPrisma.client.placementEligibility.groupBy({
          by: ['studentId'],
          where: { ...driveFilter, ...studentFilter, status: { in: ['ELIGIBLE', 'EXEMPTED'] } },
          _count: { _all: true },
        }),
        this.tenantPrisma.client.placementApplication.count({ where: { ...driveFilter, ...studentFilter, status: { not: 'WITHDRAWN' } } }),
        this.tenantPrisma.client.placementApplication.count({ where: { ...driveFilter, ...studentFilter, status: 'SHORTLISTED' } }),
        this.tenantPrisma.client.placementSelection.count({ where: { ...driveFilter, ...studentFilter } }),
        this.tenantPrisma.client.placementOffer.count({ where: { ...driveFilter, deletedAt: null, ...studentFilter } }),
        this.tenantPrisma.client.placementOffer.count({ where: { ...driveFilter, deletedAt: null, status: 'ACCEPTED', ...studentFilter } }),
        this.tenantPrisma.client.placementJoining.count({ where: { ...driveFilter, status: 'JOINED', ...studentFilter } }),
        this.tenantPrisma.client.placementOutcome.count({ where: { ...yearFilter, ...driveFilter, ...studentFilter, outcomeStatus: 'PLACED' } }),
        this.departmentAnalytics(tenantId, user, dto.academicYearId),
        this.tenantPrisma.client.placementOutcome.findMany({
          where: { ...yearFilter, ...driveFilter, ...studentFilter, outcomeStatus: { not: 'UNREGISTERED' } },
          select: {
            id: true,
            outcomeStatus: true,
            finalPackageCents: true,
            placedAt: true,
            student: { select: placementStudentSelect },
            drive: { select: { id: true, title: true, code: true } },
            academicYear: { select: { id: true, name: true, code: true } },
          },
          orderBy: { placedAt: 'desc' },
          take: 200,
        }),
        dto.academicYearId
          ? this.tenantPrisma.client.academicYear.findFirst({ where: { id: dto.academicYearId }, select: { id: true, name: true, code: true } })
          : null,
        dto.driveId
          ? this.tenantPrisma.client.placementDrive.findFirst({ where: { id: dto.driveId }, include: { company: { select: { id: true, name: true, code: true } } } })
          : null,
      ]);

    const report = {
      generatedAt: new Date().toISOString(),
      academicYear,
      drive,
      totalEligible: new Set(totalEligible.map((e) => e.studentId)).size,
      totalApplied,
      totalShortlisted,
      totalSelected,
      totalOffers,
      offersAccepted,
      joined,
      placed,
      departmentAnalytics,
      outcomes,
    };

    await recordPlacementAudit(
      this.auditService,
      { tenantId, actorUserId: user.id },
      AUDIT_ACTIONS.PLACEMENT_REPORT_GENERATED,
      'PlacementReport',
      `${dto.academicYearId ?? 'all'}:${dto.driveId ?? 'all'}`,
      { totalEligible: report.totalEligible, totalPlaced: report.placed, generatedAt: report.generatedAt },
    );
    return report;
  }
}