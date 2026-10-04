/**
 * Student Portal service — a self-service composition layer over the existing domain modules.
 *
 * It introduces NO new tables and NO parallel business logic:
 *   • profile / attendance / timetable / courses / fees / payments / exams / results /
 *     certificates / library / hostel / transport are read directly through the tenant-guarded
 *     Prisma client, but ALWAYS constrained to the caller's own Student row (resolved from
 *     Student.userId = authenticated user id). A caller with no linked student gets 403.
 *   • writes reuse the owning module's service where one exists and is safe to call with the
 *     caller's own student id: CertificatesService.request (lifecycle + history + audit),
 *     DocumentsService (presigned upload + virus scan + download log),
 *     HelpdeskTicketService (ticketing, SLA, notifications) and FeePaymentsService.record
 *     (receipt numbering + greedy allocation + fee-ledger reconciliation).
 *
 * Feature flags are honoured per section via TenantFeaturesService so a plan that excludes a
 * module never serves that module's data through the portal.
 */
import { randomBytes } from 'crypto';
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { FEATURE_KEYS, type AuthenticatedUser, type FeatureKey } from '@college-erp/auth';
import { Prisma } from '@college-erp/database';
import { AppConfigService } from '../../config/app-config.service';
import { PlatformPrismaService } from '../../common/prisma/platform-prisma.service';
import { TenantContextService } from '../../common/prisma/tenant-context.service';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { TenantFeaturesService } from '../rbac/tenant-features.service';
import { CertificatesService } from '../certificates/certificates.service';
import { AttendanceService } from '../attendance/attendance.service';
import { DocumentsService } from '../documents/documents.service';
import { FeePaymentsService } from '../fees/fee-payments.service';
import type { RecordFeePaymentDto } from '../fees/fees.dto';
import { HelpdeskConfigService } from '../helpdesk/helpdesk-config.service';
import { HelpdeskTicketService } from '../helpdesk/helpdesk-ticket.service';
import type { ListHelpdeskTicketsDto } from '../helpdesk/dto/helpdesk.dto';
import { NotificationsService } from '../notifications/notifications.service';
import {
  AddPortalTicketCommentDto,
  CreateCertificateRequestDto,
  CreatePortalPaymentDto,
  CreatePortalTicketDto,
  PortalDocumentQueryDto,
  PortalPaginationDto,
  PortalUploadUrlDto,
  UpdatePortalProfileDto,
} from './dto/student-portal.dto';

/** Minimal projection of the caller's Student row used throughout the portal. */
interface LinkedStudent {
  id: string;
  tenantId: string;
  userId: string | null;
  campusId: string;
  programId: string | null;
  sectionId: string | null;
  batchId: string | null;
  academicYearId: string | null;
  fullName: string;
  admissionNumber: string;
  rollNumber: string | null;
  status: string;
}

const OPEN_FEE_STATUSES = ['ISSUED', 'OVERDUE', 'PARTIALLY_PAID'];
const EDITED_PROFILE_FIELDS = [
  'email',
  'alternateEmail',
  'primaryPhone',
  'alternatePhone',
  'currentAddressLine1',
  'currentAddressLine2',
  'city',
  'state',
  'postalCode',
  'country',
  'permanentAddressLine1',
  'permanentAddressLine2',
  'permanentCity',
  'permanentState',
  'permanentPostalCode',
  'permanentCountry',
  'profilePhotoKey',
] as const;

@Injectable()
export class StudentPortalService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly tenantFeatures: TenantFeaturesService,
    private readonly certificates: CertificatesService,
    private readonly documents: DocumentsService,
    private readonly feePayments: FeePaymentsService,
    private readonly helpdesk: HelpdeskTicketService,
    private readonly helpdeskConfig: HelpdeskConfigService,
    private readonly notifications: NotificationsService,
    private readonly attendance: AttendanceService,
    private readonly platformPrisma: PlatformPrismaService,
    private readonly config: AppConfigService,
  ) {}

  private tid(): string {
    const tenantId = this.tenantContext.tenantId;
    if (!tenantId) throw new ForbiddenException('Tenant context could not be established.');
    return tenantId;
  }

  /** Resolves the Student row linked to the authenticated user, or 403 when none exists. This is
   *  the single access-control anchor for every portal read/write. */
  async resolveStudent(user: AuthenticatedUser): Promise<LinkedStudent> {
    const student = await this.tenantPrisma.client.student.findFirst({
      where: { userId: user.id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        tenantId: true,
        userId: true,
        campusId: true,
        programId: true,
        sectionId: true,
        batchId: true,
        academicYearId: true,
        fullName: true,
        admissionNumber: true,
        rollNumber: true,
        status: true,
      },
    });
    if (!student) {
      throw new ForbiddenException(
        'Your account is not linked to a student profile. Please contact the registrar.',
      );
    }
    return student as LinkedStudent;
  }

  private page(query: PortalPaginationDto, defaultTake = 50): { skip: number; take: number } {
    const take = Math.min(query.take ?? defaultTake, 200);
    return { skip: query.skip ?? 0, take };
  }

  /** Runs a section query only when the tenant's plan enables the module. */
  private async section<T>(feature: FeatureKey, fn: () => Promise<T>): Promise<T | null> {
    const enabled = await this.tenantFeatures.isEnabled(this.tid(), feature);
    return enabled ? fn() : null;
  }

  // ── Dashboard ───────────────────────────────────────────────────────────────

  async dashboard(user: AuthenticatedUser) {
    const student = await this.resolveStudent(user);
    const [
      attendance,
      timetable,
      courses,
      fees,
      exams,
      results,
      certificates,
      library,
      hostel,
      transport,
      notices,
      tickets,
      documents,
    ] = await Promise.all([
      this.section(FEATURE_KEYS.ATTENDANCE, () => this.attendanceSummary(student.id)),
      this.section(FEATURE_KEYS.TIMETABLE, () => this.timetableSummary(student)),
      this.section(FEATURE_KEYS.ACADEMICS, () => this.coursesSummary(student.id)),
      this.section(FEATURE_KEYS.FEES, () => this.feesSummary(student.id)),
      this.section(FEATURE_KEYS.EXAMS, () => this.examsSummary(student.id)),
      this.section(FEATURE_KEYS.RESULTS, () => this.resultsSummary(student.id)),
      this.section(FEATURE_KEYS.CERTIFICATES, () => this.certificatesSummary(student.id)),
      this.section(FEATURE_KEYS.LIBRARY, () => this.librarySummary(student)),
      this.section(FEATURE_KEYS.HOSTEL, () => this.hostelSummary(student.id)),
      this.section(FEATURE_KEYS.TRANSPORT, () => this.transportSummary(student.id)),
      this.section(FEATURE_KEYS.NOTIFICATIONS, () => this.noticesSummary(user.id)),
      this.section(FEATURE_KEYS.HELPDESK, () => this.ticketsSummary(user.id)),
      this.documentsSummary(student.id, user.id),
    ]);

    return {
      student: {
        id: student.id,
        fullName: student.fullName,
        admissionNumber: student.admissionNumber,
        rollNumber: student.rollNumber,
        status: student.status,
      },
      attendance,
      timetable,
      courses,
      fees,
      exams,
      results,
      certificates,
      library,
      hostel,
      transport,
      notices,
      tickets,
      documents,
      generatedAt: new Date().toISOString(),
    };
  }

  // ── Profile ────────────────────────────────────────────────────────────────

  async getProfile(user: AuthenticatedUser) {
    const student = await this.resolveStudent(user);
    const row = await this.tenantPrisma.client.student.findFirst({
      where: { id: student.id },
      include: {
        campus: { select: { id: true, name: true, code: true } },
        program: { select: { id: true, name: true, code: true } },
        batch: { select: { id: true, name: true } },
        section: { select: { id: true, name: true } },
        academicYear: { select: { id: true, name: true } },
        guardians: { orderBy: { createdAt: 'asc' } },
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

  async updateProfile(user: AuthenticatedUser, dto: UpdatePortalProfileDto) {
    const student = await this.resolveStudent(user);
    const data: Prisma.StudentUpdateInput = { updatedBy: user.id };
    const source = dto as Record<string, unknown>;
    for (const field of EDITED_PROFILE_FIELDS) {
      const value = source[field];
      if (value !== undefined) {
        (data as Record<string, unknown>)[field] = value === null ? null : String(value);
      }
    }
    await this.tenantPrisma.client.student.update({ where: { id: student.id }, data });
    return this.getProfile(user);
  }

  // ── Digital ID card (PWA, QR) ──────────────────────────────────────────────

  /** Returns the student's digital ID card plus a stable, scannable verification URL. The
   *  opaque token is generated lazily on first view and persisted (unique) so a printed card
   *  stays valid across devices/sessions; it can be rotated by clearing id_card_token. */
  async getIdCard(user: AuthenticatedUser) {
    const linked = await this.resolveStudent(user);
    const token = await this.ensureIdCardToken(linked.id);
    const row = await this.tenantPrisma.client.student.findFirst({
      where: { id: linked.id },
      select: {
        id: true,
        fullName: true,
        admissionNumber: true,
        rollNumber: true,
        registrationNumber: true,
        status: true,
        dateOfBirth: true,
        bloodGroup: true,
        profilePhotoKey: true,
        admittedOn: true,
        campus: { select: { id: true, name: true, code: true } },
        program: { select: { id: true, name: true, code: true } },
        section: { select: { id: true, name: true, code: true } },
        batch: { select: { id: true, name: true } },
        academicYear: { select: { id: true, name: true } },
      },
    });
    if (!row) throw new NotFoundException('Student profile not found.');

    const baseUrl = this.config.get('PUBLIC_BASE_URL').replace(/\/+$/, '');
    const verifyUrl = `${baseUrl}/verify/student-id?token=${token}`;
    return {
      student: {
        id: row.id,
        fullName: row.fullName,
        admissionNumber: row.admissionNumber,
        rollNumber: row.rollNumber,
        registrationNumber: row.registrationNumber,
        status: row.status,
        dateOfBirth: row.dateOfBirth,
        bloodGroup: row.bloodGroup,
        hasPhoto: Boolean(row.profilePhotoKey),
        admittedOn: row.admittedOn,
        campus: row.campus,
        program: row.program,
        section: row.section,
        batch: row.batch,
        academicYear: row.academicYear,
      },
      token,
      verifyUrl,
      institutionName: 'College ERP',
    };
  }

  private async ensureIdCardToken(studentId: string): Promise<string> {
    const existing = await this.tenantPrisma.client.student.findFirst({
      where: { id: studentId },
      select: { idCardToken: true },
    });
    if (existing?.idCardToken) return existing.idCardToken;
    // Retry once on the (astronomically unlikely) unique collision.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = randomBytes(24).toString('base64url');
      try {
        await this.tenantPrisma.client.student.update({ where: { id: studentId }, data: { idCardToken: token } });
        return token;
      } catch (error) {
        if (attempt === 1) throw error;
      }
    }
    throw new Error('Failed to generate an ID card token.');
  }

  /** Public verification (no auth): resolves a scanned ID-card token to a minimal, safe
   *  projection. Uses the platform client deliberately — there is no tenant context on the
   *  public route, and the unguessable token itself scopes the single-row lookup. */
  async verifyIdCard(token: string) {
    const student = await this.platformPrisma.client.student.findFirst({
      where: { idCardToken: token, deletedAt: null },
      select: {
        id: true,
        fullName: true,
        admissionNumber: true,
        rollNumber: true,
        status: true,
        profilePhotoKey: true,
        campus: { select: { name: true, code: true } },
        program: { select: { name: true, code: true } },
      },
    });
    if (!student) return { valid: false as const };
    return {
      valid: true as const,
      student: {
        fullName: student.fullName,
        admissionNumber: student.admissionNumber,
        rollNumber: student.rollNumber,
        status: student.status,
        hasPhoto: Boolean(student.profilePhotoKey),
        campus: student.campus,
        program: student.program,
      },
      verifiedAt: new Date().toISOString(),
    };
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

  async getAttendance(user: AuthenticatedUser, query: PortalPaginationDto & { termId?: string; status?: string; dateFrom?: string; dateTo?: string }) {
    const student = await this.resolveStudent(user);
    const where: Prisma.StudentAttendanceWhereInput = { studentId: student.id };
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
      this.attendanceSummary(student.id),
    ]);
    return { rows, total, summary };
  }

  /** QR self check-in: a student scans the check-in code shown by faculty for an OPEN session
   *  and marks themselves PRESENT. Delegates to AttendanceService.selfMarkByToken, which owns
   *  token verification, roster/enrolment checks and the upsert — no business logic is
   *  duplicated here. */
  async checkInAttendance(user: AuthenticatedUser, sessionId: string, token: string) {
    const student = await this.resolveStudent(user);
    return this.attendance.selfMarkByToken(this.tid(), student.id, sessionId, token);
  }

  // ── Timetable ──────────────────────────────────────────────────────────────

  private async latestTimetable(student: LinkedStudent) {
    const entryClauses: Prisma.TimetableEntryWhereInput[] = [];
    if (student.sectionId) entryClauses.push({ sectionId: student.sectionId });
    entryClauses.push({ courseOffering: { registrations: { some: { studentId: student.id } } } });

    return this.tenantPrisma.client.timetable.findFirst({
      where: {
        status: 'PUBLISHED',
        ...(student.campusId ? { campusId: student.campusId } : {}),
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

  async getTimetable(user: AuthenticatedUser) {
    const student = await this.resolveStudent(user);
    const timetable = await this.latestTimetable(student);
    if (!timetable) return { timetable: null, periods: [], entries: [] };
    return { timetable, periods: timetable.periods, entries: timetable.entries };
  }

  private async timetableSummary(student: LinkedStudent) {
    const timetable = await this.latestTimetable(student);
    return {
      timetableId: timetable?.id ?? null,
      name: timetable?.name ?? null,
      weeklyClasses: timetable?.entries.length ?? 0,
    };
  }

  // ── Courses ────────────────────────────────────────────────────────────────

  private async coursesSummary(studentId: string) {
    const active = await this.tenantPrisma.client.courseRegistration.count({
      where: { studentId, status: 'REGISTERED' },
    });
    return { activeRegistrations: active };
  }

  async getCourses(user: AuthenticatedUser) {
    const student = await this.resolveStudent(user);
    const [registrations, enrollments] = await Promise.all([
      this.tenantPrisma.client.courseRegistration.findMany({
        where: { studentId: student.id },
        orderBy: { enrolledAt: 'desc' },
        include: {
          term: { select: { id: true, name: true } },
          courseOffering: {
            include: {
              course: { select: { id: true, code: true, name: true, creditHours: true, courseType: true } },
              faculty: { include: { user: { select: { id: true, fullName: true } } } },
            },
          },
        },
      }),
      this.tenantPrisma.client.studentEnrollment.findMany({
        where: { studentId: student.id },
        orderBy: { enrolledAt: 'desc' },
        include: {
          academicYear: { select: { id: true, name: true } },
          term: { select: { id: true, name: true } },
          program: { select: { id: true, name: true, code: true } },
          section: { select: { id: true, name: true } },
        },
      }),
    ]);
    return { registrations, enrollments };
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

  async getFees(user: AuthenticatedUser) {
    const student = await this.resolveStudent(user);
    const lines = await this.tenantPrisma.client.studentFee.findMany({
      where: { studentId: student.id },
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
    const summary = await this.feesSummary(student.id);
    return { lines: withOutstanding, summary };
  }

  async getPayments(user: AuthenticatedUser) {
    const student = await this.resolveStudent(user);
    const payments = await this.tenantPrisma.client.studentPayment.findMany({
      where: { studentId: student.id },
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

  async createPayment(user: AuthenticatedUser, dto: CreatePortalPaymentDto) {
    const student = await this.resolveStudent(user);
    const payload: RecordFeePaymentDto = {
      studentId: student.id,
      amountCents: dto.amountCents,
      method: dto.method,
      demandId: dto.demandId,
      studentFeeId: dto.studentFeeId,
      referenceNumber: dto.referenceNumber,
      idempotencyKey: dto.idempotencyKey,
      remarks: dto.remarks,
    };
    return this.feePayments.record(this.tid(), user.id, payload);
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

  async getExams(user: AuthenticatedUser) {
    const student = await this.resolveStudent(user);
    const registrations = await this.tenantPrisma.client.examRegistration.findMany({
      where: { studentId: student.id },
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

  async getResults(user: AuthenticatedUser) {
    const student = await this.resolveStudent(user);
    const [processes, subjectResults] = await Promise.all([
      this.tenantPrisma.client.resultProcess.findMany({
        where: { studentId: student.id, state: { in: ['PUBLISHED', 'LOCKED'] } },
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
        where: { studentId: student.id, publishedAt: { not: null } },
        orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
        include: { exam: { select: { id: true, name: true, examType: true } } },
      }),
    ]);
    return { processes, subjectResults, summary: await this.resultsSummary(student.id) };
  }

  // ── Certificates ───────────────────────────────────────────────────────────

  private async certificatesSummary(studentId: string) {
    const [total, pending, issued] = await Promise.all([
      this.tenantPrisma.client.studentCertificate.count({ where: { studentId } }),
      this.tenantPrisma.client.studentCertificate.count({
        where: { studentId, status: { in: ['REQUESTED', 'GENERATED', 'APPROVED'] } },
      }),
      this.tenantPrisma.client.studentCertificate.count({ where: { studentId, status: 'ISSUED' } }),
    ]);
    return { total, pending, issued };
  }

  async getCertificates(user: AuthenticatedUser) {
    const student = await this.resolveStudent(user);
    const certificates = await this.tenantPrisma.client.studentCertificate.findMany({
      where: { studentId: student.id },
      orderBy: { requestDate: 'desc' },
      include: {
        template: { select: { id: true, code: true, name: true } },
        history: { orderBy: { createdAt: 'asc' } },
      },
    });
    return { certificates, summary: await this.certificatesSummary(student.id) };
  }

  async requestCertificate(user: AuthenticatedUser, dto: CreateCertificateRequestDto) {
    const student = await this.resolveStudent(user);
    return this.certificates.request(this.tid(), user.id, {
      studentId: student.id,
      certificateType: dto.certificateType,
      title: dto.title,
      templateId: dto.templateId,
      remarks: dto.remarks,
    });
  }

  async getCertificateDownloadUrl(user: AuthenticatedUser, certificateId: string) {
    const student = await this.resolveStudent(user);
    const owned = await this.tenantPrisma.client.studentCertificate.findFirst({
      where: { id: certificateId, studentId: student.id },
      select: { id: true },
    });
    if (!owned) throw new NotFoundException('Certificate not found.');
    return this.certificates.getDownloadUrl(this.tid(), user.id, certificateId);
  }

  // ── Library ────────────────────────────────────────────────────────────────

  private async librarySummary(student: LinkedStudent) {
    const member = await this.tenantPrisma.client.libraryMember.findFirst({
      where: { studentId: student.id },
      select: { id: true },
    });
    const loanFilter: Prisma.StudentLibraryLoanWhereInput = member
      ? { OR: [{ studentId: student.id }, { memberId: member.id }] }
      : { studentId: student.id };
    const [activeLoans, pendingFines] = await Promise.all([
      this.tenantPrisma.client.studentLibraryLoan.count({
        where: { ...loanFilter, status: { in: ['ISSUED', 'OVERDUE'] } },
      }),
      member
        ? this.tenantPrisma.client.libraryFine.count({
            where: { memberId: member.id, status: 'PENDING' },
          })
        : Promise.resolve(0),
    ]);
    return { activeLoans, pendingFines };
  }

  async getLibrary(user: AuthenticatedUser) {
    const student = await this.resolveStudent(user);
    const member = await this.tenantPrisma.client.libraryMember.findFirst({
      where: { studentId: student.id },
      select: { id: true, memberNumber: true, status: true, maxLoans: true },
    });
    const loanFilter: Prisma.StudentLibraryLoanWhereInput = member
      ? { OR: [{ studentId: student.id }, { memberId: member.id }] }
      : { studentId: student.id };
    const [loans, fines, reservations] = await Promise.all([
      this.tenantPrisma.client.studentLibraryLoan.findMany({
        where: loanFilter,
        orderBy: { borrowedAt: 'desc' },
        include: {
          copy: { include: { book: { select: { id: true, title: true, isbn: true } } } },
        },
      }),
      member
        ? this.tenantPrisma.client.libraryFine.findMany({
            where: { memberId: member.id },
            orderBy: { createdAt: 'desc' },
          })
        : Promise.resolve([]),
      member
        ? this.tenantPrisma.client.libraryReservation.findMany({
            where: { memberId: member.id },
            orderBy: { reservedAt: 'desc' },
            include: { book: { select: { id: true, title: true } } },
          })
        : Promise.resolve([]),
    ]);
    return { member, loans, fines, reservations, summary: await this.librarySummary(student) };
  }

  // ── Hostel ─────────────────────────────────────────────────────────────────

  private async hostelSummary(studentId: string) {
    const active = await this.tenantPrisma.client.studentHostelBooking.count({
      where: { studentId, status: { in: ['REQUESTED', 'ALLOCATED', 'CHECKED_IN'] } },
    });
    const openComplaints = await this.tenantPrisma.client.hostelComplaint.count({
      where: { studentId, status: { in: ['OPEN', 'IN_PROGRESS'] } },
    });
    return { activeBookings: active, openComplaints };
  }

  async getHostel(user: AuthenticatedUser) {
    const student = await this.resolveStudent(user);
    const [bookings, complaints] = await Promise.all([
      this.tenantPrisma.client.studentHostelBooking.findMany({
        where: { studentId: student.id },
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
        where: { studentId: student.id },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return { bookings, complaints, summary: await this.hostelSummary(student.id) };
  }

  // ── Transport ──────────────────────────────────────────────────────────────

  private async transportSummary(studentId: string) {
    const active = await this.tenantPrisma.client.studentTransportPass.count({
      where: { studentId, status: 'ACTIVE' },
    });
    return { activePasses: active };
  }

  async getTransport(user: AuthenticatedUser) {
    const student = await this.resolveStudent(user);
    const passes = await this.tenantPrisma.client.studentTransportPass.findMany({
      where: { studentId: student.id },
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
    return { passes, summary: await this.transportSummary(student.id) };
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

  // ── Support tickets ────────────────────────────────────────────────────────

  private async ticketsSummary(userId: string) {
    const open = await this.tenantPrisma.client.helpdeskTicket.count({
      where: {
        requesterUserId: userId,
        status: { in: ['NEW', 'OPEN', 'IN_PROGRESS', 'PENDING', 'REOPENED'] },
      },
    });
    const total = await this.tenantPrisma.client.helpdeskTicket.count({
      where: { requesterUserId: userId },
    });
    return { open, total };
  }

  async getTickets(user: AuthenticatedUser, query: PortalPaginationDto & { status?: string }) {
    const listQuery: ListHelpdeskTicketsDto = {
      skip: query.skip,
      take: query.take,
      status: query.status,
    };
    const result = await this.helpdesk.listMine(this.tid(), user.id, listQuery);
    return { ...result, summary: await this.ticketsSummary(user.id) };
  }

  async getTicketLookups(user: AuthenticatedUser) {
    await this.resolveStudent(user);
    const [categories, departments] = await Promise.all([
      this.helpdeskConfig.listCategories(this.tid(), {}),
      this.helpdeskConfig.listDepartments(this.tid(), {}),
    ]);
    return { categories, departments };
  }

  async createTicket(user: AuthenticatedUser, dto: CreatePortalTicketDto) {
    await this.resolveStudent(user);
    return this.helpdesk.create(this.tid(), user.id, {
      subject: dto.subject,
      description: dto.description,
      categoryId: dto.categoryId,
      priority: dto.priority,
      attachmentDocumentIds: dto.attachmentDocumentIds,
    });
  }

  private async assertOwnTicket(userId: string, ticketId: string) {
    const ticket = await this.tenantPrisma.client.helpdeskTicket.findFirst({
      where: { id: ticketId, requesterUserId: userId },
      select: { id: true },
    });
    if (!ticket) throw new NotFoundException('Ticket not found.');
    return ticket;
  }

  async getTicket(user: AuthenticatedUser, id: string) {
    await this.assertOwnTicket(user.id, id);
    const [ticket, comments] = await Promise.all([
      this.helpdesk.get(this.tid(), id, { includeInternal: false }),
      this.helpdesk.listComments(this.tid(), id, false),
    ]);
    return { ticket, comments };
  }

  async addTicketComment(user: AuthenticatedUser, id: string, dto: AddPortalTicketCommentDto) {
    await this.assertOwnTicket(user.id, id);
    return this.helpdesk.addComment(this.tid(), user.id, id, { body: dto.body, visibility: 'PUBLIC' });
  }

  async submitTicketFeedback(user: AuthenticatedUser, id: string, dto: { score: number; comment?: string }) {
    await this.assertOwnTicket(user.id, id);
    return this.helpdesk.submitFeedback(this.tid(), user.id, id, dto);
  }

  // ── Documents ──────────────────────────────────────────────────────────────

  private async documentsSummary(studentId: string, userId: string) {
    const [uploads, studentDocs] = await Promise.all([
      this.tenantPrisma.client.document.count({ where: { uploadedBy: userId, deletedAt: null } }),
      this.tenantPrisma.client.studentDocument.count({ where: { studentId } }),
    ]);
    return { uploads, studentDocs };
  }

  async getDocuments(user: AuthenticatedUser, query: PortalDocumentQueryDto) {
    const student = await this.resolveStudent(user);
    const where: Prisma.DocumentWhereInput = { uploadedBy: user.id, deletedAt: null };
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { originalFilename: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const { skip, take } = this.page(query);
    const [documents, studentDocuments, total] = await Promise.all([
      this.tenantPrisma.client.document.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: { documentType: { select: { id: true, code: true, name: true } } },
      }),
      this.tenantPrisma.client.studentDocument.findMany({
        where: { studentId: student.id },
        orderBy: { createdAt: 'desc' },
      }),
      this.tenantPrisma.client.document.count({ where }),
    ]);
    return { documents, studentDocuments, total, summary: await this.documentsSummary(student.id, user.id) };
  }

  async requestDocumentUpload(user: AuthenticatedUser, dto: PortalUploadUrlDto) {
    const student = await this.resolveStudent(user);
    return this.documents.requestUpload(
      this.tid(),
      {
        filename: dto.filename,
        mimeType: dto.mimeType,
        title: dto.title,
        description: dto.description,
        documentTypeId: dto.documentTypeId,
        category: 'student_portal',
        metadata: { studentId: student.id, source: 'STUDENT_PORTAL' },
      },
      user.id,
    );
  }

  async confirmDocumentUpload(user: AuthenticatedUser, id: string, sizeBytes?: number) {
    await this.resolveStudent(user);
    return this.documents.confirmUpload(this.tid(), id, { sizeBytes }, user.id);
  }

  async getDocumentDownloadUrl(user: AuthenticatedUser, id: string) {
    await this.resolveStudent(user);
    const owned = await this.tenantPrisma.client.document.findFirst({
      where: { id, uploadedBy: user.id, deletedAt: null },
      select: { id: true },
    });
    if (!owned) throw new NotFoundException('Document not found.');
    return this.documents.getDownloadUrl(this.tid(), id, user.id, {});
  }
}
