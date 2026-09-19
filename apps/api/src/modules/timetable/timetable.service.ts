/**
 * Timetable service — weekly timetable construction for a term + campus: timetable headers &
 * period grids, manual session entry with a hard conflict gate, greedy conflict-free generation
 * from active course offerings, periodic conflict detection sweeps (materializing
 * TimetableConflict rows), non-teaching holidays, recurring faculty availability blocks,
 * date-specific faculty substitutions, and a per-timetable change log.
 *
 * Everything is tenant-scoped via TenantScopedPrismaService; durable events land in the
 * centralized audit trail (module 'timetable'). Scope grants (timetable.view + friends) are
 * enforced on every read via timetableScopeFilter so a DEPARTMENT-scoped HOD or an OWN-scoped
 * faculty/student can never see beyond their grants. ENTITLEMENTS: none (feature flag only).
 */
 
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type PrismaClient } from '@college-erp/database';
import {
  SubstitutionStatus,
  TimetableConflictType,
  TimetableEntryType,
  TimetableStatus,
} from '@college-erp/database';
import { AUDIT_ACTIONS } from '@college-erp/auth';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { AuditService } from '../audit/audit.service';
import { PermissionsService } from '../rbac/permissions.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CreateAvailabilityDto,
  CreateEntryDto,
  CreateHolidayDto,
  CreateTimetableDto,
  DecideSubstitutionDto,
  GenerateDto,
  ListAvailabilityQueryDto,
  ListEntriesQueryDto,
  ListSubstitutionsQueryDto,
  ListTimetablesQueryDto,
  ReplacePeriodsDto,
  RequestSubstitutionDto,
  UpdateAvailabilityDto,
  UpdateEntryDto,
  UpdateTimetableDto,
  type TimetablePaginationDto,
} from './dto/timetable.dto';
import { isOwnOnly, ownEntryFilter, timetableScopeFilter } from './timetable-scope';
import type { ScopeGrantLike } from '../students/student-scope';

type Client = PrismaClient;

const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5];
const EDITABLE_STATUSES: TimetableStatus[] = ['DRAFT', 'GENERATED'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const ENTRY_INCLUDE = {
  period: { select: { id: true, sequence: true, startTime: true, endTime: true } },
  courseOffering: {
    select: {
      id: true,
      code: true,
      course: { select: { id: true, code: true, name: true, creditHours: true, courseType: true } },
    },
  },
  section: { select: { id: true, code: true, name: true } },
  room: { select: { id: true, code: true, name: true, roomType: true, capacity: true } },
  assignedUser: { select: { id: true, fullName: true, email: true } },
} as const;

const toMinutes = (t: string): number => {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

const timeOverlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string): boolean =>
  toMinutes(aStart) < toMinutes(bEnd) && toMinutes(bStart) < toMinutes(aEnd);

const normalizeDays = (input?: unknown): number[] => {
  if (!Array.isArray(input)) return DEFAULT_WORKING_DAYS;
  const days = input
    .filter((d): d is number => typeof d === 'number')
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  if (days.length === 0) return DEFAULT_WORKING_DAYS;
  return [...new Set(days)].sort((a, b) => a - b);
};

const entryTypeForCourse = (courseType?: string | null): TimetableEntryType => {
  if (courseType === 'LABORATORY') return 'LAB';
  if (courseType === 'INTERNSHIP') return 'OTHER';
  return 'LECTURE';
};

interface ConflictDetail {
  type: string;
  subject: string;
}

@Injectable()
export class TimetableService {
  private readonly logger = new Logger(TimetableService.name);

  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditService: AuditService,
    private readonly permissionsService: PermissionsService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── Shared helpers ────────────────────────────────────────────────────────

  private async campusIdsFor(tenantId: string, grants: ScopeGrantLike[]): Promise<Set<string>> {
    const campusIds = new Set<string>();
    for (const g of grants) {
      if (g.scopeType === 'CAMPUS' && g.campusId) campusIds.add(g.campusId);
    }
    const deptIds = grants
      .filter((g) => g.scopeType === 'DEPARTMENT' && g.departmentId)
      .map((g) => g.departmentId as string);
    const progIds = grants
      .filter((g) => g.scopeType === 'PROGRAM' && g.programId)
      .map((g) => g.programId as string);
    if (deptIds.length > 0) {
      const depts = await (this.tenantPrisma.client as Client).department.findMany({
        where: { tenantId, id: { in: deptIds } },
        select: { campusId: true },
      });
      for (const d of depts) if (d.campusId) campusIds.add(d.campusId);
    }
    if (progIds.length > 0) {
      const programs = await (this.tenantPrisma.client as Client).program.findMany({
        where: { tenantId, id: { in: progIds } },
        select: { department: { select: { campusId: true } } },
      });
      for (const p of programs) if (p.department?.campusId) campusIds.add(p.department.campusId);
    }
    return campusIds;
  }

  private async scope(tenantId: string, userId: string) {
    const grants = await this.permissionsService.getScopeGrantsFor(tenantId, userId, 'timetable.view');
    const campusIds = await this.campusIdsFor(tenantId, grants);
    const result = timetableScopeFilter(grants, userId, campusIds);
    return { grants, ...result };
  }

  private async adminFlag(tenantId: string, userId: string): Promise<boolean> {
    const grants = await this.permissionsService.getScopeGrantsFor(tenantId, userId, 'timetable.view');
    return !isOwnOnly(grants);
  }

  private async audit(
    tenantId: string,
    actorUserId: string,
    action: string,
    entityType: string,
    entityId: string,
    payload: { before?: unknown; after?: unknown },
  ) {
    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action,
      module: 'timetable',
      entityType,
      entityId,
      before: payload.before,
      after: payload.after,
    });
  }

  private page(query: TimetablePaginationDto) {
    return { skip: query.skip ?? 0, take: query.take ?? 100 };
  }

  private async log(tenantId: string, userId: string, timetableId: string, action: string, description: string) {
    await (this.tenantPrisma.client as Client).timetableHistory.create({
      data: { tenantId, timetableId, action, actorId: userId, description },
    });
  }

  private async notifyUser(tenantId: string, userId: string, subject: string, body: string) {
    try {
      await this.notifications.sendSystem(tenantId, { recipientUserId: userId, channel: 'IN_APP', subject, body });
    } catch (error) {
      this.logger.warn(`Failed to notify user ${userId}: ${error instanceof Error ? error.message : error}`);
    }
  }

  private async requireTimetable(tenantId: string, id: string) {
    const timetable = await (this.tenantPrisma.client as Client).timetable.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!timetable) throw new NotFoundException('Timetable not found.');
    return timetable;
  }

  private async requireEditable(timetable: { id: string; status: string }): Promise<void> {
    if (!EDITABLE_STATUSES.includes(timetable.status as TimetableStatus)) {
      throw new BadRequestException('A published or archived timetable cannot be edited.');
    }
  }

  private assertTimeRange(startTime: string, endTime: string): void {
    const valid = TIME_RE.test(startTime) && TIME_RE.test(endTime);
    if (!valid) throw new BadRequestException('Times must be in 24-hour HH:MM format.');
    if (toMinutes(startTime) >= toMinutes(endTime)) {
      throw new BadRequestException('Period end must be after period start.');
    }
  }

  private entryLabel(entry?: { title?: string | null; courseOffering?: { code?: string; course?: { name?: string; code?: string } } | null } | null): string {
    if (!entry) return 'unknown entry';
    if (entry.title) return entry.title;
    if (entry.courseOffering) return `${entry.courseOffering.code ?? entry.courseOffering.course?.code ?? ''} ${entry.courseOffering.course?.name ?? ''}`.trim();
    return 'manual session';
  }

  // ── Timetable header ──────────────────────────────────────────────────────

  async listTimetables(tenantId: string, userId: string, query: ListTimetablesQueryDto) {
    const scope = await this.scope(tenantId, userId);
    const where: Prisma.TimetableWhereInput = {
      tenantId,
      deletedAt: null,
      ...(query.status ? { status: query.status as TimetableStatus } : {}),
      ...(query.termId ? { termId: query.termId } : {}),
      ...(query.campusId ? { campusId: query.campusId } : {}),
      ...(scope.where ?? {}),
    };
    if (query.search) {
      where.AND = [
        {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { code: { contains: query.search, mode: 'insensitive' } },
          ],
        },
      ];
    }
    const [items, total] = await Promise.all([
      (this.tenantPrisma.client as Client).timetable.findMany({
        where,
        ...this.page(query),
        orderBy: [{ createdAt: 'desc' }],
        include: {
          term: { select: { id: true, code: true, name: true, academicYear: { select: { id: true, name: true } } } },
          campus: { select: { id: true, code: true, name: true } },
          _count: { select: { entries: true, periods: true } },
        },
      }),
      (this.tenantPrisma.client as Client).timetable.count({ where }),
    ]);
    return { data: items, total };
  }

  async createTimetable(tenantId: string, userId: string, dto: CreateTimetableDto) {
    const term = await (this.tenantPrisma.client as Client).term.findFirst({
      where: { id: dto.termId, tenantId },
    });
    if (!term) throw new NotFoundException('Term not found.');
    const campus = await (this.tenantPrisma.client as Client).campus.findFirst({
      where: { id: dto.campusId, tenantId },
    });
    if (!campus) throw new NotFoundException('Campus not found.');
    if (dto.code) {
      const existing = await (this.tenantPrisma.client as Client).timetable.findFirst({
        where: { tenantId, code: dto.code },
      });
      if (existing) throw new ConflictException('A timetable with this code already exists.');
    }
    const workingDays = normalizeDays(dto.workingDays);
    const item = await (this.tenantPrisma.client as Client).timetable.create({
      data: {
        tenantId,
        name: dto.name,
        code: dto.code ?? null,
        termId: dto.termId,
        campusId: dto.campusId,
        workingDays,
        createdBy: userId,
        updatedBy: userId,
      },
    });
    await this.log(tenantId, userId, item.id, 'CREATED', `Timetable "${dto.name}" created.`);
    await this.audit(tenantId, userId, AUDIT_ACTIONS.TIMETABLE_CREATED, 'timetable', item.id, {
      after: { name: dto.name, termId: dto.termId, campusId: dto.campusId, workingDays },
    });
    return this.detail(tenantId, userId, item.id);
  }

  async updateTimetable(tenantId: string, userId: string, id: string, dto: UpdateTimetableDto) {
    const timetable = await this.requireTimetable(tenantId, id);
    if (dto.code) {
      const existing = await (this.tenantPrisma.client as Client).timetable.findFirst({
        where: { tenantId, code: dto.code, id: { not: id } },
      });
      if (existing) throw new ConflictException('A timetable with this code already exists.');
    }
    const data: Prisma.TimetableUpdateInput = { updatedBy: userId };
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.code !== undefined) data.code = dto.code;
    if (dto.workingDays !== undefined) data.workingDays = normalizeDays(dto.workingDays);
    await (this.tenantPrisma.client as Client).timetable.update({ where: { id }, data });
    await this.log(tenantId, userId, id, 'UPDATED', 'Timetable header updated.');
    await this.audit(tenantId, userId, AUDIT_ACTIONS.TIMETABLE_UPDATED, 'timetable', id, {
      before: { name: timetable.name, code: timetable.code, workingDays: timetable.workingDays },
      after: { name: data.name ?? timetable.name, code: data.code ?? timetable.code, workingDays: data.workingDays ?? timetable.workingDays },
    });
    return this.detail(tenantId, userId, id);
  }

  async detail(tenantId: string, userId: string, id: string) {
    const scope = await this.scope(tenantId, userId);
    const timetable = await (this.tenantPrisma.client as Client).timetable.findFirst({
      where: { id, tenantId, deletedAt: null, ...(scope.where ?? {}) },
      include: {
        term: { select: { id: true, code: true, name: true, academicYear: { select: { id: true, name: true } } } },
        campus: { select: { id: true, code: true, name: true } },
        publishedBy: { select: { id: true, fullName: true, email: true } },
        periods: { orderBy: { sequence: 'asc' } },
      },
    });
    if (!timetable) throw new NotFoundException('Timetable not found.');
    const [entryCount, holidayCount, substitutionCount, unresolvedConflictCount] = await Promise.all([
      (this.tenantPrisma.client as Client).timetableEntry.count({ where: { tenantId, timetableId: id } }),
      (this.tenantPrisma.client as Client).timetableHoliday.count({ where: { tenantId, timetableId: id } }),
      (this.tenantPrisma.client as Client).timetableSubstitution.count({ where: { tenantId, timetableId: id } }),
      (this.tenantPrisma.client as Client).timetableConflict.count({
        where: { tenantId, timetableId: id, resolvedAt: null },
      }),
    ]);
    return { ...timetable, entryCount, holidayCount, substitutionCount, unresolvedConflictCount };
  }

  // ── Generation / publish / archive ────────────────────────────────────────

  async generate(tenantId: string, userId: string, id: string, dto?: GenerateDto) {
    const timetable = await this.requireTimetable(tenantId, id);
    await this.requireEditable(timetable);
    const days = normalizeDays(timetable.workingDays);
    const periods = await (this.tenantPrisma.client as Client).timetablePeriod.findMany({
      where: { tenantId, timetableId: id },
      orderBy: { sequence: 'asc' },
    });
    if (periods.length === 0) throw new BadRequestException('Add a period grid before generating the timetable.');
    const usablePeriods = periods.filter((p) => p.isActive && !p.isBreak);
    if (usablePeriods.length === 0) throw new BadRequestException('The period grid has no active teaching periods.');

    const offerings = await (this.tenantPrisma.client as Client).courseOffering.findMany({
      where: {
        tenantId,
        termId: timetable.termId,
        campusId: timetable.campusId,
        status: 'ACTIVE',
        deletedAt: null,
        ...(dto?.offeringIds && dto.offeringIds.length > 0 ? { id: { in: dto.offeringIds } } : {}),
      },
      include: {
        course: { select: { id: true, code: true, name: true, creditHours: true, courseType: true } },
        section: { select: { id: true, code: true, name: true, capacity: true } },
        faculty: { where: { role: 'PRIMARY', isActive: true }, select: { userId: true } },
      },
    });

    const rooms = await (this.tenantPrisma.client as Client).room.findMany({
      where: { tenantId, campusId: timetable.campusId, isActive: true, deletedAt: null },
      orderBy: { capacity: 'desc' },
    });
    const facultyIds = [...new Set(offerings.flatMap((o) => o.faculty.map((f) => f.userId)))];
    const blocks = facultyIds.length
      ? await (this.tenantPrisma.client as Client).facultyAvailability.findMany({
          where: { tenantId, userId: { in: facultyIds }, isActive: true },
        })
      : [];

    const slotFree = (
      occ: Map<string, Set<string>>,
      key: string,
      slot: string,
    ): boolean => !(occ.get(key)?.has(slot) ?? false);
    const book = (occ: Map<string, Set<string>>, key: string, slot: string) => {
      const set = occ.get(key) ?? new Set<string>();
      set.add(slot);
      occ.set(key, set);
    };
    const blockedFor = (userId: string, day: number, startTime: string, endTime: string): boolean =>
      blocks.some(
        (b) =>
          b.userId === userId &&
          b.isBlocked &&
          b.dayOfWeek === day &&
          (b.termId == null || b.termId === timetable.termId) &&
          (b.campusId == null || b.campusId === timetable.campusId) &&
          timeOverlaps(b.startTime, b.endTime, startTime, endTime),
      );

    const roomOcc = new Map<string, Set<string>>();
    const facultyOcc = new Map<string, Set<string>>();
    const sectionOcc = new Map<string, Set<string>>();

    interface Candidate {
      offeringId: string;
      code: string;
      title: string;
      sectionKey: string;
      sectionId: string | null;
      assignedUserId: string | null;
      roomTypes: string[];
      sessions: number;
      entryType: TimetableEntryType;
    }

    const candidates: Candidate[] = [];
    for (const o of offerings) {
      const credits = o.creditHours ?? o.course.creditHours ?? 1;
      const entryType = entryTypeForCourse(o.course.courseType);
      candidates.push({
        offeringId: o.id,
        code: o.code,
        title: `${o.code} · ${o.course.name}`,
        sectionKey: o.sectionId ?? `offering:${o.id}`,
        sectionId: o.sectionId ?? null,
        assignedUserId: o.faculty[0]?.userId ?? null,
        roomTypes: entryType === 'LAB' ? ['LABORATORY'] : ['CLASSROOM', 'SEMINAR_HALL'],
        sessions: Math.max(1, credits),
        entryType,
      });
    }

    const placed: { offeringId: string; courseCode: string; sessions: number }[] = [];
    const unplaced: { offeringId: string; courseCode: string; sessions: number; reason: string }[] = [];
    const rows: Prisma.TimetableEntryCreateManyInput[] = [];

    for (const candidate of candidates) {
      let left = candidate.sessions;
      for (const day of days) {
        if (left === 0) break;
        for (let i = 0; i < usablePeriods.length && left > 0; i++) {
          const period = usablePeriods[i];
          if (!period) continue;
          const slot = `${day}:${period.id}`;
          if (candidate.assignedUserId && blockedFor(candidate.assignedUserId, day, period.startTime, period.endTime)) continue;
          if (candidate.assignedUserId && !slotFree(facultyOcc, candidate.assignedUserId, slot)) continue;
          if (!slotFree(sectionOcc, candidate.sectionKey, slot)) continue;

          const candidatesByType = rooms.filter((r) => candidate.roomTypes.includes(r.roomType));
          const room = candidatesByType.find((r) => slotFree(roomOcc, r.id, slot));
          if (!room) continue;

          book(roomOcc, room.id, slot);
          if (candidate.assignedUserId) book(facultyOcc, candidate.assignedUserId, slot);
          book(sectionOcc, candidate.sectionKey, slot);
          rows.push({
            tenantId,
            timetableId: id,
            periodId: period.id,
            dayOfWeek: day,
            courseOfferingId: candidate.offeringId,
            sectionId: candidate.sectionId,
            assignedUserId: candidate.assignedUserId,
            roomId: room.id,
            entryType: candidate.entryType,
            createdBy: userId,
            updatedBy: userId,
          });
          left -= 1;
        }
      }
      if (left === 0) {
        placed.push({ offeringId: candidate.offeringId, courseCode: candidate.code, sessions: candidate.sessions });
      } else {
        unplaced.push({
          offeringId: candidate.offeringId,
          courseCode: candidate.code,
          sessions: left,
          reason: 'No conflict-free slot available.',
        });
      }
    }

    await (this.tenantPrisma.client as Client).timetableEntry.deleteMany({ where: { tenantId, timetableId: id } });
    if (rows.length > 0) {
      await (this.tenantPrisma.client as Client).timetableEntry.createMany({ data: rows });
    }
    await (this.tenantPrisma.client as Client).timetable.update({
      where: { id },
      data: { status: TimetableStatus.GENERATED, generatedAt: new Date(), updatedBy: userId },
    });
    const description = `Generated ${rows.length} sessions (${unplaced.length} offering(s) unplaced).`;
    await this.log(tenantId, userId, id, 'GENERATED', description);
    await this.audit(tenantId, userId, AUDIT_ACTIONS.TIMETABLE_GENERATED, 'timetable', id, {
      after: { placed: rows.length, unplaced: unplaced.length, unplacedDetail: unplaced },
    });
    return { placed: rows.length, generated: rows.length, failed: unplaced, total: candidates.length };
  }

  async publish(tenantId: string, userId: string, id: string) {
    const timetable = await this.requireTimetable(tenantId, id);
    if (timetable.status === 'ARCHIVED') throw new BadRequestException('An archived timetable cannot be published.');
    const entries = await (this.tenantPrisma.client as Client).timetableEntry.findMany({
      where: { tenantId, timetableId: id },
      select: { assignedUserId: true },
    });
    if (entries.length === 0) throw new BadRequestException('Nothing to publish — add a period grid and generate entries first.');
    await (this.tenantPrisma.client as Client).timetable.update({
      where: { id },
      data: { status: TimetableStatus.PUBLISHED, publishedAt: new Date(), publishedById: userId, updatedBy: userId },
    });
    const faculty = [...new Set(entries.map((e) => e.assignedUserId).filter((uid): uid is string => Boolean(uid)))];
    for (const uid of faculty) {
      await this.notifyUser(
        tenantId,
        uid,
        'Timetable published',
        `The timetable "${timetable.name}" has been published — check your classes.`,
      );
    }
    await this.log(tenantId, userId, id, 'PUBLISHED', `Timetable published (${entries.length} sessions).`);
    await this.audit(tenantId, userId, AUDIT_ACTIONS.TIMETABLE_PUBLISHED, 'timetable', id, {
      after: { sessions: entries.length },
    });
    return this.detail(tenantId, userId, id);
  }

  async archive(tenantId: string, userId: string, id: string) {
    const timetable = await this.requireTimetable(tenantId, id);
    if (timetable.status === 'ARCHIVED') throw new BadRequestException('This timetable is already archived.');
    await (this.tenantPrisma.client as Client).timetable.update({
      where: { id },
      data: { status: TimetableStatus.ARCHIVED, updatedBy: userId },
    });
    await this.log(tenantId, userId, id, 'ARCHIVED', 'Timetable archived.');
    await this.audit(tenantId, userId, AUDIT_ACTIONS.TIMETABLE_ARCHIVED, 'timetable', id, {
      before: { status: timetable.status },
      after: { status: 'ARCHIVED' },
    });
    return this.detail(tenantId, userId, id);
  }

  // ── Period grid ───────────────────────────────────────────────────────────

  async replacePeriods(tenantId: string, userId: string, id: string, dto: ReplacePeriodsDto) {
    const timetable = await this.requireTimetable(tenantId, id);
    await this.requireEditable(timetable);
    const sequences = dto.periods.map((p) => p.sequence);
    if (new Set(sequences).size !== sequences.length) {
      throw new BadRequestException('Period sequences must be unique.');
    }
    const teaching = dto.periods.filter((p) => !(p.isBreak ?? false) && (p.isActive ?? true));
    if (teaching.length === 0) throw new BadRequestException('At least one active teaching period is required.');
    for (const p of dto.periods) this.assertTimeRange(p.startTime, p.endTime);
    const days = normalizeDays(timetable.workingDays);
    if (days.length === 0) throw new BadRequestException('Configure working days before building the period grid.');

    // The grid is the backbone of the weekly model — rebuilding it wipes assigned sessions
    // (entries reference periods with ON DELETE RESTRICT, so clearing them explicitly keeps the
    // replace atomic and conflict-free).
    await (this.tenantPrisma.client as Client).timetableEntry.deleteMany({ where: { tenantId, timetableId: id } });
    await (this.tenantPrisma.client as Client).timetablePeriod.deleteMany({ where: { tenantId, timetableId: id } });
    await (this.tenantPrisma.client as Client).timetablePeriod.createMany({
      data: dto.periods.map((p) => ({
        tenantId,
        timetableId: id,
        sequence: p.sequence,
        startTime: p.startTime,
        endTime: p.endTime,
        isBreak: p.isBreak ?? false,
        isActive: p.isActive ?? true,
        createdBy: userId,
      })),
    });
    const description = `Period grid replaced with ${dto.periods.length} slot(s); existing sessions were cleared.`;
    await this.log(tenantId, userId, id, 'PERIODS_UPDATED', description);
    await this.audit(tenantId, userId, AUDIT_ACTIONS.TIMETABLE_PERIODS_UPDATED, 'timetable', id, {
      after: { periods: dto.periods },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.TIMETABLE_ENTRY_DELETED, 'timetable', id, {
      after: { note: 'Sessions cleared by grid rebuild' },
    });
    return this.detail(tenantId, userId, id);
  }

  async listPeriods(tenantId: string, userId: string, id: string) {
    await this.requireTimetableScoped(tenantId, userId, id);
    const items = await (this.tenantPrisma.client as Client).timetablePeriod.findMany({
      where: { tenantId, timetableId: id },
      orderBy: { sequence: 'asc' },
    });
    return { data: items, total: items.length };
  }

  // ── Entries ───────────────────────────────────────────────────────────────

  private async requireTimetableScoped(tenantId: string, userId: string, id: string) {
    const scope = await this.scope(tenantId, userId);
    const timetable = await (this.tenantPrisma.client as Client).timetable.findFirst({
      where: { id, tenantId, deletedAt: null, ...(scope.where ?? {}) },
    });
    if (!timetable) throw new NotFoundException('Timetable not found.');
    return { timetable, own: scope.own };
  }

  private async resolveEntryFields(
    tenantId: string,
    timetableId: string,
    dto: CreateEntryDto | UpdateEntryDto,
  ): Promise<Prisma.TimetableEntryCreateInput> {
    const base: Prisma.TimetableEntryCreateInput = {} as Prisma.TimetableEntryCreateInput;
    let sectionId: string | undefined | null = dto.sectionId;
    let assignedUserId: string | undefined | null = dto.assignedUserId;
    let entryType: TimetableEntryType = (dto.entryType as TimetableEntryType | undefined) ?? 'LECTURE';
    let title: string | undefined = dto.title;

    if (dto.courseOfferingId) {
      const offering = await (this.tenantPrisma.client as Client).courseOffering.findFirst({
        where: { tenantId, id: dto.courseOfferingId },
        include: {
          course: { select: { id: true, code: true, name: true, courseType: true } },
          faculty: { where: { role: 'PRIMARY', isActive: true }, select: { userId: true } },
        },
      });
      if (!offering) throw new NotFoundException('Course offering not found.');
      if (offering.termId !== (await this.termOfTimetable(tenantId, timetableId))) {
        throw new BadRequestException('This offering is not part of the timetable\'s term.');
      }
      base.courseOffering = { connect: { id: offering.id } };
      sectionId = dto.sectionId ?? offering.sectionId ?? null;
      if (dto.assignedUserId === undefined) {
        assignedUserId = offering.faculty[0]?.userId ?? null;
      }
      if (!dto.entryType) entryType = entryTypeForCourse(offering.course.courseType);
      title = dto.title ?? `${offering.course.code ?? offering.id.slice(0, 8)}`;
    }

    if (assignedUserId) {
      const user = await (this.tenantPrisma.client as Client).user.findFirst({
        where: { tenantId, id: assignedUserId },
        select: { id: true },
      });
      if (!user) throw new NotFoundException('Faculty user not found.');
      base.assignedUser = { connect: { id: assignedUserId } };
    }
    if (sectionId) {
      const section = await (this.tenantPrisma.client as Client).section.findFirst({
        where: { tenantId, id: sectionId },
        select: { id: true },
      });
      if (!section) throw new NotFoundException('Section not found.');
      base.section = { connect: { id: sectionId } };
    }
    if (dto.roomId) {
      const room = await (this.tenantPrisma.client as Client).room.findFirst({
        where: { tenantId, id: dto.roomId },
        select: { id: true, campusId: true },
      });
      if (!room) throw new NotFoundException('Room not found.');
      const timetable = await (this.tenantPrisma.client as Client).timetable.findFirst({
        where: { tenantId, id: timetableId, deletedAt: null },
        select: { campusId: true },
      });
      if (!timetable || room.campusId !== timetable.campusId) {
        throw new BadRequestException('Room does not belong to this timetable\'s campus.');
      }
      base.room = { connect: { id: dto.roomId } };
    }
    base.entryType = entryType;
    if (title !== undefined) base.title = title;
    if (dto.notes !== undefined) base.notes = dto.notes;
    return base;
  }

  private async termOfTimetable(tenantId: string, timetableId: string): Promise<string> {
    const timetable = await (this.tenantPrisma.client as Client).timetable.findFirst({
      where: { tenantId, id: timetableId, deletedAt: null },
      select: { termId: true },
    });
    if (!timetable) throw new NotFoundException('Timetable not found.');
    return timetable.termId;
  }

  private async conflictGate(
    tenantId: string,
    timetableId: string,
    periodId: string,
    dayOfWeek: number,
    actorUserId: string,
    options: { roomId?: string | null; assignedUserId?: string | null; sectionId?: string | null },
    period: { sequence: number; startTime: string; endTime: string },
    excludeEntryId?: string,
  ) {
    const ors: Prisma.TimetableEntryWhereInput[] = [];
    if (options.roomId) ors.push({ roomId: options.roomId });
    if (options.assignedUserId) ors.push({ assignedUserId: options.assignedUserId });
    if (options.sectionId) ors.push({ sectionId: options.sectionId });
    if (ors.length === 0) return;

    const existing = await (this.tenantPrisma.client as Client).timetableEntry.findMany({
      where: {
        tenantId,
        timetableId,
        periodId,
        dayOfWeek,
        ...(excludeEntryId ? { id: { not: excludeEntryId } } : {}),
        OR: ors,
      },
      include: {
        courseOffering: { select: { id: true, code: true, course: { select: { name: true } } } },
        assignedUser: { select: { id: true, fullName: true } },
        section: { select: { id: true, code: true, name: true } },
      },
    });
    if (existing.length === 0) return;

    const conflicts: ConflictDetail[] = [];
    const writeConflict = (type: TimetableConflictType, entryBId: string, description: string) => {
      void (this.tenantPrisma.client as Client).timetableConflict
        .create({
          data: {
            tenantId,
            timetableId,
            conflictType: type,
            dayOfWeek,
            periodId,
            entryBId,
            description,
            source: 'write',
            createdBy: actorUserId,
          },
        })
        .catch(() => undefined);
    };
    for (const e of existing) {
      const label = this.entryLabel(e);
      if (options.roomId && e.roomId === options.roomId) {
        conflicts.push({ type: 'ROOM', subject: `Room is already booked for ${label} at this slot` });
        writeConflict('ROOM', e.id, `Room is already booked for ${label} at this slot.`);
      }
      if (options.assignedUserId && e.assignedUserId === options.assignedUserId) {
        conflicts.push({ type: 'FACULTY', subject: `Faculty is already teaching ${label} at this slot` });
        writeConflict('FACULTY', e.id, `Faculty is already teaching ${label} at this slot.`);
      }
      if (options.sectionId && e.sectionId === options.sectionId) {
        conflicts.push({ type: 'SECTION', subject: `Section already has ${label} at this slot` });
        writeConflict('SECTION', e.id, `Section already has ${label} at this slot.`);
      }
    }
    throw new ConflictException(`Scheduling conflict: ${conflicts.map((c) => c.subject).join('; ')}`);
  }

  async listEntries(tenantId: string, userId: string, id: string, query: ListEntriesQueryDto) {
    const { own } = await this.requireTimetableScoped(tenantId, userId, id);
    const where: Prisma.TimetableEntryWhereInput = {
      tenantId,
      timetableId: id,
      ...(query.dayOfWeek !== undefined ? { dayOfWeek: query.dayOfWeek } : {}),
      ...(query.periodId ? { periodId: query.periodId } : {}),
      ...(query.sectionId ? { sectionId: query.sectionId } : {}),
      ...(query.facultyId ? { assignedUserId: query.facultyId } : {}),
      ...(query.roomId ? { roomId: query.roomId } : {}),
      ...(own ? ownEntryFilter(userId) : {}),
    };
    const [items, total] = await Promise.all([
      (this.tenantPrisma.client as Client).timetableEntry.findMany({
        where,
        ...this.page(query),
        include: ENTRY_INCLUDE,
        orderBy: [{ dayOfWeek: 'asc' }, { period: { sequence: 'asc' } }],
      }),
      (this.tenantPrisma.client as Client).timetableEntry.count({ where }),
    ]);
    return { data: items, total };
  }

  async createEntry(tenantId: string, userId: string, id: string, dto: CreateEntryDto) {
    const timetable = await this.requireTimetable(tenantId, id);
    await this.requireEditable(timetable);
    const days = normalizeDays(timetable.workingDays);
    if (!days.includes(dto.dayOfWeek)) {
      throw new BadRequestException('Day is not a working day on this timetable.');
    }
    const period = await (this.tenantPrisma.client as Client).timetablePeriod.findFirst({
      where: { tenantId, timetableId: id, id: dto.periodId },
    });
    if (!period) throw new BadRequestException('Period does not belong to this timetable.');

    const fields = await this.resolveEntryFields(tenantId, id, dto);
    const sectionId = dto.sectionId ?? null;
    const assignedUserId = dto.assignedUserId ?? fields.assignedUser?.connect?.id ?? null;
    const roomId = dto.roomId ?? fields.room?.connect?.id ?? null;

    if (assignedUserId) {
      const blocked = await this.isBlocked(tenantId, assignedUserId, timetable, period, dto.dayOfWeek);
      if (blocked) throw new ConflictException('Faculty is not available at this slot (availability block).');
    }

    await this.conflictGate(tenantId, id, dto.periodId, dto.dayOfWeek, userId, { roomId, assignedUserId, sectionId }, period);

    const entry = await (this.tenantPrisma.client as Client).timetableEntry.create({
      data: {
        ...fields,
        tenantId,
        timetable: { connect: { id } },
        period: { connect: { id: period.id } },
        dayOfWeek: dto.dayOfWeek,
        createdBy: userId,
        updatedBy: userId,
      } as Prisma.TimetableEntryCreateInput,
      include: ENTRY_INCLUDE,
    });
    await this.log(
      tenantId,
      userId,
      id,
      'ENTRY_CREATED',
      `Session added at period ${period.sequence} on day ${dto.dayOfWeek}: ${this.entryLabel(entry)}.`,
    );
    await this.audit(tenantId, userId, AUDIT_ACTIONS.TIMETABLE_ENTRY_CREATED, 'timetable_entry', entry.id, {
      after: { timetableId: id, periodId: period.id, dayOfWeek: dto.dayOfWeek, entryType: entry.entryType },
    });
    return entry;
  }

  private async isBlocked(
    tenantId: string,
    userId: string,
    timetable: { termId: string; campusId: string },
    period: { startTime: string; endTime: string },
    dayOfWeek: number,
  ): Promise<boolean> {
    const blocks = await (this.tenantPrisma.client as Client).facultyAvailability.findMany({
      where: { tenantId, userId, isActive: true, isBlocked: true },
    });
    return blocks.some(
      (b) =>
        b.dayOfWeek === dayOfWeek &&
        (b.termId == null || b.termId === timetable.termId) &&
        (b.campusId == null || b.campusId === timetable.campusId) &&
        timeOverlaps(b.startTime, b.endTime, period.startTime, period.endTime),
    );
  }

  async updateEntry(tenantId: string, userId: string, id: string, entryId: string, dto: UpdateEntryDto) {
    const timetable = await this.requireTimetable(tenantId, id);
    await this.requireEditable(timetable);
    const entry = await (this.tenantPrisma.client as Client).timetableEntry.findFirst({
      where: { tenantId, timetableId: id, id: entryId },
    });
    if (!entry) throw new NotFoundException('Timetable entry not found.');

    const newDay = dto.dayOfWeek ?? entry.dayOfWeek;
    const days = normalizeDays(timetable.workingDays);
    if (!days.includes(newDay)) throw new BadRequestException('Day is not a working day on this timetable.');

    const newPeriodId = dto.periodId ?? entry.periodId;
    const period = await (this.tenantPrisma.client as Client).timetablePeriod.findFirst({
      where: { tenantId, timetableId: id, id: newPeriodId },
    });
    if (!period) throw new BadRequestException('Period does not belong to this timetable.');

    const fields = await this.resolveEntryFields(tenantId, id, dto);
    const roomId = dto.roomId ?? entry.roomId ?? fields.room?.connect?.id ?? null;
    const assignedUserId =
      dto.assignedUserId ?? entry.assignedUserId ?? fields.assignedUser?.connect?.id ?? null;
    const sectionId = dto.sectionId ?? entry.sectionId ?? fields.section?.connect?.id ?? null;

    if (assignedUserId) {
      const blocked = await this.isBlocked(tenantId, assignedUserId, timetable, period, newDay);
      if (blocked) throw new ConflictException('Faculty is not available at this slot (availability block).');
    }
    await this.conflictGate(tenantId, id, newPeriodId, newDay, userId, { roomId, assignedUserId, sectionId }, period, entryId);

    const data: Prisma.TimetableEntryUpdateInput = {
      ...fields,
      dayOfWeek: newDay,
      period: { connect: { id: newPeriodId } },
      updatedBy: userId,
    };
    const updated = await (this.tenantPrisma.client as Client).timetableEntry.update({
      where: { id: entryId },
      data,
      include: ENTRY_INCLUDE,
    });
    await this.log(
      tenantId,
      userId,
      id,
      'ENTRY_UPDATED',
      `Session moved to period ${period.sequence} on day ${newDay}: ${this.entryLabel(updated)}.`,
    );
    await this.audit(tenantId, userId, AUDIT_ACTIONS.TIMETABLE_ENTRY_UPDATED, 'timetable_entry', entryId, {
      before: { periodId: entry.periodId, dayOfWeek: entry.dayOfWeek },
      after: { periodId: newPeriodId, dayOfWeek: newDay },
    });
    return updated;
  }

  async deleteEntry(tenantId: string, userId: string, id: string, entryId: string) {
    const timetable = await this.requireTimetable(tenantId, id);
    await this.requireEditable(timetable);
    const entry = await (this.tenantPrisma.client as Client).timetableEntry.findFirst({
      where: { tenantId, timetableId: id, id: entryId },
      include: ENTRY_INCLUDE,
    });
    if (!entry) throw new NotFoundException('Timetable entry not found.');
    await (this.tenantPrisma.client as Client).timetableEntry.delete({ where: { id: entryId } });
    await this.log(tenantId, userId, id, 'ENTRY_DELETED', `Session removed: ${this.entryLabel(entry)}.`);
    await this.audit(tenantId, userId, AUDIT_ACTIONS.TIMETABLE_ENTRY_DELETED, 'timetable_entry', entryId, {
      after: { timetableId: id },
    });
    return { ok: true };
  }

  // ── Holidays ──────────────────────────────────────────────────────────────

  async listHolidays(tenantId: string, userId: string, id: string) {
    await this.requireTimetableScoped(tenantId, userId, id);
    const items = await (this.tenantPrisma.client as Client).timetableHoliday.findMany({
      where: { tenantId, timetableId: id },
      orderBy: { date: 'asc' },
    });
    return { data: items, total: items.length };
  }

  async createHoliday(tenantId: string, userId: string, id: string, dto: CreateHolidayDto) {
    const timetable = await this.requireTimetable(tenantId, id);
    await this.requireEditable(timetable);
    const date = new Date(`${dto.date}T00:00:00.000Z`);
    const existing = await (this.tenantPrisma.client as Client).timetableHoliday.findFirst({
      where: { tenantId, timetableId: id, date },
    });
    if (existing) throw new ConflictException('A holiday already exists on this date.');
    const holiday = await (this.tenantPrisma.client as Client).timetableHoliday.create({
      data: { tenantId, timetableId: id, date, name: dto.name, description: dto.description ?? null, createdBy: userId },
    });
    await this.log(tenantId, userId, id, 'HOLIDAY_CREATED', `Holiday "${dto.name}" on ${dto.date}.`);
    await this.audit(tenantId, userId, AUDIT_ACTIONS.TIMETABLE_HOLIDAY_CREATED, 'timetable_holiday', holiday.id, {
      after: { timetableId: id, date: dto.date, name: dto.name },
    });
    return holiday;
  }

  async deleteHoliday(tenantId: string, userId: string, id: string, holidayId: string) {
    const timetable = await this.requireTimetable(tenantId, id);
    await this.requireEditable(timetable);
    const holiday = await (this.tenantPrisma.client as Client).timetableHoliday.findFirst({
      where: { tenantId, timetableId: id, id: holidayId },
    });
    if (!holiday) throw new NotFoundException('Holiday not found.');
    await (this.tenantPrisma.client as Client).timetableHoliday.delete({ where: { id: holidayId } });
    await this.log(tenantId, userId, id, 'HOLIDAY_DELETED', `Holiday "${holiday.name}" removed.`);
    await this.audit(tenantId, userId, AUDIT_ACTIONS.TIMETABLE_HOLIDAY_DELETED, 'timetable_holiday', holidayId, {
      before: { timetableId: id, date: holiday.date, name: holiday.name },
    });
    return { ok: true };
  }

  // ── Conflicts ------------------------------------------------------------------------------------------
  // ── Faculty availability ──────────────────────────────────────────────────

  async listAvailability(tenantId: string, userId: string, query: ListAvailabilityQueryDto) {
    const admin = await this.adminFlag(tenantId, userId);
    const where: Prisma.FacultyAvailabilityWhereInput = {
      tenantId,
      isActive: true,
      ...(query.termId ? { termId: query.termId } : {}),
      ...(query.campusId ? { campusId: query.campusId } : {}),
      ...(query.dayOfWeek !== undefined ? { dayOfWeek: query.dayOfWeek } : {}),
      ...(admin ? (query.userId ? { userId: query.userId } : {}) : { userId }),
    };
    const items = await (this.tenantPrisma.client as Client).facultyAvailability.findMany({
      where,
      orderBy: [{ userId: 'asc' }, { dayOfWeek: 'asc' }, { startTime: 'asc' }],
      include: { user: { select: { id: true, fullName: true, email: true } } },
      take: 500,
    });
    return { data: items, total: items.length };
  }

  async createAvailability(tenantId: string, userId: string, dto: CreateAvailabilityDto) {
    const admin = await this.adminFlag(tenantId, userId);
    const targetUserId = admin ? (dto.userId ?? userId) : userId;
    this.assertTimeRange(dto.startTime, dto.endTime);
    const user = await (this.tenantPrisma.client as Client).user.findFirst({
      where: { tenantId, id: targetUserId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found.');
    const item = await (this.tenantPrisma.client as Client).facultyAvailability.create({
      data: {
        tenantId,
        userId: targetUserId,
        termId: dto.termId ?? null,
        campusId: dto.campusId ?? null,
        dayOfWeek: dto.dayOfWeek,
        startTime: dto.startTime,
        endTime: dto.endTime,
        isBlocked: dto.isBlocked ?? true,
        note: dto.note ?? null,
        createdBy: userId,
        updatedBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.FACULTY_AVAILABILITY_CREATED, 'faculty_availability', item.id, {
      after: { userId: targetUserId, dayOfWeek: dto.dayOfWeek, startTime: dto.startTime, endTime: dto.endTime },
    });
    return item;
  }

  async updateAvailability(tenantId: string, userId: string, id: string, dto: UpdateAvailabilityDto) {
    const admin = await this.adminFlag(tenantId, userId);
    const item = await (this.tenantPrisma.client as Client).facultyAvailability.findFirst({
      where: { tenantId, id },
    });
    if (!item) throw new NotFoundException('Availability block not found.');
    if (!admin && item.userId !== userId) throw new NotFoundException('Availability block not found.');
    const startTime = dto.startTime ?? item.startTime;
    const endTime = dto.endTime ?? item.endTime;
    this.assertTimeRange(startTime, endTime);
    const data: Prisma.FacultyAvailabilityUpdateInput = {
      termId: dto.termId !== undefined ? dto.termId : undefined,
      campusId: dto.campusId !== undefined ? dto.campusId : undefined,
      dayOfWeek: dto.dayOfWeek !== undefined ? dto.dayOfWeek : undefined,
      startTime: dto.startTime ?? undefined,
      endTime: dto.endTime ?? undefined,
      isBlocked: dto.isBlocked !== undefined ? dto.isBlocked : undefined,
      isActive: dto.isActive !== undefined ? dto.isActive : undefined,
      note: dto.note !== undefined ? dto.note : undefined,
      updatedBy: userId,
    };
    await (this.tenantPrisma.client as Client).facultyAvailability.update({ where: { id }, data });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.FACULTY_AVAILABILITY_UPDATED, 'faculty_availability', id, {
      after: { ...dto },
    });
    return this.availabilityDetail(tenantId, id);
  }

  async deleteAvailability(tenantId: string, userId: string, id: string) {
    const admin = await this.adminFlag(tenantId, userId);
    const item = await (this.tenantPrisma.client as Client).facultyAvailability.findFirst({
      where: { tenantId, id },
    });
    if (!item) throw new NotFoundException('Availability block not found.');
    if (!admin && item.userId !== userId) throw new NotFoundException('Availability block not found.');
    await (this.tenantPrisma.client as Client).facultyAvailability.delete({ where: { id } });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.FACULTY_AVAILABILITY_DELETED, 'faculty_availability', id, {
      before: { userId: item.userId, dayOfWeek: item.dayOfWeek },
    });
    return { ok: true };
  }

  private async availabilityDetail(tenantId: string, id: string) {
    const item = await (this.tenantPrisma.client as Client).facultyAvailability.findFirst({
      where: { tenantId, id },
      include: { user: { select: { id: true, fullName: true, email: true } } },
    });
    if (!item) throw new NotFoundException('Availability block not found.');
    return item;
  }

  async listAvailabilityForTimetable(tenantId: string, userId: string, id: string) {
    const timetable = await this.requireTimetable(tenantId, id);
    const entries = await (this.tenantPrisma.client as Client).timetableEntry.findMany({
      where: { tenantId, timetableId: id },
      select: { assignedUserId: true },
    });
    const facultyIds = [...new Set(entries.map((e) => e.assignedUserId).filter((uid): uid is string => Boolean(uid)))];
    const items = facultyIds.length
      ? await (this.tenantPrisma.client as Client).facultyAvailability.findMany({
          where: {
            tenantId,
            isActive: true,
            userId: { in: facultyIds },
            OR: [
              { termId: timetable.termId, campusId: timetable.campusId },
              { termId: timetable.termId, campusId: null },
              { termId: null, campusId: timetable.campusId },
              { termId: null, campusId: null },
            ],
          },
          orderBy: [{ userId: 'asc' }, { dayOfWeek: 'asc' }, { startTime: 'asc' }],
          include: { user: { select: { id: true, fullName: true, email: true } } },
          take: 500,
        })
      : [];
    return { data: items, total: items.length };
  }

  // ── Conflict sweep ────────────────────────────────────────────────────────

  async listConflicts(tenantId: string, userId: string, id: string, query: TimetablePaginationDto) {
    await this.requireTimetableScoped(tenantId, userId, id);
    const where: Prisma.TimetableConflictWhereInput = { tenantId, timetableId: id };
    const [items, total] = await Promise.all([
      (this.tenantPrisma.client as Client).timetableConflict.findMany({
        where,
        ...this.page(query),
        orderBy: [{ resolvedAt: 'asc' }, { detectedAt: 'desc' }],
      }),
      (this.tenantPrisma.client as Client).timetableConflict.count({ where }),
    ]);
    return { data: items, total };
  }

  async recheckConflicts(tenantId: string, userId: string, id: string) {
    await this.requireTimetable(tenantId, id);
    await (this.tenantPrisma.client as Client).timetableConflict.deleteMany({ where: { tenantId, timetableId: id } });

    const entries = await (this.tenantPrisma.client as Client).timetableEntry.findMany({
      where: { tenantId, timetableId: id },
      include: {
        period: { select: { id: true, sequence: true } },
        courseOffering: { select: { id: true, code: true, course: { select: { name: true } } } },
        assignedUser: { select: { id: true, fullName: true } },
        section: { select: { id: true, code: true, name: true } },
        room: { select: { id: true, code: true, name: true } },
      },
    });
    const bySlot = new Map<string, typeof entries>();
    for (const e of entries) {
      const key = `${e.dayOfWeek}:${e.periodId}`;
      const list = bySlot.get(key) ?? [];
      list.push(e);
      bySlot.set(key, list);
    }

    const conflicts: Prisma.TimetableConflictCreateManyInput[] = [];
    const push = (
      conflictType: TimetableConflictType,
      dayOfWeek: number,
      periodId: string | undefined,
      entryA: (typeof entries)[number],
      entryB: (typeof entries)[number],
      description: string,
      source: string,
    ) => {
      conflicts.push({
        tenantId,
        timetableId: id,
        conflictType,
        dayOfWeek,
        periodId,
        entryAId: entryA.id,
        entryBId: entryB.id,
        description,
        source,
        createdBy: userId,
      });
    };

    for (const [key, group] of bySlot) {
      const [day, periodId] = key.split(':');
      const dayNum = Number(day);
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const a = group[i]!;
          const b = group[j]!;
          if (a.roomId && a.roomId === b.roomId) {
            push('ROOM', dayNum, periodId, a, b, `Room ${a.room?.name ?? a.room?.code} is double-booked.`, 'sweep');
          }
          if (a.assignedUserId && a.assignedUserId === b.assignedUserId) {
            push('FACULTY', dayNum, periodId, a, b, `${a.assignedUser?.fullName} is double-booked.`, 'sweep');
          }
          if (a.sectionId && a.sectionId === b.sectionId) {
            push('SECTION', dayNum, periodId, a, b, `Section ${a.section?.code ?? a.section?.name} has two sessions at once.`, 'sweep');
          }
        }
      }
    }

    // Date-specific substitution conflicts: two APPROVED/EXECUTED substitutions by the same
    // substitute on the same date, or one that collides with the substitute's own entries.
    const activeSubs = await (this.tenantPrisma.client as Client).timetableSubstitution.findMany({
      where: { tenantId, timetableId: id, status: { in: ['APPROVED', 'EXECUTED'] } },
      include: { entry: { select: { periodId: true, dayOfWeek: true } } },
    });
    for (let i = 0; i < activeSubs.length; i++) {
      for (let j = i + 1; j < activeSubs.length; j++) {
        const a = activeSubs[i]!;
        const b = activeSubs[j]!;
        const sameDate = a.effectiveDate.getTime() === b.effectiveDate.getTime();
        const aDay = a.entry.dayOfWeek;
        const bDay = b.entry.dayOfWeek;
        const dateDayOfA = new Date(a.effectiveDate).getDay();
        if (sameDate && aDay === bDay && a.entry.periodId === b.entry.periodId && a.substituteUserId === b.substituteUserId) {
          conflicts.push({
            tenantId,
            timetableId: id,
            conflictType: 'FACULTY' as TimetableConflictType,
            dayOfWeek: dateDayOfA,
            periodId: a.entry.periodId,
            substitutionAId: a.id,
            substitutionBId: b.id,
            description: 'Two approved substitutions hand the same slot to the same substitute on one date.',
            source: 'substitution',
          });
        }
      }
    }

    if (conflicts.length > 0) {
      await (this.tenantPrisma.client as Client).timetableConflict.createMany({ data: conflicts });
    }
    await this.log(tenantId, userId, id, 'CONFLICTS_RECHECKED', `Recheck complete: ${conflicts.length} conflict(s) found.`);
    await this.audit(tenantId, userId, AUDIT_ACTIONS.TIMETABLE_CONFLICTS_RECHECKED, 'timetable', id, {
      after: { conflictsFound: conflicts.length },
    });
    return { detected: conflicts.length, conflicts };
  }

  // ── Substitutions ─────────────────────────────────────────────────────────

  async listSubstitutions(tenantId: string, userId: string, id: string, query: ListSubstitutionsQueryDto) {
    const { own } = await this.requireTimetableScoped(tenantId, userId, id);
    const where: Prisma.TimetableSubstitutionWhereInput = {
      tenantId,
      timetableId: id,
      ...(query.status ? { status: query.status as SubstitutionStatus } : {}),
    };
    if (own) {
      where.OR = [{ substituteUserId: userId }, { requestedById: userId }, { entry: { assignedUserId: userId } }];
    }
    const [items, total] = await Promise.all([
      (this.tenantPrisma.client as Client).timetableSubstitution.findMany({
        where,
        ...this.page(query),
        orderBy: { createdAt: 'desc' },
        include: {
          entry: { include: ENTRY_INCLUDE },
          substituteUser: { select: { id: true, fullName: true, email: true } },
        },
      }),
      (this.tenantPrisma.client as Client).timetableSubstitution.count({ where }),
    ]);
    return { data: items, total };
  }

  async requestSubstitution(tenantId: string, userId: string, id: string, dto: RequestSubstitutionDto) {
    const timetable = await this.requireTimetable(tenantId, id);
    if (!['GENERATED', 'PUBLISHED'].includes(timetable.status)) {
      throw new BadRequestException('Substitutions can only be requested on a generated or published timetable.');
    }
    const entry = await (this.tenantPrisma.client as Client).timetableEntry.findFirst({
      where: { tenantId, timetableId: id, id: dto.entryId },
      include: ENTRY_INCLUDE,
    });
    if (!entry) throw new NotFoundException('Timetable entry not found.');
    const substitute = await (this.tenantPrisma.client as Client).user.findFirst({
      where: { tenantId, id: dto.substituteUserId },
      select: { id: true, fullName: true },
    });
    if (!substitute) throw new NotFoundException('Substitute user not found.');
    const effective = new Date(`${dto.effectiveDate}T00:00:00.000Z`);
    const existing = await (this.tenantPrisma.client as Client).timetableSubstitution.findFirst({
      where: { tenantId, timetableId: id, entryId: dto.entryId, effectiveDate: effective },
    });
    if (existing) throw new ConflictException('A substitution already exists for this entry on that date.');

    const item = await (this.tenantPrisma.client as Client).timetableSubstitution.create({
      data: {
        tenantId,
        timetableId: id,
        entryId: dto.entryId,
        originalUserId: dto.originalUserId ?? entry.assignedUserId ?? null,
        substituteUserId: dto.substituteUserId,
        effectiveDate: effective,
        reason: dto.reason ?? null,
        status: 'REQUESTED',
        requestedById: userId,
      },
      include: { entry: { include: ENTRY_INCLUDE }, substituteUser: { select: { id: true, fullName: true, email: true } } },
    });
    await this.notifyUser(
      tenantId,
      dto.substituteUserId,
      'Substitution request',
      `You have been asked to substitute ${this.entryLabel(entry)} on ${dto.effectiveDate}. Review it in Timetable → Substitutions.`,
    );
    await this.log(
      tenantId,
      userId,
      id,
      'SUBSTITUTION_REQUESTED',
      `${substitute.fullName} requested as substitute for ${this.entryLabel(entry)} on ${dto.effectiveDate}.`,
    );
    await this.audit(tenantId, userId, AUDIT_ACTIONS.TIMETABLE_SUBSTITUTION_REQUESTED, 'timetable_substitution', item.id, {
      after: { timetableId: id, entryId: dto.entryId, substituteUserId: dto.substituteUserId, effectiveDate: dto.effectiveDate },
    });
    return item;
  }

  async decideSubstitution(tenantId: string, userId: string, id: string, subId: string, dto: DecideSubstitutionDto) {
    const timetable = await this.requireTimetable(tenantId, id);
    const sub = await (this.tenantPrisma.client as Client).timetableSubstitution.findFirst({
      where: { tenantId, timetableId: id, id: subId },
      include: {
        entry: { include: ENTRY_INCLUDE },
        substituteUser: { select: { id: true, fullName: true, email: true } },
      },
    });
    if (!sub) throw new NotFoundException('Substitution not found.');
    const target = dto.status as SubstitutionStatus;

    if (target === 'APPROVED') {
      if (sub.status !== 'REQUESTED') throw new BadRequestException(`A ${sub.status.toLowerCase()} substitution cannot be approved.`);
      await this.substitutionConflictGate(tenantId, userId, timetable, sub, id);
    } else if (target === 'DECLINED') {
      if (sub.status !== 'REQUESTED') throw new BadRequestException('Only a requested substitution can be declined.');
    } else {
      // CANCELLED
      if (!['REQUESTED', 'APPROVED'].includes(sub.status)) {
        throw new BadRequestException('This substitution cannot be cancelled.');
      }
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const targetStatus: SubstitutionStatus =
      target === 'APPROVED' && sub.effectiveDate.getTime() <= today.getTime() ? 'EXECUTED' : target;

    await (this.tenantPrisma.client as Client).timetableSubstitution.update({
      where: { id: subId },
      data: { status: targetStatus, decidedById: userId, decidedAt: new Date() },
    });
    await this.log(
      tenantId,
      userId,
      id,
      'SUBSTITUTION_DECIDED',
      `Substitution for ${this.entryLabel(sub.entry)} on ${sub.effectiveDate.toISOString().slice(0, 10)} marked ${targetStatus}.`,
    );
    await this.audit(tenantId, userId, AUDIT_ACTIONS.TIMETABLE_SUBSTITUTION_DECIDED, 'timetable_substitution', subId, {
      before: { status: sub.status },
      after: { status: targetStatus },
    });
    if (sub.requestedById) {
      await this.notifyUser(
        tenantId,
        sub.requestedById,
        'Substitution decision',
        `Your substitution request for ${this.entryLabel(sub.entry)} on ${sub.effectiveDate.toISOString().slice(0, 10)} was ${targetStatus.toLowerCase()}.`,
      );
    }
    await this.notifyUser(
      tenantId,
      sub.substituteUserId,
      'Substitution decision',
      `Your substitution of ${this.entryLabel(sub.entry)} on ${sub.effectiveDate.toISOString().slice(0, 10)} was ${targetStatus.toLowerCase()}.`,
    );
    return { ok: true, status: targetStatus };
  }

  private async substitutionConflictGate(
    tenantId: string,
    userId: string,
    timetable: { termId: string; campusId: string },
    sub: {
      id: string;
      substituteUserId: string;
      effectiveDate: Date;
      entry: {
        id: string;
        periodId: string;
        dayOfWeek: number;
        roomId: string | null;
        period: { startTime: string; endTime: string };
      };
    },
    timetableId: string,
  ): Promise<void> {
    const dayOfWeek = new Date(sub.effectiveDate).getDay();
    const conflicts: ConflictDetail[] = [];

    const overlapOrs: Prisma.TimetableEntryWhereInput[] = [];
    if (sub.substituteUserId) overlapOrs.push({ assignedUserId: sub.substituteUserId });
    if (sub.entry.roomId) overlapOrs.push({ roomId: sub.entry.roomId });
    const sameSlot = overlapOrs.length
      ? await (this.tenantPrisma.client as Client).timetableEntry.findMany({
          where: {
            tenantId,
            timetableId,
            dayOfWeek,
            OR: overlapOrs,
            id: { not: sub.entry.id },
          },
          include: {
            period: { select: { startTime: true, endTime: true } },
            assignedUser: { select: { id: true, fullName: true } },
            courseOffering: { select: { id: true, code: true, course: { select: { name: true } } } },
            section: { select: { id: true, code: true, name: true } },
            room: { select: { id: true, code: true, name: true } },
          },
        })
      : [];
    const entryPeriod = sub.entry.period;
    for (const e of sameSlot) {
      if (!timeOverlaps(entryPeriod.startTime, entryPeriod.endTime, e.period.startTime, e.period.endTime)) continue;
      const isFaculty = e.assignedUserId === sub.substituteUserId;
      const isRoom = sub.entry.roomId != null && e.roomId === sub.entry.roomId;
      if (isFaculty) {
        conflicts.push({ type: 'FACULTY', subject: `Substitute is already teaching ${this.entryLabel(e)} at this time on that date` });
      }
      if (isRoom) {
        conflicts.push({ type: 'ROOM', subject: `The room is already booked for ${this.entryLabel(e)} at this time on that date` });
      }
      if (isFaculty || isRoom) {
        const reason = isFaculty
          ? `Substitute is already teaching ${this.entryLabel(e)} at this time on that date`
          : `The room is already booked for ${this.entryLabel(e)} at this time on that date`;
        await (this.tenantPrisma.client as Client).timetableConflict
          .create({
            data: {
              tenantId,
              timetableId,
              conflictType: isFaculty ? ('FACULTY' as TimetableConflictType) : ('ROOM' as TimetableConflictType),
              dayOfWeek,
              periodId: sub.entry.periodId,
              entryBId: e.id,
              substitutionAId: sub.id,
              description: `Substitution blocked: ${reason}.`,
              source: 'substitution',
              createdBy: userId,
            },
          })
          .catch(() => undefined);
      }
    }

    if (conflicts.length > 0) {
      throw new ConflictException(`Substitution conflicts: ${conflicts.map((c) => c.subject).join('; ')}`);
    }
  }

  // ── Lookups ───────────────────────────────────────────────────────────────

  async lookups(tenantId: string) {
    const [terms, campuses, rooms, sections, offerings] = await Promise.all([
      (this.tenantPrisma.client as Client).term.findMany({
        where: { tenantId },
        orderBy: [{ isCurrent: 'desc' }, { startDate: 'desc' }],
        select: { id: true, code: true, name: true, isCurrent: true },
      }),
      (this.tenantPrisma.client as Client).campus.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: { name: 'asc' },
        select: { id: true, code: true, name: true },
      }),
      (this.tenantPrisma.client as Client).room.findMany({
        where: { tenantId, isActive: true, deletedAt: null },
        orderBy: { name: 'asc' },
        select: { id: true, code: true, name: true, roomType: true, capacity: true, campusId: true },
      }),
      (this.tenantPrisma.client as Client).section.findMany({
        where: { tenantId, isActive: true, deletedAt: null },
        orderBy: { code: 'asc' },
        select: { id: true, code: true, name: true, programId: true },
      }),
      (this.tenantPrisma.client as Client).courseOffering.findMany({
        where: { tenantId, status: 'ACTIVE', deletedAt: null },
        take: 300,
        orderBy: { code: 'asc' },
        select: {
          id: true,
          code: true,
          termId: true,
          campusId: true,
          course: { select: { id: true, code: true, name: true, creditHours: true, courseType: true } },
          section: { select: { id: true, code: true, name: true } },
        },
      }),
    ]);
    return { terms, campuses, rooms, sections, offerings };
  }

  // ── History ───────────────────────────────────────────────────────────────

  async listHistory(tenantId: string, userId: string, id: string, query: TimetablePaginationDto) {
    await this.requireTimetableScoped(tenantId, userId, id);
    const where: Prisma.TimetableHistoryWhereInput = { tenantId, timetableId: id };
    const [items, total] = await Promise.all([
      (this.tenantPrisma.client as Client).timetableHistory.findMany({
        where,
        ...this.page(query),
        orderBy: { createdAt: 'desc' },
      }),
      (this.tenantPrisma.client as Client).timetableHistory.count({ where }),
    ]);
    return { data: items, total };
  }

  // ── Conflict helpers kept local ───────────────────────────────────────────
}