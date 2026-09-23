/**
 * Hostel service — the full student-residence module: hostels/buildings/floors/rooms/beds
 * hierarchy, warden assignments, the shared StudentHostelBooking lifecycle (allocate → check-in
 * → check-out / transfer / cancel) with physical bed-state maintained (AVAILABLE → RESERVED →
 * OCCUPIED), rent charges written through the shared StudentFee ledger (hostelBookingId),
 * complaints, a visitor logbook, and occupancy/dues/history reports. Catalog reads are shared
 * tenant resources (any hostel.view); student-anchored rows are scoped via the hostel grants
 * exactly like library loans. Every mutation lands an audit event (module 'hostel'); student-
 * and warden-facing events raise in-app notifications.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@college-erp/database';
import { AUDIT_ACTIONS, AUDIT_MODULES } from '@college-erp/auth';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { AuditService } from '../audit/audit.service';
import { PermissionsService } from '../rbac/permissions.service';
import { NotificationsService } from '../notifications/notifications.service';
import { hostelBookingWhereInput, hostelChargeWhereInput, hostelStudentWhereInput, hostelStudentAnchoredScope } from './hostel-scope';
import { computeHostelChargeCents, hostelChargePeriod } from './hostel-fees';
import {
  AddHostelBedsDto,
  AllocateHostelBookingDto,
  AssignHostelComplaintDto,
  AssignHostelWardenDto,
  CancelHostelBookingDto,
  CheckInHostelBookingDto,
  CheckOutHostelBookingDto,
  CheckOutHostelVisitorDto,
  CloseHostelComplaintDto,
  CreateHostelBookingDto,
  CreateHostelBuildingDto,
  CreateHostelChargeDto,
  CreateHostelComplaintDto,
  CreateHostelFloorDto,
  CreateHostelDto,
  CreateHostelRoomDto,
  CreateHostelVisitorDto,
  HostelDuesQueryDto,
  ListHostelBookingsQueryDto,
  ListHostelChargesQueryDto,
  ListHostelComplaintsQueryDto,
  ListHostelsQueryDto,
  ListHostelVisitorsQueryDto,
  ResolveHostelComplaintDto,
  SetHostelBedStatusDto,
  TransferHostelBookingDto,
  UpdateHostelBedDto,
  UpdateHostelBookingDto,
  UpdateHostelBuildingDto,
  UpdateHostelComplaintDto,
  UpdateHostelDto,
  UpdateHostelFloorDto,
  UpdateHostelRoomDto,
  UpdateHostelVisitorDto,
  UpdateHostelWardenDto,
  WaiveHostelChargeDto,
} from './dto/hostel.dto';

type Client = Prisma.TransactionClient;

const ACTIVE_BOOKING_STATUSES = ['ALLOCATED', 'CHECKED_IN'] as const;
const BED_HELD_STATUSES = ['ALLOCATED', 'CHECKED_IN'] as const;
const BOOKING_DEFAULT_ACTIVE = ['REQUESTED', 'ALLOCATED', 'CHECKED_IN'];
const FALLBACK_FEE_HEAD = { code: 'hostel_rent', name: 'Hostel Rent' };

const bookingInclude = {
  student: {
    select: {
      id: true,
      fullName: true,
      admissionNumber: true,
      rollNumber: true,
      userId: true,
      program: { select: { id: true, name: true, code: true } },
    },
  },
  hostel: { select: { id: true, code: true, name: true, genderType: true } },
  building: { select: { id: true, code: true, name: true } },
  floor: { select: { id: true, floorNumber: true, name: true } },
  room: { select: { id: true, code: true, name: true } },
  bed: { select: { id: true, code: true } },
} as const;

@Injectable()
export class HostelService {
  private readonly logger = new Logger(HostelService.name);

  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditService: AuditService,
    private readonly permissionsService: PermissionsService,
    private readonly notifications: NotificationsService,
  ) {}

  private get db(): any {
    return this.tenantPrisma.client;
  }

  // ── Shared helpers ────────────────────────────────────────────────────────

  private async grants(tenantId: string, userId: string) {
    return this.permissionsService.getScopeGrantsFor(tenantId, userId, 'hostel.view');
  }

  private async studentScope(tenantId: string, userId: string) {
    return hostelStudentWhereInput(await this.grants(tenantId, userId), userId);
  }

  private async bookingScope(tenantId: string, userId: string) {
    return hostelBookingWhereInput(await this.grants(tenantId, userId), userId);
  }

  private async anchoredScope(tenantId: string, userId: string) {
    return hostelStudentAnchoredScope(await this.grants(tenantId, userId), userId) as any;
  }

  private async chargeScope(tenantId: string, userId: string) {
    return hostelChargeWhereInput(await this.grants(tenantId, userId), userId);
  }

  private async audit(tenantId: string, userId: string, action: string, entityType: string, entityId: string | undefined, extra?: { before?: unknown; after?: unknown }) {
    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId: userId,
      action,
      module: AUDIT_MODULES.HOSTEL,
      entityType,
      entityId,
      before: extra?.before,
      after: extra?.after,
    });
  }

  private async notifyUser(tenantId: string, recipientUserId: string | null | undefined, subject: string, body: string) {
    if (recipientUserId) {
      await this.notifications.sendSystem(tenantId, { recipientUserId, subject, body });
    }
  }

  private async findHostel(tenantId: string, id: string, includeInactive = false) {
    const row = await this.db.hostel.findFirst({
      where: { id, ...(includeInactive ? {} : { isActive: true }), deletedAt: null },
    });
    if (!row) throw new NotFoundException('Hostel not found.');
    return row;
  }

  private async findBuilding(tenantId: string, id: string, includeInactive = false) {
    const row = await this.db.hostelBuilding.findFirst({
      where: { id, ...(includeInactive ? {} : { isActive: true }), deletedAt: null },
    });
    if (!row) throw new NotFoundException('Building not found.');
    return row;
  }

  private async findFloor(tenantId: string, id: string, includeInactive = false) {
    const row = await this.db.hostelFloor.findFirst({
      where: { id, ...(includeInactive ? {} : { isActive: true }), deletedAt: null },
    });
    if (!row) throw new NotFoundException('Floor not found.');
    return row;
  }

  private async findRoom(tenantId: string, id: string, includeInactive = false) {
    const row = await this.db.hostelRoom.findFirst({
      where: { id, ...(includeInactive ? {} : { isActive: true }), deletedAt: null },
    });
    if (!row) throw new NotFoundException('Room not found.');
    return row;
  }

  private async findBed(tenantId: string, id: string) {
    const row = await this.db.hostelBed.findFirst({
      where: { id, isActive: true, deletedAt: null },
      include: { room: { include: { floor: { include: { building: { include: { hostel: true } } } } } } },
    });
    if (!row) throw new NotFoundException('Bed not found.');
    return row;
  }

  private async findBooking(tenantId: string, id: string, include?: boolean) {
    const row = await this.db.studentHostelBooking.findFirst({
      where: { id },
      include: include ? bookingInclude : undefined,
    });
    if (!row) throw new NotFoundException('Booking not found.');
    return row;
  }

  private async findStudent(tenantId: string, studentId: string) {
    const row = await this.db.student.findFirst({
      where: { id: studentId },
      select: { id: true, fullName: true, admissionNumber: true, userId: true },
    });
    if (!row) throw new NotFoundException('Student not found in this tenant.');
    return row;
  }

  private async assertCodeFree(model: string, where: Record<string, unknown>, label: string) {
    const existing = await this.db[model].findFirst({ where: { ...where, deletedAt: null } });
    if (existing) throw new ConflictException(`${label} already exists with the same code.`);
  }

  private async assertStudentNoActiveBooking(tenantId: string, studentId: string) {
    const active = await this.db.studentHostelBooking.findFirst({
      where: { studentId, status: { in: BOOKING_DEFAULT_ACTIVE as any } },
      select: { id: true },
    });
    if (active) throw new ConflictException('This student already has an active hostel booking.');
  }

  /** Transaction-path updates must carry tenantId explicitly — the tenant guard extension does
   * not wrap transactions, so we never rely on it inside $transaction callbacks. */
  private syncBookedBed(tx: Client, tenantId: string, bed: any, status: string) {
    return tx.hostelBed.update({
      where: { id: bed.id, tenantId },
      data: { status: status as any },
    });
  }

  // ── Lookups & catalog ─────────────────────────────────────────────────────

  async lookups(_tenantId: string) {
    const [campuses, hostels, buildings, floors, rooms, beds, feeHeads] = await Promise.all([
      this.db.campus.findMany({
        where: { deletedAt: null, isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, code: true, name: true },
      }),
      this.db.hostel.findMany({
        where: { deletedAt: null },
        orderBy: { name: 'asc' },
        include: { _count: { select: { buildings: true, complaints: true, bookings: true } } },
      }),
      this.db.hostelBuilding.findMany({
        where: { deletedAt: null },
        orderBy: { name: 'asc' },
        select: { id: true, hostelId: true, code: true, name: true, isActive: true },
      }),
      this.db.hostelFloor.findMany({
        where: { deletedAt: null },
        orderBy: { floorNumber: 'asc' },
        select: { id: true, buildingId: true, floorNumber: true, name: true, isActive: true },
      }),
      this.db.hostelRoom.findMany({
        where: { deletedAt: null },
        orderBy: { code: 'asc' },
        select: { id: true, floorId: true, code: true, name: true, sharing: true, bedCapacity: true, monthlyRentCents: true, isActive: true },
      }),
      this.db.hostelBed.findMany({
        where: { deletedAt: null },
        orderBy: { code: 'asc' },
        select: { id: true, roomId: true, code: true, status: true, monthlyRentCents: true, isActive: true },
      }),
      this.db.feeHead.findMany({
        where: { deletedAt: null, isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, code: true, name: true },
      }),
    ]);
    return {
      campuses,
      hostels,
      buildings,
      floors,
      rooms,
      beds,
      feeHeads,
      genderTypes: ['BOYS', 'GIRLS', 'COED'],
      roomSharing: ['SINGLE', 'DOUBLE', 'TRIPLE', 'FOUR', 'DORM'],
      bedStatuses: ['AVAILABLE', 'OCCUPIED', 'RESERVED', 'MAINTENANCE'],
      wardenRoles: ['WARDEN', 'ASSISTANT'],
      bookingStatuses: ['REQUESTED', 'ALLOCATED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED'],
      complaintCategories: ['MAINTENANCE', 'ELECTRICAL', 'PLUMBING', 'CLEANING', 'INFRASTRUCTURE', 'NOISE', 'FOOD', 'SECURITY', 'OTHER'],
      complaintStatuses: ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'],
      complaintPriorities: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'],
      visitorStatuses: ['INSIDE', 'EXITED'],
      feeStatuses: ['ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'WAIVED', 'REFUNDED'],
    };
  }

  async searchUsers(tenantId: string, userId: string, search?: string) {
    const where: any = {
      AND: [
        { tenantId },
        ...(search?.trim()
          ? [
              {
                OR: [
                  { fullName: { contains: search.trim(), mode: 'insensitive' } },
                  { email: { contains: search.trim(), mode: 'insensitive' } },
                ],
              },
            ]
          : []),
      ],
    };
    return this.db.user.findMany({
      where,
      take: 50,
      orderBy: { fullName: 'asc' },
      select: { id: true, fullName: true, email: true },
    });
  }

  /** Students the current viewer may allocate hostel beds to — scoped through hostel.view grants. */
  async searchStudents(tenantId: string, userId: string, search?: string) {
    const scope = await this.studentScope(tenantId, userId);
    const where: any = { ...(scope ?? {}), AND: [] };
    if (search?.trim()) {
      const q = search.trim();
      where.AND.push({
        OR: [
          { fullName: { contains: q, mode: 'insensitive' } },
          { admissionNumber: { contains: q, mode: 'insensitive' } },
          { rollNumber: { contains: q, mode: 'insensitive' } },
        ],
      });
    }
    return this.db.student.findMany({
      where,
      take: 50,
      orderBy: { fullName: 'asc' },
      select: { id: true, fullName: true, admissionNumber: true, rollNumber: true, userId: true },
    });
  }

  // ── Hostels ───────────────────────────────────────────────────────────────

  async listHostels(tenantId: string, query: ListHostelsQueryDto) {
    const where: any = { deletedAt: null, ...(query.includeInactive ? {} : { isActive: true }), ...(query.campusId ? { campusId: query.campusId } : {}) };
    if (query.search?.trim()) {
      where.OR = [
        { name: { contains: query.search.trim(), mode: 'insensitive' } },
        { code: { contains: query.search.trim(), mode: 'insensitive' } },
      ];
    }
    return this.db.hostel.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        campus: { select: { id: true, name: true } },
        feeHead: { select: { id: true, code: true, name: true } },
        wardens: { where: { isActive: true }, select: { id: true, userId: true, role: true } },
        _count: { select: { buildings: true, complaints: true, bookings: true } },
      },
    });
  }

  async getHostel(tenantId: string, id: string) {
    const hostel = await this.db.hostel.findFirst({
      where: { id, deletedAt: null },
      include: {
        campus: { select: { id: true, name: true } },
        feeHead: { select: { id: true, code: true, name: true } },
        wardens: { select: { id: true, userId: true, role: true, isActive: true } },
        buildings: {
          where: { deletedAt: null },
          orderBy: { name: 'asc' },
          include: {
            floors: {
              where: { deletedAt: null },
              orderBy: { floorNumber: 'asc' },
              include: {
                rooms: {
                  where: { deletedAt: null },
                  orderBy: { code: 'asc' },
                  include: {
                    beds: { orderBy: { code: 'asc' } },
                    _count: { select: { bookings: true, complaints: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!hostel) throw new NotFoundException('Hostel not found.');
    return hostel;
  }

  async createHostel(tenantId: string, userId: string, dto: CreateHostelDto) {
    await this.assertCodeFree('hostel', { tenantId, campusId: dto.campusId, code: dto.code }, 'A hostel');
    const campus = await this.db.campus.findFirst({ where: { id: dto.campusId, deletedAt: null }, select: { id: true } });
    if (!campus) throw new NotFoundException('Campus not found.');
    const row = await this.db.hostel.create({
      data: {
        campusId: dto.campusId,
        code: dto.code,
        name: dto.name,
        genderType: dto.genderType as any,
        wardenUserId: dto.wardenUserId,
        description: dto.description,
        feeHeadId: dto.feeHeadId,
        chargeRentOnCheckIn: dto.chargeRentOnCheckIn ?? true,
        createdBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.HOSTEL_CREATED, 'Hostel', row.id, { after: row });
    return row;
  }

  async updateHostel(tenantId: string, userId: string, id: string, dto: UpdateHostelDto) {
    const before = await this.findHostel(tenantId, id, true);
    if (dto.code && dto.code !== before.code) {
      await this.assertCodeFree('hostel', { tenantId, campusId: before.campusId, code: dto.code }, 'A hostel');
    }
    const row = await this.db.hostel.update({
      where: { id },
      data: {
        ...(dto.code !== undefined ? { code: dto.code } : {}),
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.genderType !== undefined ? { genderType: dto.genderType as any } : {}),
        ...(dto.wardenUserId !== undefined ? { wardenUserId: dto.wardenUserId } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.feeHeadId !== undefined ? { feeHeadId: dto.feeHeadId } : {}),
        ...(dto.chargeRentOnCheckIn !== undefined ? { chargeRentOnCheckIn: dto.chargeRentOnCheckIn } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        updatedBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.HOSTEL_UPDATED, 'Hostel', row.id, { before, after: row });
    return row;
  }

  async deleteHostel(tenantId: string, userId: string, id: string) {
    const before = await this.findHostel(tenantId, id, true);
    const row = await this.db.hostel.update({ where: { id }, data: { deletedAt: new Date(), isActive: false, updatedBy: userId } });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.HOSTEL_DELETED, 'Hostel', row.id, { before, after: row });
    return { id: row.id };
  }

  // ── Buildings ─────────────────────────────────────────────────────────────

  async createBuilding(tenantId: string, userId: string, dto: CreateHostelBuildingDto) {
    await this.findHostel(tenantId, dto.hostelId);
    await this.assertCodeFree('hostelBuilding', { tenantId, hostelId: dto.hostelId, code: dto.code }, 'A building');
    const row = await this.db.hostelBuilding.create({
      data: { hostelId: dto.hostelId, code: dto.code, name: dto.name, createdBy: userId },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.HOSTEL_BUILDING_CREATED, 'HostelBuilding', row.id, { after: row });
    return row;
  }

  async updateBuilding(tenantId: string, userId: string, id: string, dto: UpdateHostelBuildingDto) {
    const before = await this.findBuilding(tenantId, id, true);
    if (dto.code && dto.code !== before.code) {
      await this.assertCodeFree('hostelBuilding', { tenantId, hostelId: before.hostelId, code: dto.code }, 'A building');
    }
    const row = await this.db.hostelBuilding.update({
      where: { id },
      data: {
        ...(dto.code !== undefined ? { code: dto.code } : {}),
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        updatedBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.HOSTEL_BUILDING_UPDATED, 'HostelBuilding', row.id, { before, after: row });
    return row;
  }

  async deleteBuilding(tenantId: string, userId: string, id: string) {
    const before = await this.findBuilding(tenantId, id, true);
    const row = await this.db.hostelBuilding.update({ where: { id }, data: { deletedAt: new Date(), isActive: false, updatedBy: userId } });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.HOSTEL_BUILDING_DELETED, 'HostelBuilding', row.id, { before, after: row });
    return { id: row.id };
  }

  // ── Floors ────────────────────────────────────────────────────────────────

  async createFloor(tenantId: string, userId: string, dto: CreateHostelFloorDto) {
    await this.findBuilding(tenantId, dto.buildingId);
    const existing = await this.db.hostelFloor.findFirst({
      where: { tenantId, buildingId: dto.buildingId, floorNumber: dto.floorNumber, deletedAt: null },
      select: { id: true },
    });
    if (existing) throw new ConflictException('A floor with this number already exists in the building.');
    const row = await this.db.hostelFloor.create({
      data: { buildingId: dto.buildingId, floorNumber: dto.floorNumber, name: dto.name, createdBy: userId },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.HOSTEL_FLOOR_CREATED, 'HostelFloor', row.id, { after: row });
    return row;
  }

  async updateFloor(tenantId: string, userId: string, id: string, dto: UpdateHostelFloorDto) {
    const before = await this.findFloor(tenantId, id, true);
    if (dto.floorNumber && dto.floorNumber !== before.floorNumber) {
      const existing = await this.db.hostelFloor.findFirst({
        where: { tenantId, buildingId: before.buildingId, floorNumber: dto.floorNumber, deletedAt: null, NOT: { id } },
        select: { id: true },
      });
      if (existing) throw new ConflictException('A floor with this number already exists in the building.');
    }
    const row = await this.db.hostelFloor.update({
      where: { id },
      data: {
        ...(dto.floorNumber !== undefined ? { floorNumber: dto.floorNumber } : {}),
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        updatedBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.HOSTEL_FLOOR_UPDATED, 'HostelFloor', row.id, { before, after: row });
    return row;
  }

  async deleteFloor(tenantId: string, userId: string, id: string) {
    const before = await this.findFloor(tenantId, id, true);
    const row = await this.db.hostelFloor.update({ where: { id }, data: { deletedAt: new Date(), isActive: false, updatedBy: userId } });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.HOSTEL_FLOOR_DELETED, 'HostelFloor', row.id, { before, after: row });
    return { id: row.id };
  }

  // ── Rooms ─────────────────────────────────────────────────────────────────

  async createRoom(tenantId: string, userId: string, dto: CreateHostelRoomDto) {
    await this.findFloor(tenantId, dto.floorId);
    await this.assertCodeFree('hostelRoom', { tenantId, floorId: dto.floorId, code: dto.code }, 'A room');
    const row = await this.db.hostelRoom.create({
      data: {
        floorId: dto.floorId,
        code: dto.code,
        name: dto.name,
        sharing: dto.sharing as any,
        bedCapacity: dto.bedCapacity ?? 1,
        monthlyRentCents: dto.monthlyRentCents ?? 0,
        hasAttachedBath: dto.hasAttachedBath ?? false,
        notes: dto.notes,
        createdBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.HOSTEL_ROOM_CREATED, 'HostelRoom', row.id, { after: row });
    return row;
  }

  async updateRoom(tenantId: string, userId: string, id: string, dto: UpdateHostelRoomDto) {
    const before = await this.findRoom(tenantId, id, true);
    if (dto.code && dto.code !== before.code) {
      await this.assertCodeFree('hostelRoom', { tenantId, floorId: before.floorId, code: dto.code }, 'A room');
    }
    const row = await this.db.hostelRoom.update({
      where: { id },
      data: {
        ...(dto.code !== undefined ? { code: dto.code } : {}),
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.sharing !== undefined ? { sharing: dto.sharing as any } : {}),
        ...(dto.bedCapacity !== undefined ? { bedCapacity: dto.bedCapacity } : {}),
        ...(dto.monthlyRentCents !== undefined ? { monthlyRentCents: dto.monthlyRentCents } : {}),
        ...(dto.hasAttachedBath !== undefined ? { hasAttachedBath: dto.hasAttachedBath } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        updatedBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.HOSTEL_ROOM_UPDATED, 'HostelRoom', row.id, { before, after: row });
    return row;
  }

  async deleteRoom(tenantId: string, userId: string, id: string) {
    const before = await this.findRoom(tenantId, id, true);
    const row = await this.db.hostelRoom.update({ where: { id }, data: { deletedAt: new Date(), isActive: false, updatedBy: userId } });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.HOSTEL_ROOM_DELETED, 'HostelRoom', row.id, { before, after: row });
    return { id: row.id };
  }

  // ── Beds ──────────────────────────────────────────────────────────────────

  async addBeds(tenantId: string, userId: string, roomId: string, dto: AddHostelBedsDto) {
    const room = await this.findRoom(tenantId, roomId, true);
    const codes = dto.codes?.filter(Boolean) ?? [];
    const count = dto.count ?? codes.length;
    if (codes.length && codes.length !== count) {
      throw new BadRequestException('When codes are provided their count must match the requested count.');
    }
    if (count < 1 || count > 200) throw new BadRequestException('Add between 1 and 200 beds at a time.');

    const existing = await this.db.hostelBed.findMany({
      where: { tenantId, roomId, deletedAt: null },
      select: { code: true },
    });
    const used = new Set(existing.map((b: any) => b.code));
    const prefix = room.code;
    const rows: any[] = [];
    let auton = used.size + 1;
    const makeCode = (i: number) => {
      const wanted = codes[i];
      if (wanted) return used.has(wanted) ? null : wanted;
      let candidate = `${prefix}-B${String(auton).padStart(2, '0')}`;
      let guard = 0;
      while (used.has(candidate) && guard < 10000) {
        auton += 1;
        candidate = `${prefix}-B${String(auton).padStart(2, '0')}`;
        guard += 1;
      }
      return candidate;
    };

    // Pre-generate codes to avoid duplicate rows on races (client createMany is one statement).
    const toCreate: { roomId: string; code: string; monthlyRentCents: number; notes?: string | null; status: any }[] = [];
    for (let i = 0; i < count; i += 1) {
      const code = makeCode(i);
      if (!code) throw new ConflictException(`Bed code "${codes[i]}" already exists in this room.`);
      toCreate.push({
        roomId,
        code,
        monthlyRentCents: dto.monthlyRentCents ?? room.monthlyRentCents,
        notes: dto.notes,
        status: dto.status ?? 'AVAILABLE',
      });
    }
    // keep DB unique-constraint error friendly
    try {
      await this.db.hostelBed.createMany({ data: toCreate });
    } catch (err: any) {
      if (err?.code === 'P2002') throw new ConflictException('One of the bed codes already exists in this room.');
      throw err;
    }
    rows.push(...toCreate);
    await this.audit(tenantId, userId, AUDIT_ACTIONS.HOSTEL_BED_CREATED, 'HostelRoom', roomId, { after: { count, beds: toCreate } });
    return { created: rows.length };
  }

  async updateBed(tenantId: string, userId: string, id: string, dto: UpdateHostelBedDto) {
    const before = await this.db.hostelBed.findFirst({ where: { id }, include: { room: { select: { id: true } } } });
    if (!before) throw new NotFoundException('Bed not found.');
    if (dto.code && dto.code !== before.code) {
      await this.assertCodeFree('hostelBed', { tenantId, roomId: before.roomId, code: dto.code }, 'A bed');
    }
    const row = await this.db.hostelBed.update({
      where: { id },
      data: {
        ...(dto.code !== undefined ? { code: dto.code } : {}),
        ...(dto.monthlyRentCents !== undefined ? { monthlyRentCents: dto.monthlyRentCents } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.HOSTEL_BED_UPDATED, 'HostelBed', row.id, { before, after: row });
    return row;
  }

  async setBedStatus(tenantId: string, userId: string, id: string, dto: SetHostelBedStatusDto) {
    const bed = await this.db.hostelBed.findFirst({
      where: { id },
      include: { bookings: { where: { status: { in: BED_HELD_STATUSES as any } }, select: { id: true } } },
    });
    if (!bed) throw new NotFoundException('Bed not found.');
    if (['OCCUPIED', 'RESERVED'].includes(dto.status) && bed.bookings.length === 0) {
      throw new BadRequestException('Cannot mark a bed occupied/reserved without an active allocation.');
    }
    if (bed.bookings.length > 0 && !['OCCUPIED', 'RESERVED'].includes(dto.status)) {
      throw new BadRequestException('Cannot free a bed that still has an active allocation — check the student out first.');
    }
    const row = await this.db.hostelBed.update({ where: { id }, data: { status: dto.status as any } });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.HOSTEL_BED_UPDATED, 'HostelBed', row.id, { before: { status: bed.status }, after: row });
    return row;
  }

  // ── Wardens ───────────────────────────────────────────────────────────────

  async listWardens(tenantId: string, hostelId?: string) {
    return this.db.hostelWarden.findMany({
      where: { ...(hostelId ? { hostelId } : {}) },
      orderBy: { createdAt: 'asc' },
      include: { hostel: { select: { id: true, code: true, name: true } } },
    });
  }

  async listBuildings(tenantId: string, hostelId?: string) {
    return this.db.hostelBuilding.findMany({
      where: { deletedAt: null, ...(hostelId ? { hostelId } : {}) },
      orderBy: { name: 'asc' },
      include: {
        hostel: { select: { id: true, code: true, name: true } },
        _count: { select: { floors: true, bookings: true } },
      },
    });
  }

  async listFloors(tenantId: string, buildingId?: string) {
    return this.db.hostelFloor.findMany({
      where: { deletedAt: null, ...(buildingId ? { buildingId } : {}) },
      orderBy: [{ buildingId: 'asc' }, { floorNumber: 'asc' }],
      include: {
        building: { select: { id: true, code: true, name: true } },
        _count: { select: { rooms: true, bookings: true } },
      },
    });
  }

  async listRooms(tenantId: string, floorId?: string) {
    return this.db.hostelRoom.findMany({
      where: { deletedAt: null, ...(floorId ? { floorId } : {}) },
      orderBy: { code: 'asc' },
      include: {
        floor: { select: { id: true, floorNumber: true, building: { select: { id: true, code: true, name: true, hostel: { select: { id: true, code: true, name: true } } } } } },
        _count: { select: { beds: true, bookings: true } },
      },
    });
  }

  async listBeds(tenantId: string, roomId?: string) {
    return this.db.hostelBed.findMany({
      where: { deletedAt: null, ...(roomId ? { roomId } : {}) },
      orderBy: { code: 'asc' },
      include: {
        room: { select: { id: true, code: true, name: true, floor: { select: { id: true, floorNumber: true, name: true, building: { select: { id: true, code: true, name: true, hostel: { select: { id: true, code: true, name: true } } } } } } } },
        bookings: { where: { status: { in: BED_HELD_STATUSES as any } }, select: { id: true, student: { select: { id: true, fullName: true, admissionNumber: true } } } },
      },
    });
  }

  async deleteBed(tenantId: string, userId: string, id: string) {
    const before = await this.db.hostelBed.findFirst({ where: { id }, include: { bookings: { where: { status: { in: BED_HELD_STATUSES as any } }, select: { id: true } } } });
    if (!before) throw new NotFoundException('Bed not found.');
    if (before.bookings.length > 0) throw new BadRequestException('Cannot remove a bed with an active allocation.');
    const row = await this.db.hostelBed.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.HOSTEL_BED_DELETED, 'HostelBed', row.id, { before, after: row });
    return { id: row.id };
  }

  async assignWarden(tenantId: string, userId: string, dto: AssignHostelWardenDto) {
    const hostel = await this.findHostel(tenantId, dto.hostelId, true);
    const user = await this.db.user.findFirst({ where: { id: dto.userId }, select: { id: true } });
    if (!user) throw new NotFoundException('Warden user not found.');
    const existing = await this.db.hostelWarden.findFirst({
      where: { tenantId, hostelId: dto.hostelId, userId: dto.userId, role: dto.role },
    });
    if (existing) throw new ConflictException('This user is already assigned to this hostel in this role.');
    const row = await this.db.hostelWarden.create({
      data: { hostelId: dto.hostelId, userId: dto.userId, role: dto.role, assignedBy: userId },
    });
    // Mirror onto the hostel's primary warden when this is the first (or existing) WARDEN.
    if (dto.role === 'WARDEN' || !hostel.wardenUserId) {
      await this.db.hostel.update({ where: { id: hostel.id }, data: { wardenUserId: dto.userId, updatedBy: userId } });
    }
    await this.audit(tenantId, userId, AUDIT_ACTIONS.HOSTEL_WARDEN_ASSIGNED, 'HostelWarden', row.id, { after: row });
    return row;
  }

  async updateWarden(tenantId: string, userId: string, id: string, dto: UpdateHostelWardenDto) {
    const before = await this.db.hostelWarden.findFirst({ where: { id } });
    if (!before) throw new NotFoundException('Warden assignment not found.');
    const row = await this.db.hostelWarden.update({
      where: { id },
      data: {
        ...(dto.role !== undefined ? { role: dto.role } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.HOSTEL_WARDEN_UPDATED, 'HostelWarden', row.id, { before, after: row });
    return row;
  }

  async removeWarden(tenantId: string, userId: string, id: string) {
    const before = await this.db.hostelWarden.findFirst({ where: { id } });
    if (!before) throw new NotFoundException('Warden assignment not found.');
    const row = await this.db.hostelWarden.update({ where: { id }, data: { isActive: false } });
    // Clear the hostel's wardenUserId if it still points at the removed warden.
    const hostel = await this.db.hostel.findFirst({ where: { id: before.hostelId }, select: { id: true, wardenUserId: true } });
    if (hostel?.wardenUserId === before.userId) {
      const replacement = await this.db.hostelWarden.findFirst({
        where: { hostelId: before.hostelId, isActive: true, role: 'WARDEN', NOT: { id } },
        select: { userId: true },
      });
      await this.db.hostel.update({
        where: { id: hostel.id },
        data: { wardenUserId: replacement?.userId ?? null, updatedBy: userId },
      });
    }
    await this.audit(tenantId, userId, AUDIT_ACTIONS.HOSTEL_WARDEN_REMOVED, 'HostelWarden', row.id, { before, after: row });
    return { id: row.id };
  }

  // ── Bookings ──────────────────────────────────────────────────────────────

  async listBookings(tenantId: string, userId: string, query: ListHostelBookingsQueryDto) {
    const scope = await this.bookingScope(tenantId, userId);
    const where: any = {
      ...(scope ?? {}),
      ...(query.hostelId ? { hostelId: query.hostelId } : {}),
      ...(query.bedId ? { bedId: query.bedId } : {}),
      ...(query.studentId ? { studentId: query.studentId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    if (query.search?.trim()) {
      where.student = { ...(where.student ?? {}), OR: [{ fullName: { contains: query.search.trim(), mode: 'insensitive' } }, { admissionNumber: { contains: query.search.trim(), mode: 'insensitive' } }] };
    }
    const [data, total] = await Promise.all([
      this.db.studentHostelBooking.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip ?? 0,
        take: query.take ?? 50,
        include: bookingInclude,
      }),
      this.db.studentHostelBooking.count({ where }),
    ]);
    return { data, total };
  }

  async getBooking(tenantId: string, userId: string, id: string) {
    const scope = await this.bookingScope(tenantId, userId);
    const row = await this.db.studentHostelBooking.findFirst({
      where: { id, ...(scope ?? {}) },
      include: bookingInclude,
    });
    if (!row) throw new NotFoundException('Booking not found.');
    return row;
  }

  /** Builds the denormalized hostelName/roomNumber/bedNumber snapshot from a `findBed` row
   * (nested room.floor.building.hostel shape). */
  private roomLabelsFromBed(bed: any): { hostelName: string; roomNumber: string; bedNumber: string | null } {
    const room = bed.room;
    const floor = room?.floor;
    const building = floor?.building;
    const hostel = building?.hostel;
    return {
      hostelName: hostel?.name ?? '',
      roomNumber: [building?.name || building?.code, floor?.name || (floor?.floorNumber != null ? `Floor ${floor.floorNumber}` : null), room?.name || room?.code].filter(Boolean).join(' · '),
      bedNumber: bed?.code ?? null,
    };
  }

  async createBooking(tenantId: string, userId: string, dto: CreateHostelBookingDto) {
    const student = await this.findStudent(tenantId, dto.studentId);
    const bed = await this.findBed(tenantId, dto.bedId);
    if (bed.status !== 'AVAILABLE') {
      throw new ConflictException('This bed is not available right now.');
    }
    const status = (dto.status ?? (dto.allocationDate ? 'ALLOCATED' : 'REQUESTED')) as string;
    if (!['REQUESTED', 'ALLOCATED', 'CHECKED_IN'].includes(status)) {
      throw new BadRequestException('New bookings must start as REQUESTED, ALLOCATED, or CHECKED_IN.');
    }

    const monthlyRentCents = dto.monthlyRentCents ?? bed.monthlyRentCents ?? bed.room.monthlyRentCents ?? 0;

    const result = await this.db.$transaction(async (tx: Client) => {
      if (!(status === 'REQUESTED')) {
        const held = await tx.studentHostelBooking.findFirst({ where: { tenantId, bedId: bed.id, status: { in: BED_HELD_STATUSES as any } }, select: { id: true } });
        if (held) throw new ConflictException('This bed already has an active booking.');
        await this.assertStudentNoActiveBooking(tenantId, dto.studentId);
        await this.syncBookedBed(tx, tenantId, bed, status === 'CHECKED_IN' ? 'OCCUPIED' : 'RESERVED');
      }
      const label = this.roomLabelsFromBed(bed);
      const row = await tx.studentHostelBooking.create({
        data: {
          tenantId,
          studentId: dto.studentId,
          hostelId: bed.room.floor.building.hostelId,
          buildingId: bed.room.floor.buildingId,
          floorId: bed.room.floorId,
          roomId: bed.roomId,
          bedId: bed.id,
          hostelName: label.hostelName,
          roomNumber: label.roomNumber,
          bedNumber: label.bedNumber,
          status: status as any,
          allocationDate: dto.allocationDate ? new Date(dto.allocationDate) : status === 'ALLOCATED' || status === 'CHECKED_IN' ? new Date() : null,
          checkInDate: status === 'CHECKED_IN' ? new Date() : null,
          monthlyRentCents,
          remarks: dto.remarks,
          createdBy: userId,
        },
        include: bookingInclude,
      });
      return row;
    });

    await this.audit(tenantId, userId, AUDIT_ACTIONS.HOSTEL_BOOKING_ALLOCATED, 'StudentHostelBooking', result.id, { after: result });
    if (result.status === 'CHECKED_IN') {
      await this.notifyUser(tenantId, student.userId, 'Hostel check-in confirmed', `You are checked into ${result.hostelName} · ${result.roomNumber} ${result.bedNumber ? '· ' + result.bedNumber : ''}.`);
    }
    return result;
  }

  async updateBooking(tenantId: string, userId: string, id: string, dto: UpdateHostelBookingDto) {
    const before = await this.findBooking(tenantId, id);
    const row = await this.db.studentHostelBooking.update({
      where: { id },
      data: {
        ...(dto.status !== undefined ? { status: dto.status as any } : {}),
        ...(dto.allocationDate !== undefined ? { allocationDate: dto.allocationDate ? new Date(dto.allocationDate) : null } : {}),
        ...(dto.monthlyRentCents !== undefined ? { monthlyRentCents: dto.monthlyRentCents } : {}),
        ...(dto.remarks !== undefined ? { remarks: dto.remarks } : {}),
        updatedBy: userId,
      },
      include: bookingInclude,
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.STUDENT_HOSTEL_BOOKING_UPDATED, 'StudentHostelBooking', row.id, { before, after: row });
    return row;
  }

  async allocateBooking(tenantId: string, userId: string, id: string, dto: AllocateHostelBookingDto) {
    const booking = await this.findBooking(tenantId, id);
    if (booking.status !== 'REQUESTED') {
      throw new BadRequestException('Only REQUESTED bookings can be allocated.');
    }
    if (!booking.bedId) throw new BadRequestException('This booking has no bed assigned.');

    const result = await this.db.$transaction(async (tx: Client) => {
      const bed = await this.findBed(tenantId, booking.bedId!);
      if (bed.status !== 'AVAILABLE') throw new ConflictException('This bed is no longer available.');
      await this.assertStudentNoActiveBooking(tenantId, booking.studentId);
      await this.syncBookedBed(tx, tenantId, bed, 'RESERVED');
      return tx.studentHostelBooking.update({
        where: { id, tenantId },
        data: {
          status: 'ALLOCATED',
          allocationDate: dto.allocationDate ? new Date(dto.allocationDate) : new Date(),
          monthlyRentCents: dto.monthlyRentCents ?? booking.monthlyRentCents ?? bed.monthlyRentCents ?? bed.room.monthlyRentCents ?? 0,
          ...(dto.remarks !== undefined ? { remarks: dto.remarks } : {}),
          updatedBy: userId,
        },
        include: bookingInclude,
      });
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.HOSTEL_BOOKING_ALLOCATED, 'StudentHostelBooking', result.id, { after: result });
    return result;
  }

  async checkInBooking(tenantId: string, userId: string, id: string, dto: CheckInHostelBookingDto) {
    const booking = await this.findBooking(tenantId, id);
    if (!['REQUESTED', 'ALLOCATED'].includes(booking.status)) {
      throw new BadRequestException('Only REQUESTED or ALLOCATED bookings can be checked in.');
    }
    if (!booking.bedId) throw new BadRequestException('This booking has no bed assigned.');

    const result = await this.db.$transaction(async (tx: Client) => {
      const bed = await this.findBed(tenantId, booking.bedId!);
      if (bed.status === 'MAINTENANCE') throw new BadRequestException('Bed is under maintenance.');
      await this.syncBookedBed(tx, tenantId, bed, 'OCCUPIED');
      const row = await tx.studentHostelBooking.update({
        where: { id, tenantId },
        data: {
          status: 'CHECKED_IN',
          checkInDate: dto.checkInDate ? new Date(dto.checkInDate) : new Date(),
          ...(dto.remarks !== undefined ? { remarks: dto.remarks } : {}),
          updatedBy: userId,
        },
        include: bookingInclude,
      });
      if (dto.chargeFirstMonth ?? true) {
        const hostel = await this.findHostel(tenantId, row.hostelId!, true);
        if (hostel.chargeRentOnCheckIn) {
          await this.createChargeTx(tx, tenantId, userId, row, {
            monthCount: 1,
            remarks: 'First month rent charged at check-in.',
          } as any);
        }
      }
      return row;
    });

    await this.audit(tenantId, userId, AUDIT_ACTIONS.HOSTEL_BOOKING_CHECKED_IN, 'StudentHostelBooking', result.id, { after: result });
    const student = await this.findStudent(tenantId, result.studentId);
    await this.notifyUser(tenantId, student.userId, 'Hostel check-in confirmed', `Welcome to ${result.hostelName} — you are in ${result.roomNumber}${result.bedNumber ? ' · ' + result.bedNumber : ''}.`);
    return result;
  }

  async checkOutBooking(tenantId: string, userId: string, id: string, dto: CheckOutHostelBookingDto) {
    const booking = await this.findBooking(tenantId, id);
    if (!['REQUESTED', 'ALLOCATED', 'CHECKED_IN'].includes(booking.status)) {
      throw new BadRequestException('This booking cannot be checked out from its current state.');
    }
    const result = await this.db.$transaction(async (tx: Client) => {
      if (booking.bedId) await this.syncBookedBed(tx, tenantId, { id: booking.bedId as string }, 'AVAILABLE');
      return tx.studentHostelBooking.update({
        where: { id, tenantId },
        data: {
          status: 'CHECKED_OUT',
          checkOutDate: dto.checkOutDate ? new Date(dto.checkOutDate) : new Date(),
          ...(dto.remarks !== undefined ? { remarks: dto.remarks } : {}),
          updatedBy: userId,
        },
        include: bookingInclude,
      });
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.HOSTEL_BOOKING_CHECKED_OUT, 'StudentHostelBooking', result.id, { after: result });
    return result;
  }

  async cancelBooking(tenantId: string, userId: string, id: string, dto: CancelHostelBookingDto) {
    const booking = await this.findBooking(tenantId, id);
    if (!['REQUESTED', 'ALLOCATED'].includes(booking.status)) {
      throw new BadRequestException('Only REQUESTED or ALLOCATED bookings can be cancelled.');
    }
    const result = await this.db.$transaction(async (tx: Client) => {
      if (booking.bedId) await this.syncBookedBed(tx, tenantId, { id: booking.bedId as string }, 'AVAILABLE');
      return tx.studentHostelBooking.update({
        where: { id, tenantId },
        data: { status: 'CANCELLED', ...(dto.remarks !== undefined ? { remarks: dto.remarks } : {}), updatedBy: userId },
        include: bookingInclude,
      });
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.STUDENT_HOSTEL_BOOKING_CANCELLED, 'StudentHostelBooking', result.id, { after: result });
    return result;
  }

  async transferBooking(tenantId: string, userId: string, id: string, dto: TransferHostelBookingDto) {
    const old = await this.findBooking(tenantId, id);
    if (!['ALLOCATED', 'CHECKED_IN'].includes(old.status)) {
      throw new BadRequestException('Only ALLOCATED or CHECKED_IN bookings can be transferred.');
    }
    const newBed = await this.findBed(tenantId, dto.bedId);
    if (newBed.status !== 'AVAILABLE') throw new ConflictException('Target bed is not available.');
    const transferDate = dto.transferDate ? new Date(dto.transferDate) : new Date();

    const result = await this.db.$transaction(async (tx: Client) => {
      const held = await tx.studentHostelBooking.findFirst({ where: { tenantId, bedId: newBed.id, status: { in: BED_HELD_STATUSES as any } }, select: { id: true } });
      if (held) throw new ConflictException('Target bed already has an active booking.');

      await this.syncBookedBed(tx, tenantId, { id: newBed.id }, old.status === 'CHECKED_IN' ? 'OCCUPIED' : 'RESERVED');
      if (old.bedId) await this.syncBookedBed(tx, tenantId, { id: old.bedId }, 'AVAILABLE');

      const closed = await tx.studentHostelBooking.update({
        where: { id: old.id, tenantId },
        data: {
          status: 'CHECKED_OUT',
          checkOutDate: transferDate,
          remarks: dto.remarks ?? old.remarks ?? `Transferred to ${newBed.room?.floor?.building?.hostel?.name ?? ''} ${newBed.room.code} ${newBed.code}.`,
          updatedBy: userId,
        },
      });

      const label = this.roomLabelsFromBed(newBed);
      const created = await tx.studentHostelBooking.create({
        data: {
          tenantId,
          studentId: old.studentId,
          hostelId: newBed.room.floor.building.hostelId,
          buildingId: newBed.room.floor.buildingId,
          floorId: newBed.room.floorId,
          roomId: newBed.roomId,
          bedId: newBed.id,
          hostelName: label.hostelName,
          roomNumber: label.roomNumber,
          bedNumber: label.bedNumber,
          status: old.status,
          previousBookingId: old.id,
          allocationDate: old.allocationDate ?? transferDate,
          checkInDate: old.status === 'CHECKED_IN' ? transferDate : null,
          monthlyRentCents: dto.monthlyRentCents ?? old.monthlyRentCents ?? newBed.monthlyRentCents ?? newBed.room.monthlyRentCents ?? 0,
          remarks: dto.remarks,
          createdBy: userId,
        },
        include: bookingInclude,
      });
      return { closed, created };
    });

    await this.audit(tenantId, userId, AUDIT_ACTIONS.HOSTEL_BOOKING_TRANSFERRED, 'StudentHostelBooking', result.created.id, {
      before: { oldId: old.id, oldStatus: old.status, oldBed: old.bed?.code },
      after: { newId: result.created.id, newBed: newBed.code },
    });
    const student = await this.findStudent(tenantId, old.studentId);
    await this.notifyUser(tenantId, student.userId, 'Hostel room change', `You have been moved to ${result.created.hostelName} · ${result.created.roomNumber} ${result.created.bedNumber ?? ''}.`);
    return result;
  }

  // ── Rent charges ──────────────────────────────────────────────────────────

  /** Shared by the public charge endpoint and the on-check-in auto-charge path (tx-aware). */
  private async createChargeTx(tx: Client, tenantId: string, userId: string, booking: any, dto: CreateHostelChargeDto) {
    if (!['ALLOCATED', 'CHECKED_IN'].includes(booking.status)) {
      throw new BadRequestException('Rent can only be charged to an active booking.');
    }
    const rent = booking.monthlyRentCents ?? 0;
    const monthCount = dto.monthCount ?? 1;
    const amountCents = dto.amountCents ?? computeHostelChargeCents(rent, monthCount);
    if (amountCents <= 0) throw new BadRequestException('Charge amount must be greater than zero.');

    const hostel = booking.hostelId ? await this.findHostel(tenantId, booking.hostelId, true) : null;
    const head = hostel?.feeHeadId
      ? await tx.feeHead.findFirst({ where: { id: hostel.feeHeadId, tenantId, deletedAt: null }, select: { code: true, name: true } })
      : null;
    const headCode = dto.headCode ?? head?.code ?? FALLBACK_FEE_HEAD.code;
    const headName = dto.headName ?? head?.name ?? FALLBACK_FEE_HEAD.name;
    const period = hostelChargePeriod(dto.periodStart, monthCount);
    const remarks = [dto.remarks, `Hostel ${period.start.toISOString().slice(0, 10)} → ${period.end.toISOString().slice(0, 10)}`].filter(Boolean).join(' · ');

    return tx.studentFee.create({
      data: {
        tenantId,
        studentId: booking.studentId,
        hostelBookingId: booking.id,
        headCode,
        headName,
        amountCents,
        dueDate: new Date(period.start.getFullYear(), period.start.getMonth() + 1, 5),
        status: 'ISSUED',
        remarks,
        termId: null,
        createdBy: userId,
      },
    });
  }

  async createCharge(tenantId: string, userId: string, bookingId: string, dto: CreateHostelChargeDto) {
    const booking = await this.findBooking(tenantId, bookingId, true);
    const row = await this.createChargeTx(this.db, tenantId, userId, booking, dto);
    await this.audit(tenantId, userId, AUDIT_ACTIONS.HOSTEL_CHARGE_CREATED, 'StudentFee', row.id, { after: row });
    const student = await this.findStudent(tenantId, booking.studentId);
    await this.notifyUser(
      tenantId,
      student.userId,
      'Hostel rent charged',
      `A hostel rent charge of ₹${(row.amountCents / 100).toFixed(2)} was added to your fee ledger (${row.headName}).`,
    );
    return row;
  }

  async waiveCharge(tenantId: string, userId: string, id: string, dto: WaiveHostelChargeDto) {
    const fee = await this.db.studentFee.findFirst({ where: { id, hostelBookingId: { not: null } } });
    if (!fee) throw new NotFoundException('Hostel charge not found.');
    if (fee.status === 'PAID') throw new BadRequestException('Paid charges cannot be waived.');
    const before = fee;
    const row = await this.db.studentFee.update({
      where: { id },
      data: {
        status: 'WAIVED',
        remarks: [fee.remarks, dto.reason ? `Waived: ${dto.reason}` : 'Waived by hostel office.'].filter(Boolean).join(' · '),
        updatedBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.HOSTEL_CHARGE_WAIVED, 'StudentFee', row.id, { before, after: row });
    return row;
  }

  async listCharges(tenantId: string, userId: string, query: ListHostelChargesQueryDto) {
    const scope = await this.chargeScope(tenantId, userId);
    const where: any = {
      ...(scope ?? {}),
      hostelBookingId: { not: null },
      ...(query.status ? { status: query.status } : {}),
    };
    if (query.studentId) {
      where.studentId = query.studentId;
    }
    if (query.hostelId) {
      where.hostelBooking = { ...(where.hostelBooking ?? {}), hostelId: query.hostelId };
    }
    const [data, total] = await Promise.all([
      this.db.studentFee.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip ?? 0,
        take: query.take ?? 50,
        include: {
          student: { select: { id: true, fullName: true, admissionNumber: true } },
          hostelBooking: {
            select: {
              id: true,
              hostelId: true,
              roomId: true,
              roomNumber: true,
              hostel: { select: { id: true, name: true, code: true } },
            },
          },
        },
      }),
      this.db.studentFee.count({ where }),
    ]);
    return { data, total };
  }

  // ── Complaints ────────────────────────────────────────────────────────────

  async listComplaints(tenantId: string, userId: string, query: ListHostelComplaintsQueryDto) {
    const scope = await this.anchoredScope(tenantId, userId);
    const where: any = {
      ...(scope ?? {}),
      ...(query.hostelId ? { hostelId: query.hostelId } : {}),
      ...(query.studentId ? { studentId: query.studentId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.category ? { category: query.category } : {}),
    };
    const [data, total] = await Promise.all([
      this.db.hostelComplaint.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip ?? 0,
        take: query.take ?? 50,
        include: {
          hostel: { select: { id: true, name: true, code: true } },
          student: { select: { id: true, fullName: true, admissionNumber: true, userId: true } },
          room: { select: { id: true, code: true } },
        },
      }),
      this.db.hostelComplaint.count({ where }),
    ]);
    return { data, total };
  }

  async createComplaint(tenantId: string, userId: string, dto: CreateHostelComplaintDto) {
    const hostel = await this.findHostel(tenantId, dto.hostelId, true);
    if (dto.studentId) {
      const student = await this.db.student.findFirst({ where: { id: dto.studentId }, select: { id: true, userId: true } });
      if (!student) throw new NotFoundException('Student not found.');
    }
    const row = await this.db.hostelComplaint.create({
      data: {
        hostelId: dto.hostelId,
        studentId: dto.studentId,
        roomId: dto.roomId,
        category: dto.category as any,
        priority: dto.priority as any,
        subject: dto.subject,
        description: dto.description,
        assignedToUserId: hostel.wardenUserId,
        assignedAt: hostel.wardenUserId ? new Date() : null,
        createdBy: userId,
      },
      include: { hostel: { select: { id: true, name: true } }, student: { select: { fullName: true, userId: true } } },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.HOSTEL_COMPLAINT_CREATED, 'HostelComplaint', row.id, { after: row });
    await this.notifyUser(tenantId, hostel.wardenUserId, 'New hostel complaint', `${row.category} — ${row.subject}`);
    return row;
  }

  async updateComplaint(tenantId: string, userId: string, id: string, dto: UpdateHostelComplaintDto) {
    const before = await this.db.hostelComplaint.findFirst({ where: { id } });
    if (!before) throw new NotFoundException('Complaint not found.');
    const row = await this.db.hostelComplaint.update({
      where: { id },
      data: {
        ...(dto.category !== undefined ? { category: dto.category as any } : {}),
        ...(dto.priority !== undefined ? { priority: dto.priority as any } : {}),
        ...(dto.subject !== undefined ? { subject: dto.subject } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.roomId !== undefined ? { roomId: dto.roomId } : {}),
        updatedBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.HOSTEL_COMPLAINT_UPDATED, 'HostelComplaint', row.id, { before, after: row });
    return row;
  }

  async assignComplaint(tenantId: string, userId: string, id: string, dto: AssignHostelComplaintDto) {
    const before = await this.db.hostelComplaint.findFirst({ where: { id } });
    if (!before) throw new NotFoundException('Complaint not found.');
    const assignee = await this.db.user.findFirst({ where: { id: dto.assignedToUserId }, select: { id: true } });
    if (!assignee) throw new NotFoundException('Assignee user not found.');
    const row = await this.db.hostelComplaint.update({
      where: { id },
      data: { assignedToUserId: dto.assignedToUserId, assignedAt: new Date(), status: before.status === 'OPEN' ? 'IN_PROGRESS' : before.status, updatedBy: userId },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.HOSTEL_COMPLAINT_ASSIGNED, 'HostelComplaint', row.id, { before, after: row });
    await this.notifyUser(tenantId, dto.assignedToUserId, 'Complaint assigned to you', `${row.category} — ${row.subject}`);
    return row;
  }

  async resolveComplaint(tenantId: string, userId: string, id: string, dto: ResolveHostelComplaintDto) {
    const before = await this.db.hostelComplaint.findFirst({ where: { id } });
    if (!before) throw new NotFoundException('Complaint not found.');
    const row = await this.db.hostelComplaint.update({
      where: { id },
      data: {
        status: 'RESOLVED',
        resolvedByUserId: userId,
        resolutionNotes: dto.resolutionNotes ?? before.resolutionNotes,
        resolvedAt: new Date(),
        updatedBy: userId,
      },
      include: { student: { select: { userId: true } } },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.HOSTEL_COMPLAINT_RESOLVED, 'HostelComplaint', row.id, { before, after: row });
    await this.notifyUser(tenantId, row.student?.userId, 'Complaint resolved', `${row.category} — ${row.subject}`);
    return row;
  }

  async closeComplaint(tenantId: string, userId: string, id: string, dto: CloseHostelComplaintDto) {
    const before = await this.db.hostelComplaint.findFirst({ where: { id } });
    if (!before) throw new NotFoundException('Complaint not found.');
    const row = await this.db.hostelComplaint.update({
      where: { id },
      data: { status: 'CLOSED', closedAt: new Date(), ...(dto.resolutionNotes !== undefined ? { resolutionNotes: dto.resolutionNotes } : {}), updatedBy: userId },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.HOSTEL_COMPLAINT_CLOSED, 'HostelComplaint', row.id, { before, after: row });
    return row;
  }

  // ── Visitors ──────────────────────────────────────────────────────────────

  async listVisitors(tenantId: string, userId: string, query: ListHostelVisitorsQueryDto) {
    const scope = await this.anchoredScope(tenantId, userId);
    const where: any = {
      ...(scope ?? {}),
      ...(query.hostelId ? { hostelId: query.hostelId } : {}),
      ...(query.studentId ? { studentId: query.studentId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [data, total] = await Promise.all([
      this.db.hostelVisitor.findMany({
        where,
        orderBy: { checkInAt: 'desc' },
        skip: query.skip ?? 0,
        take: query.take ?? 50,
        include: {
          hostel: { select: { id: true, name: true, code: true } },
          student: { select: { id: true, fullName: true, admissionNumber: true } },
        },
      }),
      this.db.hostelVisitor.count({ where }),
    ]);
    return { data, total };
  }

  async createVisitor(tenantId: string, userId: string, dto: CreateHostelVisitorDto) {
    const hostel = await this.findHostel(tenantId, dto.hostelId, true);
    if (dto.studentId) {
      const student = await this.db.student.findFirst({ where: { id: dto.studentId }, select: { id: true } });
      if (!student) throw new NotFoundException('Student not found.');
    }
    if (!dto.studentId && !dto.visitorLabel) {
      throw new BadRequestException('Provide either the visited student or a free-text target label.');
    }
    const row = await this.db.hostelVisitor.create({
      data: {
        hostelId: dto.hostelId,
        visitorName: dto.visitorName,
        phone: dto.phone,
        email: dto.email,
        idProofType: dto.idProofType,
        idProofNumber: dto.idProofNumber,
        purpose: dto.purpose,
        studentId: dto.studentId,
        visitorLabel: dto.visitorLabel,
        checkInAt: new Date(),
        recordedByUserId: userId,
        notes: dto.notes,
      },
      include: { hostel: { select: { id: true, name: true } }, student: { select: { fullName: true } } },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.HOSTEL_VISITOR_LOGGED, 'HostelVisitor', row.id, { after: row });
    if (hostel.wardenUserId) {
      await this.notifyUser(tenantId, hostel.wardenUserId, 'Visitor in hostel', `${row.visitorName} checked in at ${hostel.name}.`);
    }
    return row;
  }

  async updateVisitor(tenantId: string, userId: string, id: string, dto: UpdateHostelVisitorDto) {
    const before = await this.db.hostelVisitor.findFirst({ where: { id } });
    if (!before) throw new NotFoundException('Visitor entry not found.');
    const row = await this.db.hostelVisitor.update({
      where: { id },
      data: {
        ...(dto.visitorName !== undefined ? { visitorName: dto.visitorName } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.purpose !== undefined ? { purpose: dto.purpose } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.HOSTEL_VISITOR_LOGGED, 'HostelVisitor', row.id, { before, after: row });
    return row;
  }

  async checkoutVisitor(tenantId: string, userId: string, id: string, dto: CheckOutHostelVisitorDto) {
    const before = await this.db.hostelVisitor.findFirst({ where: { id } });
    if (!before) throw new NotFoundException('Visitor entry not found.');
    if (before.status !== 'INSIDE') throw new BadRequestException('This visitor has already exited.');
    const row = await this.db.hostelVisitor.update({
      where: { id },
      data: {
        status: 'EXITED',
        checkOutAt: dto.checkOutAt ? new Date(dto.checkOutAt) : new Date(),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.HOSTEL_VISITOR_CHECKED_OUT, 'HostelVisitor', row.id, { before, after: row });
    return row;
  }

  // ── Reports ───────────────────────────────────────────────────────────────

  async reportSummary(tenantId: string, userId: string, hostelId?: string) {
    const scope = await this.studentScope(tenantId, userId);
    const hostelWhere: any = { deletedAt: null, ...(hostelId ? { id: hostelId } : {}) };
    const hostels = await this.db.hostel.findMany({
      where: hostelWhere,
      orderBy: { name: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        genderType: true,
        campusId: true,
        wardenUserId: true,
        buildings: { select: { id: true, floors: { select: { id: true, rooms: { select: { id: true, beds: { select: { status: true } } } } } } } },
        complaints: { where: { status: { notIn: ['CLOSED', 'RESOLVED'] } }, select: { id: true } },
        visitors: { where: { status: 'INSIDE' }, select: { id: true } },
        bookings: { where: { status: { in: ACTIVE_BOOKING_STATUSES as any } }, select: { id: true } },
      },
    });

    const scopeWhereBooking = scope ? { student: scope } : {};
    const activeBookingCounts = scope
      ? await this.db.studentHostelBooking.groupBy({
          by: ['hostelId'],
          where: { ...scopeWhereBooking, status: { in: ACTIVE_BOOKING_STATUSES as any }, ...(hostelId ? { hostelId } : {}) },
          _count: { _all: true },
        })
      : [];

    const rows = hostels.map((h: any) => {
      let totalBeds = 0;
      let availableBeds = 0;
      let reservedBeds = 0;
      let occupiedBeds = 0;
      let maintenanceBeds = 0;
      let totalRooms = 0;
      let totalFloors = 0;
      let totalBuildings = h.buildings.length;
      for (const b of h.buildings) {
        for (const f of b.floors) {
          totalFloors += 1;
          for (const r of f.rooms) {
            totalRooms += 1;
            for (const bed of r.beds) {
              totalBeds += 1;
              if (bed.status === 'AVAILABLE') availableBeds += 1;
              else if (bed.status === 'RESERVED') reservedBeds += 1;
              else if (bed.status === 'OCCUPIED') occupiedBeds += 1;
              else if (bed.status === 'MAINTENANCE') maintenanceBeds += 1;
            }
          }
        }
      }
      const scopeCount = activeBookingCounts.find((c: any) => c.hostelId === h.id)?._count._all ?? 0;
      return {
        hostelId: h.id,
        code: h.code,
        name: h.name,
        genderType: h.genderType,
        campusId: h.campusId,
        totalBuildings,
        totalFloors,
        totalRooms,
        totalBeds,
        availableBeds,
        reservedBeds,
        occupiedBeds,
        maintenanceBeds,
        occupancyRate: totalBeds ? Math.round(((occupiedBeds + reservedBeds) / totalBeds) * 100) : 0,
        activeBookings: scope ? scopeCount : h.bookings.length,
        openComplaints: h.complaints.length,
        visitorsInside: h.visitors.length,
        _count: { complaints: h.complaints.length, bookings: h.bookings.length },
      };
    });

    const totals = rows.reduce(
      (acc: any, r: any) => {
        acc.totalBuildings += r.totalBuildings;
        acc.totalFloors += r.totalFloors;
        acc.totalRooms += r.totalRooms;
        acc.totalBeds += r.totalBeds;
        acc.availableBeds += r.availableBeds;
        acc.reservedBeds += r.reservedBeds;
        acc.occupiedBeds += r.occupiedBeds;
        acc.maintenanceBeds += r.maintenanceBeds;
        acc.activeBookings += r.activeBookings;
        acc.openComplaints += r.openComplaints;
        acc.visitorsInside += r.visitorsInside;
        return acc;
      },
      {
        hostelId: null,
        code: 'ALL',
        name: 'All hostels',
        totalBuildings: 0,
        totalFloors: 0,
        totalRooms: 0,
        totalBeds: 0,
        availableBeds: 0,
        reservedBeds: 0,
        occupiedBeds: 0,
        maintenanceBeds: 0,
        occupancyRate: 0,
        activeBookings: 0,
        openComplaints: 0,
        visitorsInside: 0,
      },
    );
    if (totals.totalBeds) totals.occupancyRate = Math.round(((totals.occupiedBeds + totals.reservedBeds) / totals.totalBeds) * 100);

    return { hostels: rows, totals };
  }

  async reportOccupancy(tenantId: string, userId: string, query: { hostelId?: string; roomId?: string }) {
    const scope = await this.bookingScope(tenantId, userId);
    const where: any = {
      ...(scope ?? {}),
      status: { in: ACTIVE_BOOKING_STATUSES as any },
      ...(query.hostelId ? { hostelId: query.hostelId } : {}),
      ...(query.roomId ? { roomId: query.roomId } : {}),
    };
    const bookings = await this.db.studentHostelBooking.findMany({
      where,
      orderBy: { checkInDate: 'asc' },
      include: bookingInclude,
    });
    const beds = await this.db.hostelBed.findMany({
      where: { status: { in: ['OCCUPIED', 'RESERVED'] }, deletedAt: null, ...(query.roomId ? { roomId: query.roomId } : {}) },
      select: { id: true, code: true, status: true, room: { select: { id: true, code: true, floor: { select: { id: true, floorNumber: true, name: true, building: { select: { id: true, code: true, name: true, hostel: { select: { id: true, code: true, name: true } } } } } } } } },
      orderBy: { code: 'asc' },
    });
    return { bookings, beds, total: bookings.length };
  }

  async reportVacancy(tenantId: string, userId: string, query: { hostelId?: string; buildingId?: string }) {
    const scope = await this.studentScope(tenantId, userId);
    const bookingScopeWhere = scope ? { student: scope } : {};
    const where: any = {
      status: 'AVAILABLE',
      isActive: true,
      deletedAt: null,
      bookings: { none: { status: { in: BED_HELD_STATUSES as any }, ...bookingScopeWhere } },
      ...(query.hostelId ? { room: { floor: { building: { hostelId: query.hostelId } } } } : {}),
      ...(query.buildingId ? { room: { floor: { buildingId: query.buildingId } } } : {}),
    };
    const beds = await this.db.hostelBed.findMany({
      where,
      select: {
        id: true,
        code: true,
        monthlyRentCents: true,
        room: {
          select: {
            id: true,
            code: true,
            name: true,
            sharing: true,
            floor: {
              select: {
                id: true,
                floorNumber: true,
                name: true,
                building: { select: { id: true, code: true, name: true, hostel: { select: { id: true, code: true, name: true } } } },
              },
            },
          },
        },
      },
      orderBy: { code: 'asc' },
      take: 300,
    });
    return { data: beds, total: beds.length };
  }

  async roomHistory(tenantId: string, userId: string, roomId: string, take?: number) {
    await this.findRoom(tenantId, roomId, true);
    const scope = await this.bookingScope(tenantId, userId);
    const where: any = { ...(scope ?? {}), roomId };
    const bookings = await this.db.studentHostelBooking.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: take ?? 50,
      include: bookingInclude,
    });
    return { roomId, data: bookings, total: bookings.length };
  }

  async studentHistory(tenantId: string, userId: string, studentId: string, take?: number) {
    const scope = await this.bookingScope(tenantId, userId);
    const where: any = { ...(scope ?? {}), studentId };
    const bookings = await this.db.studentHostelBooking.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: take ?? 50,
      include: bookingInclude,
    });
    return { studentId, data: bookings, total: bookings.length };
  }

  async reportDues(tenantId: string, userId: string, query: HostelDuesQueryDto) {
    const scope = await this.chargeScope(tenantId, userId);
    const openStatuses = query.status ?? 'ISSUED';
    const where: any = {
      ...(scope ?? {}),
      hostelBookingId: { not: null },
      status: Array.isArray(openStatuses) ? { in: openStatuses } : { in: (openStatuses as string).split(',') },
      ...(query.hostelId ? { hostelBooking: { hostelId: query.hostelId } } : {}),
    };
    const fees = await this.db.studentFee.findMany({
      where,
      orderBy: { dueDate: 'asc' },
      include: {
        student: { select: { id: true, fullName: true, admissionNumber: true } },
        hostelBooking: {
          select: {
            id: true,
            roomNumber: true,
            bedNumber: true,
            hostel: { select: { id: true, code: true, name: true } },
          },
        },
      },
    });
    const totalDueCents = fees.reduce((sum: number, f: any) => sum + Math.max(0, f.amountCents - f.paidCents - f.waivedCents), 0);
    return { data: fees, total: fees.length, totalDueCents };
  }

  async reportComplaints(tenantId: string, userId: string, hostelId?: string) {
    await this.grants(tenantId, userId); // validate the viewer is entitled before returning aggregates
    const where: any = { ...(hostelId ? { hostelId } : {}) };
    const [byStatus, byCategory, byPriority, total] = await Promise.all([
      this.db.hostelComplaint.groupBy({ by: ['status'], where, _count: { _all: true }, orderBy: { status: 'asc' } }) as any,
      this.db.hostelComplaint.groupBy({ by: ['category'], where, _count: { _all: true }, orderBy: { category: 'asc' } }) as any,
      this.db.hostelComplaint.groupBy({ by: ['priority'], where, _count: { _all: true }, orderBy: { priority: 'asc' } }) as any,
      this.db.hostelComplaint.count({ where }),
    ]);
    return {
      total,
      byStatus: byStatus.map((g: any) => ({ status: g.status, count: g._count._all })),
      byCategory: byCategory.map((g: any) => ({ category: g.category, count: g._count._all })),
      byPriority: byPriority.map((g: any) => ({ priority: g.priority, count: g._count._all })),
    };
  }
}