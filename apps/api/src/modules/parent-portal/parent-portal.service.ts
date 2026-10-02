/**
 * Parent/Guardian Portal service — a read-only composition layer over the existing domain modules.
 *
 * It introduces NO new tables and NO parallel business logic. What makes it a portal rather than a
 * staff API is the single access-control anchor below: the caller's own Guardian rows
 * (Guardians.userId = authenticated user id). There is no way to name another student:
 *   • resolveChild() resolves the requested studentId against the caller's linked children and
 *     throws 403 when it is not one of them; omitting studentId falls back to the first child.
 *   • Every read then filters by that resolved student id, so a guardian can only ever see their
 *     own children's profile / attendance / timetable / fees / payments / exams / results /
 *     documents / transport / hostel.
 *   • Notices use the caller's own per-user notification inbox (NotificationsService).
 *
 * Feature flags are honoured per section via TenantFeaturesService so a plan that excludes a
 * module never serves that module's data through the portal either.
 */
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { FEATURE_KEYS, type AuthenticatedUser, type FeatureKey } from '@college-erp/auth';
import { Prisma } from '@college-erp/database';
import { StorageService } from '../../common/storage/storage.service';
import { TenantContextService } from '../../common/prisma/tenant-context.service';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TenantFeaturesService } from '../rbac/tenant-features.service';
import { ParentPaginationDto } from './dto/parent-portal.dto';

/** Minimal projection of a linked child (Student + the Guardian row that links the caller to it). */
interface LinkedChild {
  guardianId: string;
  guardianKind: string;
  guardianRole: string;
  studentId: string;
  campusId: string;
  programId: string | null;
  sectionId: string | null;
  batchId: string | null;
  academicYearId: string | null;
  fullName: string;
  admissionNumber: string;
  rollNumber: string | null;
  status: string;
  profilePhotoKey: string | null;
}

const OPEN_FEE_STATUSES = ['ISSUED', 'OVERDUE', 'PARTIALLY_PAID'];

/** Guardian projection exposed to a guardian (drops the portal user link + income, which are
 *  registrar-only fields a co-guardian has no need to see). */
const GUARDIAN_PUBLIC_SELECT = {
  id: true,
  name: true,
  kind: true,
  role: true,
  phone: true,
  email: true,
  occupation: true,
  address: true,
} as const;

@Injectable()
export class ParentPortalService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly tenantFeatures: TenantFeaturesService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
  ) {}

  private tid(): string {
    const tenantId = this.tenantContext.tenantId;
    if (!tenantId) throw new ForbiddenException('Tenant context could not be established.');
    return tenantId;
  }

  private page(query: ParentPaginationDto, defaultTake = 50): { skip: number; take: number } {
    const take = Math.min(query.take ?? defaultTake, 200);
    return { skip: query.skip ?? 0, take };
  }

  /** Runs a section query only when the tenant's plan enables the module. */
  private async section<T>(feature: FeatureKey, fn: () => Promise<T>): Promise<T | null> {
    const enabled = await this.tenantFeatures.isEnabled(this.tid(), feature);
    return enabled ? fn() : null;
  }

  // ── Access control ──────────────────────────────────────────────────────────

  /** Every student the caller is a guardian of. The only path to a student id in this service. */
  async listChildren(user: AuthenticatedUser): Promise<LinkedChild[]> {
    const rows = await this.tenantPrisma.client.guardian.findMany({
      where: { userId: user.id, student: { deletedAt: null } },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        kind: true,
        role: true,
        studentId: true,
        student: {
          select: {
            id: true,
            campusId: true,
            programId: true,
            sectionId: true,
            batchId: true,
            academicYearId: true,
            fullName: true,
            admissionNumber: true,
            rollNumber: true,
            status: true,
            profilePhotoKey: true,
          },
        },
      },
    });
    return rows
      .map((row) => ({
        guardianId: row.id,
        guardianKind: row.kind,
        guardianRole: row.role,
        studentId: row.studentId,
        campusId: row.student.campusId,
        programId: row.student.programId,
        sectionId: row.student.sectionId,
        batchId: row.student.batchId,
        academicYearId: row.student.academicYearId,
        fullName: row.student.fullName,
        admissionNumber: row.student.admissionNumber,
        rollNumber: row.student.rollNumber,
        status: row.student.status,
        profilePhotoKey: row.student.profilePhotoKey,
      }))
      .filter((child, index, all) => all.findIndex((other) => other.studentId === child.studentId) === index);
  }

  /** Resolves the requested child against the caller's linked children, or 403. This is the
   *  single access-control anchor: no student id reaches a query without passing through here. */
  async resolveChild(user: AuthenticatedUser, studentId?: string): Promise<LinkedChild> {
    const children = await this.listChildren(user);
    if (!children.length) {
      throw new ForbiddenException(
        'Your account is not linked to a student profile. Please contact the registrar.',
      );
    }
    if (studentId) {
      const match = children.find((child) => child.studentId === studentId);
      if (!match) throw new ForbiddenException('You do not have access to this student.');
      return match;
    }
    return children[0]!;
  }

  private displayChild(child: LinkedChild) {
    return {
      studentId: child.studentId,
      fullName: child.fullName,
      admissionNumber: child.admissionNumber,
      rollNumber: child.rollNumber,
      status: child.status,
      profilePhotoKey: child.profilePhotoKey,
      guardianKind: child.guardianKind,
      guardianRole: child.guardianRole,
    };
  }

  async getChildren(user: AuthenticatedUser) {
    const children = await this.listChildren(user);
    return { children: children.map((child) => this.displayChild(child)) };
  }

  // ── Dashboard ───────────────────────────────────────────────────────────────

  async dashboard(user: AuthenticatedUser, studentId?: string) {
    const child = await this.resolveChild(user, studentId);
    const [
      attendance,
      timetable,
      fees,
      exams,
      results,
      documents,
      transport,
      hostel,
      notices,
    ] = await Promise.all([
      this.section(FEATURE_KEYS.ATTENDANCE, () => this.attendanceSummary(child.studentId)),
      this.section(FEATURE_KEYS.TIMETABLE, () => this.timetableSummary(child)),
      this.section(FEATURE_KEYS.FEES, () => this.feesSummary(child.studentId)),
      this.section(FEATURE_KEYS.EXAMS, () => this.examsSummary(child.studentId)),
      this.section(FEATURE_KEYS.RESULTS, () => this.resultsSummary(child.studentId)),
      this.documentsSummary(child.studentId),
      this.section(FEATURE_KEYS.TRANSPORT, () => this.transportSummary(child.studentId)),
      this.section(FEATURE_KEYS.HOSTEL, () => this.hostelSummary(child.studentId)),
      this.section(FEATURE_KEYS.NOTIFICATIONS, () => this.noticesSummary(user.id)),
    ]);

    return {
      student: this.displayChild(child),
      attendance,
      timetable,
      fees,
      exams,
      results,
      documents,
      transport,
      hostel,
      notices,
      generatedAt: new Date().toISOString(),
    };
  }

  // ── Profile ────────────────────────────────────────────────────────────────

  async getProfile(user: AuthenticatedUser, studentId?: string) {
    const child = await this.resolveChild(user, studentId);
    const row = await this.tenantPrisma.client.student.findFirst({
      where: { id: child.studentId, deletedAt: null },
      include: {
        campus: { select: { id: true, name: true, code: true } },
        program: { select: { id: true, name: true, code: true } },
        batch: { select: { id: true, name: true } },
        section: { select: { id: true, name: true } },
        academicYear: { select: { id: true, name: true } },
        guardians: { select: GUARDIAN_PUBLIC_SELECT, orderBy: { createdAt: 'asc' } },
        enrollments: {
          orderBy: { enrolledAt: 'desc' },
          include: { academicYear: true, term: true, program: true, section: true },
        },
        holds: { where: { status: 'ACTIVE' } },
      },
    });
    if (!row) throw new NotFoundException('Student profile not found.');
    return row;
  }

  // ── Attendance ─────────────────────────────────────────────────────────────

  private async attendanceSummary(studentId: string) {
    const grouped = await this.tenantPrisma.client.studentAttendance.groupBy({
      by: ['status'],
      where: { studentId },
      _count: { _all: true },
    });
    const counts: Record<string, number> = { PRESENT: 0, ABSENT: 0, LATE: 0, LEAVE: 0 };
    for (const row of grouped) counts[row.status] = row._count._all;
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
    const presentLike = (counts.PRESENT ?? 0) + (counts.LATE ?? 0);
    return {
      total,
      present: counts.PRESENT ?? 0,
      absent: counts.ABSENT ?? 0,
      late: counts.LATE ?? 0,
      leave: counts.LEAVE ?? 0,
      percentage: total ? Math.round((presentLike / total) * 1000) / 10 : null,
    };
  }

  async getAttendance(
    user: AuthenticatedUser,
    query: ParentPaginationDto & { termId?: string; status?: string; dateFrom?: string; dateTo?: string },
  ) {
    const child = await this.resolveChild(user, query.studentId);
    const where: Prisma.StudentAttendanceWhereInput = { studentId: child.studentId };
    if (query.termId) where.termId = query.termId;
    if (query.status) where.status = query.status as never;
    if (query.dateFrom || query.dateTo) {
      where.date = {};
      if (query.dateFrom) (where.date as Prisma.DateTimeFilter).gte = new Date(query.dateFrom);
      if (query.dateTo) (where.date as Prisma.DateTimeFilter).lte = new Date(query.dateTo);
    }

    const { skip, take } = this.page(query);
    const [rows, total, summary] = await Promise.all([
      this.tenantPrisma.client.studentAttendance.findMany({
        where,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        skip,
        take,
        include: { session: { select: { id: true, title: true, subjectName: true } } },
      }),
      this.tenantPrisma.client.studentAttendance.count({ where }),
      this.attendanceSummary(child.studentId),
    ]);
    return { rows, total, summary };
  }

  // ── Timetable ──────────────────────────────────────────────────────────────

  private async latestTimetable(child: LinkedChild) {
    const entryClauses: Prisma.TimetableEntryWhereInput[] = [];
    if (child.sectionId) entryClauses.push({ sectionId: child.sectionId });
    entryClauses.push({ courseOffering: { registrations: { some: { studentId: child.studentId } } } });

    return this.tenantPrisma.client.timetable.findFirst({
      where: {
        status: 'PUBLISHED',
        ...(child.campusId ? { campusId: child.campusId } : {}),
      },
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
      include: {
        periods: { where: { isActive: true }, orderBy: { sequence: 'asc' } },
        entries: {
          where: { OR: entryClauses },
          include: {
            period: true,
            room: { select: { id: true, name: true, code: true } },
            assignedUser: { select: { id: true, fullName: true } },
            courseOffering: {
              include: {
                course: { select: { id: true, code: true, name: true } },
                faculty: {
                  include: { user: { select: { id: true, fullName: true } } },
                },
              },
            },
          },
          orderBy: [{ dayOfWeek: 'asc' }, { periodId: 'asc' }],
        },
      },
    });
  }

  async getTimetable(user: AuthenticatedUser, studentId?: string) {
    const child = await this.resolveChild(user, studentId);
    const timetable = await this.latestTimetable(child);
    if (!timetable) return { timetable: null, periods: [], entries: [] };
    return { timetable, periods: timetable.periods, entries: timetable.entries };
  }

  private async timetableSummary(child: LinkedChild) {
    const timetable = await this.latestTimetable(child);
    return {
      timetableId: timetable?.id ?? null,
      name: timetable?.name ?? null,
      weeklyClasses: timetable?.entries.length ?? 0,
    };
  }

  // ── Fees & payments ────────────────────────────────────────────────────────

  private feeOutstanding(line: {
    amountCents: number;
    paidCents: number;
    waivedCents: number;
    lateFeeCents: number;
  }): number {
    return Math.max(0, line.amountCents + line.lateFeeCents - line.paidCents - line.waivedCents);
  }

  private async feesSummary(studentId: string) {
    const lines = await this.tenantPrisma.client.studentFee.findMany({
      where: { studentId },
      select: {
        amountCents: true,
        paidCents: true,
        waivedCents: true,
        lateFeeCents: true,
        status: true,
        dueDate: true,
      },
    });
    const outstandingCents = lines.reduce((sum, line) => sum + this.feeOutstanding(line), 0);
    const overdueCount = lines.filter(
      (line) => OPEN_FEE_STATUSES.includes(line.status) && line.dueDate && line.dueDate < new Date(),
    ).length;
    return { totalLines: lines.length, outstandingCents, overdueCount };
  }

  async getFees(user: AuthenticatedUser, studentId?: string) {
    const child = await this.resolveChild(user, studentId);
    const lines = await this.tenantPrisma.client.studentFee.findMany({
      where: { studentId: child.studentId },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
      include: {
        term: { select: { id: true, name: true } },
        demand: { select: { id: true, demandNumber: true, status: true } },
        payments: { select: { id: true, receiptNumber: true, amountCents: true, paymentDate: true } },
      },
    });
    const withOutstanding = lines.map((line) => ({
      ...line,
      outstandingCents: this.feeOutstanding(line),
      isOverdue:
        OPEN_FEE_STATUSES.includes(line.status) && !!line.dueDate && line.dueDate < new Date(),
    }));
    const summary = await this.feesSummary(child.studentId);
    return { lines: withOutstanding, summary };
  }

  async getPayments(user: AuthenticatedUser, studentId?: string) {
    const child = await this.resolveChild(user, studentId);
    const payments = await this.tenantPrisma.client.studentPayment.findMany({
      where: { studentId: child.studentId },
      orderBy: [{ paymentDate: 'desc' }, { createdAt: 'desc' }],
      include: {
        studentFee: { select: { id: true, headName: true, headCode: true } },
        allocations: {
          include: { line: { select: { id: true, headName: true, headCode: true } } },
        },
      },
    });
    return { payments };
  }

  // ── Exams & results ────────────────────────────────────────────────────────

  private async examsSummary(studentId: string) {
    const registrations = await this.tenantPrisma.client.examRegistration.findMany({
      where: { studentId },
      select: { sessionId: true, session: { select: { startDate: true, endDate: true } } },
    });
    const allSubjects = await this.tenantPrisma.client.examSubject.findMany({
      where: { sessionId: { in: registrations.map((r) => r.sessionId) } },
      select: { examDate: true },
    });
    const now = new Date();
    const upcoming = allSubjects
      .map((subject) => subject.examDate)
      .filter((date): date is Date => !!date && date >= now)
      .sort((a, b) => a.getTime() - b.getTime());
    return {
      registeredSessions: registrations.length,
      upcomingPapers: upcoming.length,
      nextExamAt: upcoming[0] ?? null,
    };
  }

  async getExams(user: AuthenticatedUser, studentId?: string) {
    const child = await this.resolveChild(user, studentId);
    const registrations = await this.tenantPrisma.client.examRegistration.findMany({
      where: { studentId: child.studentId },
      orderBy: { registeredAt: 'desc' },
      include: {
        session: {
          include: {
            program: { select: { id: true, name: true } },
            term: { select: { id: true, name: true } },
            academicYear: { select: { id: true, name: true } },
            subjects: {
              orderBy: { examDate: 'asc' },
              include: {
                course: { select: { id: true, code: true, name: true } },
                room: { select: { id: true, name: true } },
              },
            },
          },
        },
        hallTicket: { include: { subjects: true } },
      },
    });
    return { registrations };
  }

  private async resultsSummary(studentId: string) {
    const [publishedResults, publishedProcesses] = await Promise.all([
      this.tenantPrisma.client.studentResult.count({
        where: { studentId, publishedAt: { not: null } },
      }),
      this.tenantPrisma.client.resultProcess.count({
        where: { studentId, state: { in: ['PUBLISHED', 'LOCKED'] } },
      }),
    ]);
    return { publishedSubjects: publishedResults, publishedSessions: publishedProcesses };
  }

  async getResults(user: AuthenticatedUser, studentId?: string) {
    const child = await this.resolveChild(user, studentId);
    const [processes, subjectResults] = await Promise.all([
      this.tenantPrisma.client.resultProcess.findMany({
        where: { studentId: child.studentId, state: { in: ['PUBLISHED', 'LOCKED'] } },
        orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
        include: {
          session: {
            include: {
              program: { select: { id: true, name: true } },
              term: { select: { id: true, name: true } },
            },
          },
        },
      }),
      this.tenantPrisma.client.studentResult.findMany({
        where: { studentId: child.studentId, publishedAt: { not: null } },
        orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
        include: { exam: { select: { id: true, name: true, examType: true } } },
      }),
    ]);
    return { processes, subjectResults, summary: await this.resultsSummary(child.studentId) };
  }

  // ── Notices (per-user notification inbox) ──────────────────────────────────

  private async noticesSummary(userId: string) {
    const [unread, total] = await Promise.all([
      this.notifications.unreadCount(userId),
      this.tenantPrisma.client.notification.count({ where: { recipientUserId: userId } }),
    ]);
    return { unread, total };
  }

  async getNotices(user: AuthenticatedUser, query: { skip?: number; take?: number; unreadOnly?: boolean }) {
    const items = await this.notifications.listInbox(user.id, {
      skip: query.skip,
      take: query.take,
      unreadOnly: query.unreadOnly,
    });
    return { items, summary: await this.noticesSummary(user.id) };
  }

  async markNoticeRead(user: AuthenticatedUser, id: string) {
    const updated = await this.notifications.markInboxItemRead(user.id, id);
    return { notice: updated, summary: await this.noticesSummary(user.id) };
  }

  // ── Documents (read-only: the child's own uploaded documents) ──────────────

  private async documentsSummary(studentId: string) {
    const [uploads, pending] = await Promise.all([
      this.tenantPrisma.client.studentDocument.count({ where: { studentId } }),
      this.tenantPrisma.client.studentDocument.count({ where: { studentId, status: 'PENDING' } }),
    ]);
    return { uploads, pending };
  }

  async getDocuments(
    user: AuthenticatedUser,
    query: { studentId?: string; skip?: number; take?: number; search?: string },
  ) {
    const child = await this.resolveChild(user, query.studentId);
    const where: Prisma.StudentDocumentWhereInput = { studentId: child.studentId };
    if (query.search) {
      where.OR = [
        { documentName: { contains: query.search, mode: 'insensitive' } },
        { category: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const { skip, take } = this.page(query);
    const [studentDocuments, total] = await Promise.all([
      this.tenantPrisma.client.studentDocument.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.tenantPrisma.client.studentDocument.count({ where }),
    ]);
    return { studentDocuments, total, summary: await this.documentsSummary(child.studentId) };
  }

  /** Signed download for one of the child's documents. Ownership is asserted against the resolved
   *  child first, and the storage key is still tenant-prefix-validated by StorageService. */
  async getDocumentDownloadUrl(user: AuthenticatedUser, documentId: string, studentId?: string) {
    const child = await this.resolveChild(user, studentId);
    const document = await this.tenantPrisma.client.studentDocument.findFirst({
      where: { id: documentId, studentId: child.studentId },
      select: { id: true, storageKey: true, originalFilename: true, mimeType: true },
    });
    if (!document) throw new NotFoundException('Document not found.');
    if (!document.storageKey) {
      throw new NotFoundException('This document has no uploaded file yet.');
    }
    const downloadUrl = await this.storage.getDownloadUrl(this.tid(), document.storageKey, {
      filename: document.originalFilename ?? undefined,
      contentType: document.mimeType ?? undefined,
    });
    return { downloadUrl };
  }

  // ── Transport ──────────────────────────────────────────────────────────────

  private async transportSummary(studentId: string) {
    const active = await this.tenantPrisma.client.studentTransportPass.count({
      where: { studentId, status: 'ACTIVE' },
    });
    return { activePasses: active };
  }

  async getTransport(user: AuthenticatedUser, studentId?: string) {
    const child = await this.resolveChild(user, studentId);
    const passes = await this.tenantPrisma.client.studentTransportPass.findMany({
      where: { studentId: child.studentId },
      orderBy: { createdAt: 'desc' },
      include: {
        route: {
          include: {
            stops: { where: { isActive: true }, orderBy: { order: 'asc' } },
            vehicle: { select: { id: true, registrationNumber: true, type: true } },
          },
        },
        stop: { select: { id: true, name: true, pickupTime: true } },
        dropStop: { select: { id: true, name: true, dropTime: true } },
        vehicle: { select: { id: true, registrationNumber: true } },
        driver: { select: { id: true, name: true, phone: true } },
        feeCharges: true,
      },
    });
    return { passes, summary: await this.transportSummary(child.studentId) };
  }

  // ── Hostel (where applicable) ──────────────────────────────────────────────

  private async hostelSummary(studentId: string) {
    const active = await this.tenantPrisma.client.studentHostelBooking.count({
      where: { studentId, status: { in: ['REQUESTED', 'ALLOCATED', 'CHECKED_IN'] } },
    });
    const openComplaints = await this.tenantPrisma.client.hostelComplaint.count({
      where: { studentId, status: { in: ['OPEN', 'IN_PROGRESS'] } },
    });
    return { activeBookings: active, openComplaints };
  }

  async getHostel(user: AuthenticatedUser, studentId?: string) {
    const child = await this.resolveChild(user, studentId);
    const [bookings, complaints] = await Promise.all([
      this.tenantPrisma.client.studentHostelBooking.findMany({
        where: { studentId: child.studentId },
        orderBy: { createdAt: 'desc' },
        include: {
          hostel: { select: { id: true, name: true, code: true } },
          building: { select: { id: true, name: true } },
          floor: { select: { id: true, name: true, floorNumber: true } },
          room: { select: { id: true, code: true, name: true, sharing: true } },
          bed: { select: { id: true, code: true } },
          feeCharges: true,
        },
      }),
      this.tenantPrisma.client.hostelComplaint.findMany({
        where: { studentId: child.studentId },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return { bookings, complaints, summary: await this.hostelSummary(child.studentId) };
  }
}
