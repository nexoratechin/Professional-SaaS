/**
 * Transport service â€” the full school-transport module: fleet (vehicles + their documents),
 * drivers (+ driverâ†”vehicle assignment ledger), routes & ordered stops, student passes/route
 * allocation (the existing StudentTransportPass, now FK-linked) with fees written through the
 * shared StudentFee ledger (transportPassId), trip runs with per-stop checkpoints, maintenance
 * records, alerts, GPS config surface, and reports. Catalog reads are shared tenant resources
 * (any transport.view); pass/charge rows are scoped via the transport.view grants exactly like
 * the hostel module. Every mutation lands an audit event (module 'transport').
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
import { transportChargeWhereInput, transportPassWhereInput, transportStudentWhereInput } from './transport-scope';
import { computeTransportChargeCents, transportChargePeriod } from './transport-fees';
import { TransportGpsService } from './gps/transport-gps.service';
import {
  AcknowledgeAlertDto,
  AssignDriverDto,
  CancelTripDto,
  ChargePassDto,
  CreateAlertDto,
  CreateDriverDto,
  CreateMaintenanceDto,
  CreatePassDto,
  CreateRouteDto,
  CreateStopDto,
  CreateTripDto,
  CreateVehicleDocumentDto,
  CreateVehicleDto,
  DuesReportQueryDto,
  ListAlertsQueryDto,
  ListDriversQueryDto,
  ListMaintenanceQueryDto,
  ListPassesQueryDto,
  ListRoutesQueryDto,
  ListTripsQueryDto,
  ListVehiclesQueryDto,
  ReorderStopsDto,
  ResolveAlertDto,
  RouteLoadReportQueryDto,
  SetMaintenanceStatusDto,
  SetPassStatusDto,
  SetVehicleStatusDto,
  TripStopCheckpointDto,
  UpdateDriverDto,
  UpdateMaintenanceDto,
  UpdatePassDto,
  UpdateRouteDto,
  UpdateStopDto,
  UpdateVehicleDocumentDto,
  UpdateVehicleDto,
  VehicleUtilizationReportQueryDto,
  WaiveTransportChargeDto,
} from './dto/transport.dto';

type Client = Prisma.TransactionClient;

const FALLBACK_FEE_HEAD = { code: 'transport_fee', name: 'Transport Fee' };
const PASS_ACTIVE_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;

const passInclude = {
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
  route: { select: { id: true, code: true, name: true, monthlyFeeCents: true } },
  stop: { select: { id: true, name: true, address: true } },
  dropStop: { select: { id: true, name: true, address: true } },
  vehicle: { select: { id: true, registrationNumber: true, type: true } },
  driver: { select: { id: true, name: true, licenseNumber: true } },
} as const;

@Injectable()
export class TransportService {
  private readonly logger = new Logger(TransportService.name);

  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditService: AuditService,
    private readonly permissionsService: PermissionsService,
    private readonly notifications: NotificationsService,
    private readonly gpsService: TransportGpsService,
  ) {}

  private get db(): any {
    return this.tenantPrisma.client;
  }

  // â”€â”€ Shared helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private async grants(tenantId: string, userId: string) {
    return this.permissionsService.getScopeGrantsFor(tenantId, userId, 'transport.view');
  }

  private async passScope(tenantId: string, userId: string) {
    return transportPassWhereInput(await this.grants(tenantId, userId), userId);
  }

  private async chargeScope(tenantId: string, userId: string) {
    return transportChargeWhereInput(await this.grants(tenantId, userId), userId);
  }

  private async audit(
    tenantId: string,
    userId: string,
    action: string,
    entityType: string,
    entityId: string | undefined,
    extra?: { before?: unknown; after?: unknown },
  ) {
    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId: userId,
      action,
      module: AUDIT_MODULES.TRANSPORT,
      entityType,
      entityId,
      before: extra?.before,
      after: extra?.after,
    });
  }

  // â”€â”€ Lookups â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async lookups(_tenantId: string) {
    const [campuses, vehicles, drivers, routes, stops, feeHeads] = await Promise.all([
      this.db.campus.findMany({
        where: { deletedAt: null, isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, code: true, name: true },
      }),
      this.db.transportVehicle.findMany({
        where: { deletedAt: null },
        orderBy: { registrationNumber: 'asc' },
        select: { id: true, registrationNumber: true, make: true, model: true, type: true, status: true },
      }),
      this.db.transportDriver.findMany({
        where: { deletedAt: null },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, licenseNumber: true, status: true },
      }),
      this.db.transportRoute.findMany({
        where: { deletedAt: null },
        orderBy: { code: 'asc' },
        select: { id: true, code: true, name: true, vehicleId: true, monthlyFeeCents: true, status: true },
      }),
      this.db.transportStop.findMany({
        where: { deletedAt: null, isActive: true },
        orderBy: { routeId: 'asc' },
        select: { id: true, routeId: true, name: true, type: true, latitude: true, longitude: true },
      }),
      this.db.feeHead.findMany({
        where: { deletedAt: null, isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, code: true, name: true },
      }),
    ]);
    return {
      campuses,
      vehicles,
      drivers,
      routes,
      stops,
      feeHeads,
      vehicleTypes: ['BUS', 'VAN', 'MINIBUS', 'CAR', 'OTHER'],
      vehicleStatuses: ['ACTIVE', 'IN_SERVICE', 'OUT_OF_SERVICE', 'SCRAPPED'],
      documentTypes: ['REGISTRATION', 'INSURANCE', 'FITNESS', 'PERMIT', 'POLLUTION', 'TAX_RECEIPT', 'INSPECTION', 'OTHER'],
      documentStatuses: ['VALID', 'EXPIRED', 'EXPIRING_SOON', 'REVOKED'],
      routeStatuses: ['ACTIVE', 'INACTIVE', 'SUSPENDED'],
      stopTypes: ['PICKUP', 'DROP', 'PICKUP_AND_DROP'],
      driverStatuses: ['ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'INACTIVE'],
      tripStatuses: ['SCHEDULED', 'ONGOING', 'COMPLETED', 'CANCELLED'],
      maintenanceTypes: ['PREVENTIVE', 'CORRECTIVE', 'EMERGENCY', 'INSPECTION'],
      maintenanceStatuses: ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
      alertTypes: [
        'SPEEDING',
        'OFF_ROUTE',
        'GEOFENCE_EXIT',
        'GEOFENCE_ENTER',
        'UNPLANNED_STOP',
        'ENGINE',
        'FUEL_LOW',
        'DELAYED',
        'MAINTENANCE_DUE',
        'DOCUMENT_EXPIRING',
        'OTHER',
      ],
      alertSeverities: ['INFO', 'WARNING', 'CRITICAL'],
      passStatuses: ['ACTIVE', 'EXPIRED', 'SUSPENDED', 'CANCELLED'],
      feeStatuses: ['ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'WAIVED', 'REFUNDED'],
    };
  }

  async searchUsers(tenantId: string, userId: string, search?: string) {
    const where: any = {
      AND: [
        { tenantId },
        ...(search?.trim()
          ? [{ OR: [
              { fullName: { contains: search.trim(), mode: 'insensitive' } },
              { email: { contains: search.trim(), mode: 'insensitive' } },
            ] }]
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

  async searchStudents(tenantId: string, userId: string, search?: string) {
    const scope = await transportStudentWhereInput(await this.grants(tenantId, userId), userId);
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

  // â”€â”€ Vehicles â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async listVehicles(tenantId: string, query: ListVehiclesQueryDto) {
    const where: any = {
      deletedAt: null,
      ...(query.includeInactive ? {} : { status: { not: 'SCRAPPED' } }),
      ...(query.campusId ? { campusId: query.campusId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    if (query.search?.trim()) {
      where.OR = [
        { registrationNumber: { contains: query.search.trim(), mode: 'insensitive' } },
        { make: { contains: query.search.trim(), mode: 'insensitive' } },
        { model: { contains: query.search.trim(), mode: 'insensitive' } },
      ];
    }
    const [data, total] = await Promise.all([
      this.db.transportVehicle.findMany({
        where,
        orderBy: { registrationNumber: 'asc' },
        skip: query.skip ?? 0,
        take: query.take ?? 50,
        include: {
          campus: { select: { id: true, name: true } },
          documents: { select: { id: true, documentType: true, status: true, expiryDate: true } },
          _count: { select: { trips: true, maintenanceRecords: true, alerts: true } },
        },
      }),
      this.db.transportVehicle.count({ where }),
    ]);
    return { data, total };
  }

  async getVehicle(tenantId: string, id: string) {
    const vehicle = await this.db.transportVehicle.findFirst({
      where: { id, deletedAt: null },
      include: {
        campus: { select: { id: true, name: true } },
        documents: { orderBy: { createdAt: 'desc' } },
        driverAssignments: {
          orderBy: { assignedAt: 'desc' },
          include: { driver: { select: { id: true, name: true, licenseNumber: true } } },
        },
        routes: { where: { deletedAt: null }, select: { id: true, code: true, name: true } },
        maintenanceRecords: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!vehicle) throw new NotFoundException('Vehicle not found.');
    const latestPosition = await this.db.transportGPSPosition.findFirst({
      where: { vehicleId: id },
      orderBy: { recordedAt: 'desc' },
      select: { latitude: true, longitude: true, speedKmh: true, recordedAt: true },
    });
    return { ...vehicle, latestPosition };
  }

  async createVehicle(tenantId: string, userId: string, dto: CreateVehicleDto) {
    const existing = await this.db.transportVehicle.findFirst({
      where: { tenantId, registrationNumber: dto.registrationNumber, deletedAt: null },
      select: { id: true },
    });
    if (existing) throw new ConflictException('A vehicle with this registration number already exists.');
    if (dto.campusId) {
      const campus = await this.db.campus.findFirst({ where: { id: dto.campusId, deletedAt: null }, select: { id: true } });
      if (!campus) throw new NotFoundException('Campus not found.');
    }
    const row = await this.db.transportVehicle.create({
      data: {
        campusId: dto.campusId,
        type: dto.type ?? 'BUS',
        registrationNumber: dto.registrationNumber,
        chassisNumber: dto.chassisNumber,
        engineNumber: dto.engineNumber,
        make: dto.make,
        model: dto.model,
        yearOfManufacture: dto.yearOfManufacture,
        fuelType: dto.fuelType,
        seatingCapacity: dto.seatingCapacity,
        standingCapacity: dto.standingCapacity,
        isAc: dto.isAc ?? false,
        gpsDeviceId: dto.gpsDeviceId,
        status: dto.status ?? 'IN_SERVICE',
        createdBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.TRANSPORT_VEHICLE_CREATED, 'TransportVehicle', row.id, { after: row });
    return row;
  }

  async updateVehicle(tenantId: string, userId: string, id: string, dto: UpdateVehicleDto) {
    const before = await this.db.transportVehicle.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundException('Vehicle not found.');
    if (dto.registrationNumber && dto.registrationNumber !== before.registrationNumber) {
      const existing = await this.db.transportVehicle.findFirst({
        where: { tenantId, registrationNumber: dto.registrationNumber, deletedAt: null, NOT: { id } },
        select: { id: true },
      });
      if (existing) throw new ConflictException('A vehicle with this registration number already exists.');
    }
    const row = await this.db.transportVehicle.update({
      where: { id },
      data: {
        ...(dto.campusId !== undefined ? { campusId: dto.campusId } : {}),
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.registrationNumber !== undefined ? { registrationNumber: dto.registrationNumber } : {}),
        ...(dto.chassisNumber !== undefined ? { chassisNumber: dto.chassisNumber } : {}),
        ...(dto.engineNumber !== undefined ? { engineNumber: dto.engineNumber } : {}),
        ...(dto.make !== undefined ? { make: dto.make } : {}),
        ...(dto.model !== undefined ? { model: dto.model } : {}),
        ...(dto.yearOfManufacture !== undefined ? { yearOfManufacture: dto.yearOfManufacture } : {}),
        ...(dto.fuelType !== undefined ? { fuelType: dto.fuelType } : {}),
        ...(dto.seatingCapacity !== undefined ? { seatingCapacity: dto.seatingCapacity } : {}),
        ...(dto.standingCapacity !== undefined ? { standingCapacity: dto.standingCapacity } : {}),
        ...(dto.isAc !== undefined ? { isAc: dto.isAc } : {}),
        ...(dto.gpsDeviceId !== undefined ? { gpsDeviceId: dto.gpsDeviceId } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        updatedBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.TRANSPORT_VEHICLE_UPDATED, 'TransportVehicle', row.id, { before, after: row });
    return row;
  }

  async setVehicleStatus(tenantId: string, userId: string, id: string, dto: SetVehicleStatusDto) {
    const before = await this.db.transportVehicle.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundException('Vehicle not found.');
    const row = await this.db.transportVehicle.update({ where: { id }, data: { status: dto.status, updatedBy: userId } });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.TRANSPORT_VEHICLE_STATUS_CHANGED, 'TransportVehicle', row.id, { before, after: row });
    return row;
  }

  async deleteVehicle(tenantId: string, userId: string, id: string) {
    const before = await this.db.transportVehicle.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundException('Vehicle not found.');
    const row = await this.db.transportVehicle.update({ where: { id }, data: { deletedAt: new Date(), status: 'SCRAPPED', updatedBy: userId } });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.TRANSPORT_VEHICLE_DELETED, 'TransportVehicle', row.id, { before, after: row });
    return { id: row.id };
  }

  // â”€â”€ Vehicle documents â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async listVehicleDocuments(tenantId: string, vehicleId: string) {
    await this.findVehicle(tenantId, vehicleId);
    return this.db.transportVehicleDocument.findMany({
      where: { vehicleId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createVehicleDocument(tenantId: string, userId: string, vehicleId: string, dto: CreateVehicleDocumentDto) {
    await this.findVehicle(tenantId, vehicleId);
    const row = await this.db.transportVehicleDocument.create({
      data: {
        tenantId,
        vehicleId,
        documentType: dto.documentType,
        documentNumber: dto.documentNumber,
        issueDate: dto.issueDate ? new Date(dto.issueDate) : null,
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
        issuer: dto.issuer,
        storageKey: dto.storageKey,
        originalFilename: dto.originalFilename,
        mimeType: dto.mimeType,
        sizeBytes: dto.sizeBytes,
        status: dto.status ?? 'VALID',
        remarks: dto.remarks,
        createdBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.TRANSPORT_VEHICLE_DOCUMENT_CREATED, 'TransportVehicleDocument', row.id, { after: row });
    return row;
  }

  async updateVehicleDocument(tenantId: string, userId: string, id: string, dto: UpdateVehicleDocumentDto) {
    const before = await this.db.transportVehicleDocument.findFirst({ where: { id } });
    if (!before) throw new NotFoundException('Document not found.');
    const row = await this.db.transportVehicleDocument.update({
      where: { id },
      data: {
        ...(dto.documentType !== undefined ? { documentType: dto.documentType } : {}),
        ...(dto.documentNumber !== undefined ? { documentNumber: dto.documentNumber } : {}),
        ...(dto.issueDate !== undefined ? { issueDate: dto.issueDate ? new Date(dto.issueDate) : null } : {}),
        ...(dto.expiryDate !== undefined ? { expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null } : {}),
        ...(dto.issuer !== undefined ? { issuer: dto.issuer } : {}),
        ...(dto.storageKey !== undefined ? { storageKey: dto.storageKey } : {}),
        ...(dto.originalFilename !== undefined ? { originalFilename: dto.originalFilename } : {}),
        ...(dto.mimeType !== undefined ? { mimeType: dto.mimeType } : {}),
        ...(dto.sizeBytes !== undefined ? { sizeBytes: dto.sizeBytes } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.remarks !== undefined ? { remarks: dto.remarks } : {}),
        updatedBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.TRANSPORT_VEHICLE_DOCUMENT_UPDATED, 'TransportVehicleDocument', row.id, { before, after: row });
    return row;
  }

  async deleteVehicleDocument(tenantId: string, userId: string, id: string) {
    const before = await this.db.transportVehicleDocument.findFirst({ where: { id } });
    if (!before) throw new NotFoundException('Document not found.');
    await this.db.transportVehicleDocument.delete({ where: { id } });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.TRANSPORT_VEHICLE_DOCUMENT_DELETED, 'TransportVehicleDocument', id, { before });
    return { id };
  }

  // â”€â”€ Drivers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async listDrivers(tenantId: string, query: ListDriversQueryDto) {
    const where: any = {
      deletedAt: null,
      ...(query.includeInactive ? {} : { status: 'ACTIVE' }),
      ...(query.status ? { status: query.status } : {}),
    };
    if (query.search?.trim()) {
      where.OR = [
        { name: { contains: query.search.trim(), mode: 'insensitive' } },
        { licenseNumber: { contains: query.search.trim(), mode: 'insensitive' } },
        { phone: { contains: query.search.trim(), mode: 'insensitive' } },
      ];
    }
    const [data, total] = await Promise.all([
      this.db.transportDriver.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: query.skip ?? 0,
        take: query.take ?? 50,
        include: {
          assignments: {
            where: { isActive: true },
            include: { vehicle: { select: { id: true, registrationNumber: true } } },
          },
          user: { select: { id: true, fullName: true } },
        },
      }),
      this.db.transportDriver.count({ where }),
    ]);
    return { data, total };
  }

  async getDriver(tenantId: string, id: string) {
    const driver = await this.db.transportDriver.findFirst({
      where: { id, deletedAt: null },
      include: {
        assignments: { orderBy: { assignedAt: 'desc' }, include: { vehicle: { select: { id: true, registrationNumber: true } } } },
        user: { select: { id: true, fullName: true, email: true } },
        trips: { orderBy: { date: 'desc' }, take: 20, include: { route: { select: { id: true, code: true, name: true } } } },
      },
    });
    if (!driver) throw new NotFoundException('Driver not found.');
    return driver;
  }

  async createDriver(tenantId: string, userId: string, dto: CreateDriverDto) {
    const existing = await this.db.transportDriver.findFirst({
      where: { tenantId, licenseNumber: dto.licenseNumber, deletedAt: null },
      select: { id: true },
    });
    if (existing) throw new ConflictException('A driver with this license number already exists.');
    const row = await this.db.transportDriver.create({
      data: {
        tenantId,
        userId: dto.userId ?? null,
        name: dto.name,
        phone: dto.phone,
        alternatePhone: dto.alternatePhone,
        email: dto.email,
        licenseNumber: dto.licenseNumber,
        licenseClass: dto.licenseClass,
        licenseExpiry: dto.licenseExpiry ? new Date(dto.licenseExpiry) : null,
        profilePhotoKey: dto.profilePhotoKey,
        joinedAt: dto.joinedAt ? new Date(dto.joinedAt) : null,
        status: dto.status ?? 'ACTIVE',
        notes: dto.notes,
        createdBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.TRANSPORT_DRIVER_CREATED, 'TransportDriver', row.id, { after: row });
    return row;
  }

  async updateDriver(tenantId: string, userId: string, id: string, dto: UpdateDriverDto) {
    const before = await this.db.transportDriver.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundException('Driver not found.');
    if (dto.licenseNumber && dto.licenseNumber !== before.licenseNumber) {
      const existing = await this.db.transportDriver.findFirst({
        where: { tenantId, licenseNumber: dto.licenseNumber, deletedAt: null, NOT: { id } },
        select: { id: true },
      });
      if (existing) throw new ConflictException('A driver with this license number already exists.');
    }
    const row = await this.db.transportDriver.update({
      where: { id },
      data: {
        ...(dto.userId !== undefined ? { userId: dto.userId ?? null } : {}),
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.alternatePhone !== undefined ? { alternatePhone: dto.alternatePhone } : {}),
        ...(dto.email !== undefined ? { email: dto.email } : {}),
        ...(dto.licenseNumber !== undefined ? { licenseNumber: dto.licenseNumber } : {}),
        ...(dto.licenseClass !== undefined ? { licenseClass: dto.licenseClass } : {}),
        ...(dto.licenseExpiry !== undefined ? { licenseExpiry: dto.licenseExpiry ? new Date(dto.licenseExpiry) : null } : {}),
        ...(dto.profilePhotoKey !== undefined ? { profilePhotoKey: dto.profilePhotoKey } : {}),
        ...(dto.joinedAt !== undefined ? { joinedAt: dto.joinedAt ? new Date(dto.joinedAt) : null } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        updatedBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.TRANSPORT_DRIVER_UPDATED, 'TransportDriver', row.id, { before, after: row });
    return row;
  }

  async deleteDriver(tenantId: string, userId: string, id: string) {
    const before = await this.db.transportDriver.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundException('Driver not found.');
    const row = await this.db.transportDriver.update({ where: { id }, data: { deletedAt: new Date(), status: 'INACTIVE', updatedBy: userId } });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.TRANSPORT_DRIVER_DELETED, 'TransportDriver', row.id, { before, after: row });
    return { id: row.id };
  }

  async assignDriver(tenantId: string, userId: string, id: string, dto: AssignDriverDto) {
    await this.findDriver(tenantId, id);
    const vehicle = await this.findVehicle(tenantId, dto.vehicleId);
    await this.db.transportDriverAssignment.updateMany({
      where: { driverId: id, isActive: true },
      data: { isActive: false, releasedAt: new Date() },
    });
    const row = await this.db.transportDriverAssignment.create({
      data: {
        tenantId,
        driverId: id,
        vehicleId: vehicle.id,
        isActive: true,
        assignedAt: new Date(),
        remarks: dto.remarks,
        createdBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.TRANSPORT_DRIVER_ASSIGNED, 'TransportDriverAssignment', row.id, { after: row });
    return row;
  }

  async releaseDriver(tenantId: string, userId: string, id: string, dto: AssignDriverDto) {
    await this.findDriver(tenantId, id);
    const row = await this.db.transportDriverAssignment.updateMany({
      where: { driverId: id, vehicleId: dto.vehicleId, isActive: true },
      data: { isActive: false, releasedAt: new Date(), updatedBy: userId },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.TRANSPORT_DRIVER_RELEASED, 'TransportDriverAssignment', dto.vehicleId, { after: { released: row.count } });
    return { released: row.count };
  }

  // â”€â”€ Routes & stops â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async listRoutes(tenantId: string, query: ListRoutesQueryDto) {
    const where: any = {
      deletedAt: null,
      ...(query.includeInactive ? {} : { isActive: true }),
      ...(query.campusId ? { campusId: query.campusId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    if (query.search?.trim()) {
      where.OR = [
        { code: { contains: query.search.trim(), mode: 'insensitive' } },
        { name: { contains: query.search.trim(), mode: 'insensitive' } },
      ];
    }
    const include: any = {
      campus: { select: { id: true, name: true } },
      vehicle: { select: { id: true, registrationNumber: true } },
      _count: { select: { stops: true, trips: true, passAssignments: true } },
    };
    if (query.includeStops) {
      include.stops = { where: { deletedAt: null }, orderBy: { order: 'asc' } };
    }
    const [data, total] = await Promise.all([
      this.db.transportRoute.findMany({ where, orderBy: { code: 'asc' }, skip: query.skip ?? 0, take: query.take ?? 50, include }),
      this.db.transportRoute.count({ where }),
    ]);
    return { data, total };
  }

  async getRoute(tenantId: string, id: string) {
    const route = await this.db.transportRoute.findFirst({
      where: { id, deletedAt: null },
      include: {
        campus: { select: { id: true, name: true } },
        vehicle: { select: { id: true, registrationNumber: true } },
        stops: { where: { deletedAt: null }, orderBy: { order: 'asc' } },
        passAssignments: {
          where: { status: { in: PASS_ACTIVE_STATUSES } },
          include: { student: { select: { id: true, fullName: true, admissionNumber: true } } },
        },
      },
    });
    if (!route) throw new NotFoundException('Route not found.');
    return route;
  }

  async createRoute(tenantId: string, userId: string, dto: CreateRouteDto) {
    const existing = await this.db.transportRoute.findFirst({ where: { tenantId, code: dto.code, deletedAt: null }, select: { id: true } });
    if (existing) throw new ConflictException('A route with this code already exists.');
    const row = await this.db.transportRoute.create({
      data: {
        tenantId,
        campusId: dto.campusId,
        code: dto.code,
        name: dto.name,
        status: dto.status ?? 'ACTIVE',
        distanceKm: dto.distanceKm,
        estimatedDurationMin: dto.estimatedDurationMin,
        monthlyFeeCents: dto.monthlyFeeCents,
        description: dto.description,
        isActive: dto.isActive ?? true,
        vehicleId: dto.vehicleId,
        createdBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.TRANSPORT_ROUTE_CREATED, 'TransportRoute', row.id, { after: row });
    return row;
  }

  async updateRoute(tenantId: string, userId: string, id: string, dto: UpdateRouteDto) {
    const before = await this.findRoute(tenantId, id);
    if (dto.code && dto.code !== before.code) {
      const existing = await this.db.transportRoute.findFirst({
        where: { tenantId, code: dto.code, deletedAt: null, NOT: { id } },
        select: { id: true },
      });
      if (existing) throw new ConflictException('A route with this code already exists.');
    }
    const row = await this.db.transportRoute.update({
      where: { id },
      data: {
        ...(dto.campusId !== undefined ? { campusId: dto.campusId } : {}),
        ...(dto.code !== undefined ? { code: dto.code } : {}),
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.distanceKm !== undefined ? { distanceKm: dto.distanceKm } : {}),
        ...(dto.estimatedDurationMin !== undefined ? { estimatedDurationMin: dto.estimatedDurationMin } : {}),
        ...(dto.monthlyFeeCents !== undefined ? { monthlyFeeCents: dto.monthlyFeeCents } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.vehicleId !== undefined ? { vehicleId: dto.vehicleId } : {}),
        updatedBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.TRANSPORT_ROUTE_UPDATED, 'TransportRoute', row.id, { before, after: row });
    return row;
  }

  async deleteRoute(tenantId: string, userId: string, id: string) {
    const before = await this.findRoute(tenantId, id);
    const row = await this.db.transportRoute.update({ where: { id }, data: { deletedAt: new Date(), isActive: false, updatedBy: userId } });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.TRANSPORT_ROUTE_DELETED, 'TransportRoute', row.id, { before, after: row });
    return { id: row.id };
  }

  /** Creates a stop, appending after the current max order when no explicit order is given. */
  async createStop(tenantId: string, userId: string, routeId: string, dto: CreateStopDto) {
    await this.findRoute(tenantId, routeId);
    const order = dto.order ?? ((await this.nextStopOrder(tenantId, routeId)) as number);
    const existing = await this.db.transportStop.findFirst({
      where: { tenantId, routeId, order, deletedAt: null },
      select: { id: true },
    });
    if (existing) throw new ConflictException('A stop with this order already exists on the route.');
    const row = await this.db.transportStop.create({
      data: {
        tenantId,
        routeId,
        name: dto.name,
        order,
        type: dto.type ?? 'PICKUP',
        address: dto.address,
        latitude: dto.latitude,
        longitude: dto.longitude,
        pickupTime: dto.pickupTime,
        dropTime: dto.dropTime,
        reachRadiusMeters: dto.reachRadiusMeters ?? 50,
        isActive: dto.isActive ?? true,
        createdBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.TRANSPORT_STOP_CREATED, 'TransportStop', row.id, { after: row });
    return row;
  }

  async updateStop(tenantId: string, userId: string, id: string, dto: UpdateStopDto) {
    const before = await this.db.transportStop.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundException('Stop not found.');
    if (dto.order && dto.order !== before.order) {
      const existing = await this.db.transportStop.findFirst({
        where: { tenantId, routeId: before.routeId, order: dto.order, deletedAt: null, NOT: { id } },
        select: { id: true },
      });
      if (existing) throw new ConflictException('A stop with this order already exists on the route.');
    }
    const row = await this.db.transportStop.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.order !== undefined ? { order: dto.order } : {}),
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.address !== undefined ? { address: dto.address } : {}),
        ...(dto.latitude !== undefined ? { latitude: dto.latitude } : {}),
        ...(dto.longitude !== undefined ? { longitude: dto.longitude } : {}),
        ...(dto.pickupTime !== undefined ? { pickupTime: dto.pickupTime } : {}),
        ...(dto.dropTime !== undefined ? { dropTime: dto.dropTime } : {}),
        ...(dto.reachRadiusMeters !== undefined ? { reachRadiusMeters: dto.reachRadiusMeters } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        updatedBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.TRANSPORT_STOP_UPDATED, 'TransportStop', row.id, { before, after: row });
    return row;
  }

  async deleteStop(tenantId: string, userId: string, id: string) {
    const before = await this.db.transportStop.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundException('Stop not found.');
    const row = await this.db.transportStop.update({ where: { id }, data: { deletedAt: new Date(), isActive: false, updatedBy: userId } });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.TRANSPORT_STOP_DELETED, 'TransportStop', row.id, { before, after: row });
    return { id: row.id };
  }

  /** Bulk reorder of a route's stops â€” `order` is an array of stop ids in the new sequence. */
  async reorderStops(tenantId: string, userId: string, routeId: string, dto: ReorderStopsDto) {
    await this.findRoute(tenantId, routeId);
    const result = await this.db.$transaction(
      dto.order.map((stopId, index) =>
        this.db.transportStop.updateMany({
          where: { id: stopId, tenantId, routeId, deletedAt: null },
          data: { order: index + 1, updatedBy: userId },
        }),
      ),
    );
    await this.audit(tenantId, userId, AUDIT_ACTIONS.TRANSPORT_STOP_UPDATED, 'TransportRoute', routeId, { after: dto });
    return { reordered: result.length };
  }

  // â”€â”€ Passes (student route allocation) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async listPasses(tenantId: string, userId: string, query: ListPassesQueryDto) {
    const scope = await this.passScope(tenantId, userId);
    const where: any = {
      ...(scope ?? {}),
      ...(query.studentId ? { studentId: query.studentId } : {}),
      ...(query.routeId ? { routeId: query.routeId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [data, total] = await Promise.all([
      this.db.studentTransportPass.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip ?? 0,
        take: query.take ?? 50,
        include: passInclude,
      }),
      this.db.studentTransportPass.count({ where }),
    ]);
    return { data, total };
  }

  async getPass(tenantId: string, userId: string, id: string) {
    const scope = await this.passScope(tenantId, userId);
    const pass = await this.db.studentTransportPass.findFirst({
      where: { id, ...(scope ?? {}) },
      include: { ...passInclude, feeCharges: { orderBy: { createdAt: 'desc' }, take: 20 } },
    });
    if (!pass) throw new NotFoundException('Transport pass not found.');
    return pass;
  }

  /** Allocate a route to a student. Denormalized route/stop/vehicle snapshot columns are kept in
   * sync for backward-compatible reads; the pass then carries concrete FK relations. */
  async createPass(tenantId: string, userId: string, dto: CreatePassDto) {
    const route = await this.findRoute(tenantId, dto.routeId);
    const stop = await this.db.transportStop.findFirst({ where: { id: dto.stopId, tenantId, deletedAt: null } });
    if (!stop) throw new NotFoundException('Stop not found.');
    if (dto.dropStopId) {
      const drop = await this.db.transportStop.findFirst({ where: { id: dto.dropStopId, tenantId, deletedAt: null } });
      if (!drop) throw new NotFoundException('Drop stop not found.');
    }
    const vehicle = dto.vehicleId ? await this.findVehicle(tenantId, dto.vehicleId) : null;
    const driver = dto.driverId ? await this.findDriver(tenantId, dto.driverId) : null;

    const row = await this.db.$transaction(async (tx: Client) => {
      const pass = await tx.studentTransportPass.create({
        data: {
          tenantId,
          studentId: dto.studentId,
          routeId: route.id,
          stopId: stop.id,
          dropStopId: dto.dropStopId,
          vehicleId: vehicle?.id,
          driverId: driver?.id,
          routeCode: route.code,
          routeName: route.name,
          pickupPoint: stop.name,
          dropPoint: dto.dropStopId ? undefined : null,
          vehicleNumber: vehicle?.registrationNumber,
          periodStart: new Date(dto.periodStart),
          periodEnd: dto.periodEnd ? new Date(dto.periodEnd) : null,
          status: 'ACTIVE',
          amountCents: dto.amountCents ?? route.monthlyFeeCents ?? null,
          dailyPickupTime: dto.dailyPickupTime,
          dailyDropTime: dto.dailyDropTime,
          issuedOn: new Date(),
          issuedByUserId: userId,
          remarks: dto.remarks,
          createdBy: userId,
        },
      });
      if (dto.dropStopId) {
        const drop = await tx.transportStop.findUnique({ where: { id: dto.dropStopId }, select: { name: true } });
        if (drop) {
          await tx.studentTransportPass.update({ where: { id: pass.id }, data: { dropPoint: drop.name } });
        }
      }
      if (dto.chargeFee && (route.monthlyFeeCents ?? 0) > 0) {
        await this.createChargeTx(tx, tenantId, userId, pass, route, {
          amountCents: dto.amountCents ?? computeTransportChargeCents(route.monthlyFeeCents ?? 0, 1),
          periodStart: dto.periodStart,
          remarks: dto.remarks,
        });
      }
      return pass;
    });

    await this.audit(tenantId, userId, AUDIT_ACTIONS.STUDENT_TRANSPORT_PASS_CREATED, 'StudentTransportPass', row.id, { after: row });
    const student = await this.findStudent(tenantId, dto.studentId);
    await this.notifyUser(
      tenantId,
      student.userId,
      'Transport pass issued',
      `A transport pass on route ${route.code} (${route.name}) is now active for you, boarding at ${stop.name}.`,
    );
    return row;
  }

  async updatePass(tenantId: string, userId: string, id: string, dto: UpdatePassDto) {
    const before = await this.db.studentTransportPass.findFirst({ where: { id, tenantId } });
    if (!before) throw new NotFoundException('Transport pass not found.');
    const route = dto.routeId ? await this.findRoute(tenantId, dto.routeId) : null;
    const stop = dto.stopId ? await this.db.transportStop.findFirst({ where: { id: dto.stopId, tenantId, deletedAt: null } }) : null;
    if (dto.stopId && !stop) throw new NotFoundException('Stop not found.');
    if (dto.dropStopId) {
      const drop = await this.db.transportStop.findFirst({ where: { id: dto.dropStopId, tenantId, deletedAt: null } });
      if (!drop) throw new NotFoundException('Drop stop not found.');
    }
    const vehicle = dto.vehicleId ? await this.findVehicle(tenantId, dto.vehicleId) : null;
    if (dto.driverId) await this.findDriver(tenantId, dto.driverId);

    const row = await this.db.studentTransportPass.update({
      where: { id },
      data: {
        ...(dto.studentId !== undefined ? { studentId: dto.studentId } : {}),
        ...(route ? { routeId: route.id, routeCode: route.code, routeName: route.name } : {}),
        ...(stop ? { stopId: stop.id, pickupPoint: stop.name } : {}),
        ...(dto.dropStopId !== undefined ? { dropStopId: dto.dropStopId || null, dropPoint: dto.dropStopId ? undefined : null } : {}),
        ...(vehicle ? { vehicleId: vehicle.id, vehicleNumber: vehicle.registrationNumber } : {}),
        ...(dto.driverId !== undefined ? { driverId: dto.driverId || null } : {}),
        ...(dto.periodStart !== undefined ? { periodStart: new Date(dto.periodStart) } : {}),
        ...(dto.periodEnd !== undefined ? { periodEnd: dto.periodEnd ? new Date(dto.periodEnd) : null } : {}),
        ...(dto.amountCents !== undefined ? { amountCents: dto.amountCents } : {}),
        ...(dto.dailyPickupTime !== undefined ? { dailyPickupTime: dto.dailyPickupTime } : {}),
        ...(dto.dailyDropTime !== undefined ? { dailyDropTime: dto.dailyDropTime } : {}),
        ...(dto.remarks !== undefined ? { remarks: dto.remarks } : {}),
        updatedBy: userId,
      },
    });
    if (dto.dropStopId) {
      const drop = await this.db.transportStop.findFirst({ where: { id: dto.dropStopId, tenantId, deletedAt: null }, select: { name: true } });
      if (drop) {
        await this.db.studentTransportPass.update({ where: { id }, data: { dropPoint: drop.name } });
      }
    }
    await this.audit(tenantId, userId, AUDIT_ACTIONS.STUDENT_TRANSPORT_PASS_UPDATED, 'StudentTransportPass', row.id, { before, after: row });
    return row;
  }

  async setPassStatus(tenantId: string, userId: string, id: string, dto: SetPassStatusDto) {
    const before = await this.db.studentTransportPass.findFirst({ where: { id, tenantId } });
    if (!before) throw new NotFoundException('Transport pass not found.');
    const row = await this.db.studentTransportPass.update({
      where: { id },
      data: {
        status: dto.status,
        remarks: [before.remarks, dto.reason ? `${dto.status}: ${dto.reason}` : dto.status].filter(Boolean).join(' Â· '),
        updatedBy: userId,
      },
    });
    const action =
      dto.status === 'CANCELLED' ? AUDIT_ACTIONS.STUDENT_TRANSPORT_PASS_CANCELLED : AUDIT_ACTIONS.STUDENT_TRANSPORT_PASS_UPDATED;
    await this.audit(tenantId, userId, action, 'StudentTransportPass', row.id, { before, after: row });
    const student = await this.findStudent(tenantId, before.studentId);
    await this.notifyUser(
      tenantId,
      student.userId,
      `Transport pass ${dto.status.toLowerCase()}`,
      `Your transport pass on ${before.routeName} was set to ${dto.status}${dto.reason ? ` (${dto.reason})` : ''}.`,
    );
    return row;
  }

  async createCharge(tenantId: string, userId: string, passId: string, dto: ChargePassDto) {
    const pass = await this.db.studentTransportPass.findFirst({ where: { id: passId, tenantId } });
    if (!pass) throw new NotFoundException('Transport pass not found.');
    if (!PASS_ACTIVE_STATUSES.includes(pass.status)) {
      throw new BadRequestException('Fees can only be charged to an active pass.');
    }
    const route = pass.routeId ? await this.findRoute(tenantId, pass.routeId, true) : null;
    const monthly = dto.amountCents ?? pass.amountCents ?? route?.monthlyFeeCents ?? 0;
    const row = await this.createChargeTx(this.db, tenantId, userId, { id: pass.id, studentId: pass.studentId, amountCents: monthly } as any, route, dto);
    await this.audit(tenantId, userId, AUDIT_ACTIONS.TRANSPORT_CHARGE_CREATED, 'StudentFee', row.id, { after: row });
    const student = await this.findStudent(tenantId, pass.studentId);
    await this.notifyUser(
      tenantId,
      student.userId,
      'Transport fee charged',
      `A transport fee of â‚¹${(row.amountCents / 100).toFixed(2)} was added to your fee ledger (${row.headName}).`,
    );
    return row;
  }

  private async createChargeTx(
    tx: Client,
    tenantId: string,
    userId: string,
    pass: { id: string; studentId: string; amountCents?: number | null },
    route: any,
    dto: Omit<ChargePassDto, 'headCode' | 'headName'> & { headCode?: string; headName?: string },
  ) {
    const monthCount = dto.monthCount ?? 1;
    const amountCents = dto.amountCents ?? computeTransportChargeCents(pass.amountCents ?? route?.monthlyFeeCents ?? 0, monthCount);
    if (amountCents <= 0) throw new BadRequestException('Charge amount must be greater than zero.');
    const headCode = dto.headCode ?? FALLBACK_FEE_HEAD.code;
    const headName = dto.headName ?? FALLBACK_FEE_HEAD.name;
    const period = transportChargePeriod(dto.periodStart, monthCount);
    const remarks = [dto.remarks, `Transport ${period.start.toISOString().slice(0, 10)} â†’ ${period.end.toISOString().slice(0, 10)}`]
      .filter(Boolean)
      .join(' Â· ');

    return tx.studentFee.create({
      data: {
        tenantId,
        studentId: pass.studentId,
        transportPassId: pass.id,
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

  async listCharges(tenantId: string, userId: string, query: DuesReportQueryDto) {
    const scope = await this.chargeScope(tenantId, userId);
    const where: any = { ...(scope ?? {}), transportPassId: { not: null }, ...(query.status ? { status: query.status } : {}) };
    const [data, total] = await Promise.all([
      this.db.studentFee.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip ?? 0,
        take: query.take ?? 50,
        include: {
          student: { select: { id: true, fullName: true, admissionNumber: true } },
          transportPass: {
            select: { id: true, routeId: true, routeName: true, route: { select: { id: true, code: true } } },
          },
        },
      }),
      this.db.studentFee.count({ where }),
    ]);
    return { data, total };
  }

  async waiveCharge(tenantId: string, userId: string, id: string, dto: WaiveTransportChargeDto) {
    const fee = await this.db.studentFee.findFirst({ where: { id, transportPassId: { not: null } } });
    if (!fee) throw new NotFoundException('Transport charge not found.');
    if (fee.status === 'PAID') throw new BadRequestException('Paid charges cannot be waived.');
    const before = fee;
    const row = await this.db.studentFee.update({
      where: { id },
      data: {
        status: 'WAIVED',
        remarks: [fee.remarks, dto.reason ? `Waived: ${dto.reason}` : 'Waived by transport office.'].filter(Boolean).join(' Â· '),
        updatedBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.TRANSPORT_CHARGE_WAIVED, 'StudentFee', row.id, { before, after: row });
    return row;
  }

  // â”€â”€ Trips â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async listTrips(tenantId: string, query: ListTripsQueryDto) {
    const where: any = {
      ...(query.routeId ? { routeId: query.routeId } : {}),
      ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    if (query.date) {
      const start = new Date(query.date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      where.date = { gte: start, lt: end };
    }
    const [data, total] = await Promise.all([
      this.db.transportTrip.findMany({
        where,
        orderBy: { date: 'desc' },
        skip: query.skip ?? 0,
        take: query.take ?? 50,
        include: {
          route: { select: { id: true, code: true, name: true } },
          vehicle: { select: { id: true, registrationNumber: true } },
          driver: { select: { id: true, name: true } },
          _count: { select: { tripStops: true, alerts: true } },
        },
      }),
      this.db.transportTrip.count({ where }),
    ]);
    return { data, total };
  }

  async getTrip(tenantId: string, id: string) {
    const trip = await this.db.transportTrip.findFirst({
      where: { id },
      include: {
        route: { include: { stops: { where: { deletedAt: null }, orderBy: { order: 'asc' } } } },
        vehicle: { select: { id: true, registrationNumber: true } },
        driver: { select: { id: true, name: true, phone: true } },
        tripStops: { orderBy: { order: 'asc' }, include: { stop: { select: { id: true, name: true, address: true } } } },
        gpsPositions: { orderBy: { recordedAt: 'desc' }, take: 200 },
        alerts: { orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });
    if (!trip) throw new NotFoundException('Trip not found.');
    return trip;
  }

  async createTrip(tenantId: string, userId: string, dto: CreateTripDto) {
    const route = await this.findRoute(tenantId, dto.routeId);
    const date = new Date(dto.date);
    date.setHours(0, 0, 0, 0);
    const existing = await this.db.transportTrip.findFirst({
      where: { tenantId, routeId: route.id, date },
      select: { id: true },
    });
    if (existing) throw new ConflictException('A trip for this route already exists on this date.');

    const stops = await this.db.transportStop.findMany({
      where: { routeId: route.id, deletedAt: null, isActive: true },
      orderBy: { order: 'asc' },
    });

    const row = await this.db.$transaction(async (tx: Client) => {
      const trip = await tx.transportTrip.create({
        data: {
          tenantId,
          routeId: route.id,
          vehicleId: dto.vehicleId,
          driverId: dto.driverId,
          date,
          status: 'SCHEDULED',
          scheduledDeparture: dto.scheduledDeparture ? new Date(dto.scheduledDeparture) : null,
          scheduledArrival: dto.scheduledArrival ? new Date(dto.scheduledArrival) : null,
          remarks: dto.remarks,
          createdBy: userId,
        },
      });
      if (stops.length > 0) {
        await tx.transportTripStop.createMany({
          data: stops.map((stop: any, index: number) => ({
            tenantId,
            tripId: trip.id,
            stopId: stop.id,
            order: index + 1,
            scheduledTime: stop.pickupTime
              ? this.mergeTime(date, stop.pickupTime)
              : null,
          })),
        });
      }
      return trip;
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.TRANSPORT_TRIP_CREATED, 'TransportTrip', row.id, { after: row });
    return row;
  }

  async startTrip(tenantId: string, userId: string, id: string) {
    const before = await this.db.transportTrip.findFirst({ where: { id, tenantId } });
    if (!before) throw new NotFoundException('Trip not found.');
    if (before.status !== 'SCHEDULED') throw new BadRequestException('Only SCHEDULED trips can be started.');
    const row = await this.db.transportTrip.update({
      where: { id },
      data: { status: 'ONGOING', actualDepartureAt: new Date(), updatedBy: userId },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.TRANSPORT_TRIP_STARTED, 'TransportTrip', row.id, { before, after: row });
    return row;
  }

  async completeTrip(tenantId: string, userId: string, id: string) {
    const before = await this.db.transportTrip.findFirst({ where: { id, tenantId } });
    if (!before) throw new NotFoundException('Trip not found.');
    if (before.status !== 'ONGOING') throw new BadRequestException('Only ONGOING trips can be completed.');
    const row = await this.db.transportTrip.update({
      where: { id },
      data: { status: 'COMPLETED', actualArrivalAt: new Date(), updatedBy: userId },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.TRANSPORT_TRIP_COMPLETED, 'TransportTrip', row.id, { before, after: row });
    return row;
  }

  async cancelTrip(tenantId: string, userId: string, id: string, dto: CancelTripDto) {
    const before = await this.db.transportTrip.findFirst({ where: { id, tenantId } });
    if (!before) throw new NotFoundException('Trip not found.');
    if (before.status === 'COMPLETED' || before.status === 'CANCELLED') {
      throw new BadRequestException('This trip can no longer be cancelled.');
    }
    const row = await this.db.transportTrip.update({
      where: { id },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: dto.reason, updatedBy: userId },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.TRANSPORT_TRIP_CANCELLED, 'TransportTrip', row.id, { before, after: row });
    return row;
  }

  async checkpointTripStop(tenantId: string, userId: string, tripStopId: string, dto: TripStopCheckpointDto) {
    const tripStop = await this.db.transportTripStop.findFirst({ where: { id: tripStopId, tenantId } });
    if (!tripStop) throw new NotFoundException('Trip stop not found.');
    const row = await this.db.transportTripStop.update({
      where: { id: tripStopId },
      data: {
        ...(dto.actualArrivalAt !== undefined ? { actualArrivalAt: dto.actualArrivalAt ? new Date(dto.actualArrivalAt) : null } : {}),
        ...(dto.actualDepartureAt !== undefined ? { actualDepartureAt: dto.actualDepartureAt ? new Date(dto.actualDepartureAt) : null } : {}),
        ...(dto.studentsBoarded !== undefined ? { studentsBoarded: dto.studentsBoarded } : {}),
        ...(dto.studentsAlighted !== undefined ? { studentsAlighted: dto.studentsAlighted } : {}),
        ...(dto.skipped !== undefined ? { skipped: dto.skipped } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.TRANSPORT_TRIP_STOP_UPDATED, 'TransportTripStop', row.id, { after: row });
    return row;
  }

  // â”€â”€ Maintenance â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async listMaintenance(tenantId: string, query: ListMaintenanceQueryDto) {
    const where: any = {
      ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
    };
    const [data, total] = await Promise.all([
      this.db.transportMaintenanceRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip ?? 0,
        take: query.take ?? 50,
        include: { vehicle: { select: { id: true, registrationNumber: true, make: true, model: true } } },
      }),
      this.db.transportMaintenanceRecord.count({ where }),
    ]);
    return { data, total };
  }

  async createMaintenance(tenantId: string, userId: string, dto: CreateMaintenanceDto) {
    await this.findVehicle(tenantId, dto.vehicleId);
    const row = await this.db.transportMaintenanceRecord.create({
      data: {
        tenantId,
        vehicleId: dto.vehicleId,
        type: dto.type,
        status: dto.status ?? 'SCHEDULED',
        scheduledDate: dto.scheduledDate ? new Date(dto.scheduledDate) : null,
        startedAt: dto.startedAt ? new Date(dto.startedAt) : null,
        completedAt: dto.completedAt ? new Date(dto.completedAt) : null,
        odometerKm: dto.odometerKm,
        description: dto.description,
        vendor: dto.vendor,
        costCents: dto.costCents,
        performedBy: dto.performedBy,
        notes: dto.notes,
        createdBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.TRANSPORT_MAINTENANCE_CREATED, 'TransportMaintenanceRecord', row.id, { after: row });
    return row;
  }

  async updateMaintenance(tenantId: string, userId: string, id: string, dto: UpdateMaintenanceDto) {
    const before = await this.db.transportMaintenanceRecord.findFirst({ where: { id, tenantId } });
    if (!before) throw new NotFoundException('Maintenance record not found.');
    const row = await this.db.transportMaintenanceRecord.update({
      where: { id },
      data: {
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.scheduledDate !== undefined ? { scheduledDate: dto.scheduledDate ? new Date(dto.scheduledDate) : null } : {}),
        ...(dto.startedAt !== undefined ? { startedAt: dto.startedAt ? new Date(dto.startedAt) : null } : {}),
        ...(dto.completedAt !== undefined ? { completedAt: dto.completedAt ? new Date(dto.completedAt) : null } : {}),
        ...(dto.odometerKm !== undefined ? { odometerKm: dto.odometerKm } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.vendor !== undefined ? { vendor: dto.vendor } : {}),
        ...(dto.costCents !== undefined ? { costCents: dto.costCents } : {}),
        ...(dto.performedBy !== undefined ? { performedBy: dto.performedBy } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        updatedBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.TRANSPORT_MAINTENANCE_UPDATED, 'TransportMaintenanceRecord', row.id, { before, after: row });
    return row;
  }

  async setMaintenanceStatus(tenantId: string, userId: string, id: string, dto: SetMaintenanceStatusDto) {
    const before = await this.db.transportMaintenanceRecord.findFirst({ where: { id, tenantId } });
    if (!before) throw new NotFoundException('Maintenance record not found.');
    const data: any = { status: dto.status, updatedBy: userId };
    if (dto.status === 'IN_PROGRESS' && !before.startedAt) data.startedAt = new Date();
    if (dto.status === 'COMPLETED' && !before.completedAt) data.completedAt = new Date();
    const row = await this.db.transportMaintenanceRecord.update({ where: { id }, data });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.TRANSPORT_MAINTENANCE_UPDATED, 'TransportMaintenanceRecord', row.id, { before, after: row });
    return row;
  }

  // â”€â”€ Alerts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async listAlerts(tenantId: string, query: ListAlertsQueryDto) {
    const where: any = {
      ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
      ...(query.severity ? { severity: query.severity } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.includeResolved ? {} : { resolvedAt: null }),
    };
    const [data, total] = await Promise.all([
      this.db.transportAlert.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip ?? 0,
        take: query.take ?? 50,
        include: {
          vehicle: { select: { id: true, registrationNumber: true } },
          trip: { select: { id: true, routeId: true, date: true, route: { select: { code: true, name: true } } } },
        },
      }),
      this.db.transportAlert.count({ where }),
    ]);
    return { data, total };
  }

  async createAlert(tenantId: string, userId: string, dto: CreateAlertDto) {
    const row = await this.db.transportAlert.create({
      data: {
        tenantId,
        vehicleId: dto.vehicleId,
        tripId: dto.tripId,
        type: dto.type,
        severity: dto.severity,
        title: dto.title,
        message: dto.message,
        latitude: dto.latitude,
        longitude: dto.longitude,
        meta: { createdManually: true },
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.TRANSPORT_ALERT_CREATED, 'TransportAlert', row.id, { after: row });
    if (dto.severity === 'CRITICAL') {
      await this.notifyIngest(tenantId, dto.title, `${dto.message} (${dto.type})`);
    }
    return row;
  }

  async acknowledgeAlert(tenantId: string, userId: string, id: string, dto: AcknowledgeAlertDto) {
    const before = await this.db.transportAlert.findFirst({ where: { id, tenantId } });
    if (!before) throw new NotFoundException('Alert not found.');
    const row = await this.db.transportAlert.update({
      where: { id },
      data: {
        acknowledgedAt: new Date(),
        acknowledgedByUserId: userId,
        meta: { ...((before.meta as Record<string, unknown>) ?? {}), acknowledgedNote: dto.note },
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.TRANSPORT_ALERT_ACKNOWLEDGED, 'TransportAlert', row.id, { before, after: row });
    return row;
  }

  async resolveAlert(tenantId: string, userId: string, id: string, dto: ResolveAlertDto) {
    const before = await this.db.transportAlert.findFirst({ where: { id, tenantId } });
    if (!before) throw new NotFoundException('Alert not found.');
    const row = await this.db.transportAlert.update({
      where: { id },
      data: {
        resolvedAt: new Date(),
        resolvedByUserId: userId,
        resolution: dto.resolution,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.TRANSPORT_ALERT_RESOLVED, 'TransportAlert', row.id, { before, after: row });
    return row;
  }

  // â”€â”€ Reports â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async summary(_tenantId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [vehicles, inServiceVehicles, drivers, routes, activePasses, overdueDocs, scheduledTrips, ongoingTrips, openAlerts, openMaintenance] =
      await Promise.all([
        this.db.transportVehicle.count({ where: { deletedAt: null } }),
        this.db.transportVehicle.count({ where: { deletedAt: null, status: 'IN_SERVICE' } }),
        this.db.transportDriver.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
        this.db.transportRoute.count({ where: { deletedAt: null, isActive: true } }),
        this.db.studentTransportPass.count({ where: { status: { in: PASS_ACTIVE_STATUSES } } }),
        this.db.transportVehicleDocument.count({ where: { expiryDate: { lt: new Date() }, status: 'VALID' } }),
        this.db.transportTrip.count({ where: { date: { gte: today }, status: 'SCHEDULED' } }),
        this.db.transportTrip.count({ where: { date: { gte: today }, status: 'ONGOING' } }),
        this.db.transportAlert.count({ where: { resolvedAt: null, severity: { in: ['WARNING', 'CRITICAL'] } } }),
        this.db.transportMaintenanceRecord.count({ where: { status: { in: ['SCHEDULED', 'IN_PROGRESS'] } } }),
      ]);
    return {
      vehicles,
      inServiceVehicles,
      drivers,
      routes,
      activePasses,
      overdueDocuments: overdueDocs,
      scheduledTrips,
      ongoingTrips,
      openAlerts,
      openMaintenance,
    };
  }

  async routeLoadReport(tenantId: string, query: RouteLoadReportQueryDto) {
    const date = query.date ? new Date(query.date) : new Date();
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const routes = await this.db.transportRoute.findMany({
      where: { deletedAt: null, ...(query.routeId ? { id: query.routeId } : {}) },
      orderBy: { code: 'asc' },
      include: {
        stops: { where: { deletedAt: null }, orderBy: { order: 'asc' }, select: { id: true, name: true, order: true } },
        trips: { where: { date: { gte: start, lt: end } }, select: { id: true, status: true } },
        passAssignments: {
          where: { status: { in: PASS_ACTIVE_STATUSES } },
          include: { stop: { select: { id: true, name: true } } },
        },
      },
    });
    return routes.map((route: any) => ({
      routeId: route.id,
      code: route.code,
      name: route.name,
      capacity: route.vehicleId ? null : null,
      allocated: route.passAssignments.length,
      perStop: route.stops.map((stop: any) => ({
        stopId: stop.id,
        name: stop.name,
        order: stop.order,
        allocated: route.passAssignments.filter((p: any) => p.stopId === stop.id).length,
      })),
      tripsToday: route.trips.length,
      tripStatuses: (route.trips as any[]).reduce((acc: Record<string, number>, t: any) => {
        acc[t.status] = (acc[t.status] ?? 0) + 1;
        return acc;
      }, {}),
    }));
  }

  async vehicleUtilizationReport(tenantId: string, query: VehicleUtilizationReportQueryDto) {
    const dateFrom = query.dateFrom ? new Date(query.dateFrom) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const dateTo = query.dateTo ? new Date(query.dateTo) : new Date();
    const vehicles = await this.db.transportVehicle.findMany({
      where: { deletedAt: null, ...(query.vehicleId ? { id: query.vehicleId } : {}) },
      orderBy: { registrationNumber: 'asc' },
      include: {
        trips: {
          where: { date: { gte: dateFrom, lte: dateTo } },
          select: { id: true, status: true, distanceKm: true, actualDepartureAt: true, actualArrivalAt: true },
        },
        maintenanceRecords: {
          where: { createdAt: { gte: dateFrom, lte: dateTo } },
          select: { id: true, costCents: true, status: true },
        },
        gpsPositions: { select: { id: true }, take: 1 },
      },
    });
    return vehicles.map((vehicle: any) => ({
      vehicleId: vehicle.id,
      registrationNumber: vehicle.registrationNumber,
      type: vehicle.type,
      status: vehicle.status,
      trips: vehicle.trips.length,
      completedTrips: vehicle.trips.filter((t: any) => t.status === 'COMPLETED').length,
      maintenanceCostCents: vehicle.maintenanceRecords.reduce(
        (sum: number, record: any) => sum + (record.costCents ?? 0),
        0,
      ),
      gpsTracked: vehicle.gpsPositions.length > 0,
    }));
  }

  async alertsReport(_tenantId: string) {
    const [bySeverity, byType, recent] = await Promise.all([
      this.db.transportAlert.groupBy({ by: ['severity'], _count: { _all: true }, where: { resolvedAt: null } }),
      this.db.transportAlert.groupBy({ by: ['type'], _count: { _all: true }, where: { resolvedAt: null } }),
      this.db.transportAlert.findMany({
        where: { resolvedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { vehicle: { select: { id: true, registrationNumber: true } } },
      }),
    ]);
    return { bySeverity, byType, recent };
  }

  // â”€â”€ GPS surface (delegates to the GPS service) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  gpsConfig(tenantId: string) {
    return this.gpsService.getConfig(tenantId);
  }

  updateGpsConfig(tenantId: string, userId: string, dto: any) {
    return this.gpsService.updateConfig(tenantId, userId, dto);
  }

  pollGps(tenantId: string, userId: string) {
    return this.gpsService.pollNow(tenantId, userId);
  }

  ingestGps(tenantId: string, dto: any) {
    return this.gpsService.ingest(tenantId, undefined, dto);
  }

  async listVehiclePositions(tenantId: string, vehicleId: string, limit = 100) {
    await this.findVehicle(tenantId, vehicleId);
    const data = await this.db.transportGPSPosition.findMany({
      where: { vehicleId },
      orderBy: { recordedAt: 'desc' },
      take: Math.min(Math.max(1, limit), 500),
    });
    return { data };
  }

  // â”€â”€ Internal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private async notifyUser(tenantId: string, recipientUserId: string | null | undefined, subject: string, body: string) {
    if (recipientUserId) {
      await this.notifications.sendSystem(tenantId, { recipientUserId, subject, body });
    }
  }

  private async notifyIngest(tenantId: string, subject: string, body: string) {
    const managers = await this.db.userRole.findMany({
      where: { role: { code: 'TRANSPORT_MANAGER' }, user: { status: 'ACTIVE' } },
      select: { user: { select: { id: true } } },
    });
    for (const { user } of managers) {
      await this.notifications.sendSystem(tenantId, { recipientUserId: user.id, subject, body });
    }
  }

  private async findStudent(tenantId: string, id: string) {
    const student = await this.db.student.findFirst({
      where: { id, tenantId },
      select: { id: true, userId: true, fullName: true },
    });
    if (!student) throw new NotFoundException('Student not found.');
    return student;
  }

  private async findVehicle(tenantId: string, id: string, includeInactive = false) {
    const vehicle = await this.db.transportVehicle.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!vehicle || (!includeInactive && vehicle.status === 'SCRAPPED')) {
      throw new NotFoundException('Vehicle not found.');
    }
    return vehicle;
  }

  private async findDriver(tenantId: string, id: string) {
    const driver = await this.db.transportDriver.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!driver) throw new NotFoundException('Driver not found.');
    return driver;
  }

  private async findRoute(tenantId: string, id: string, includeInactive = false) {
    const route = await this.db.transportRoute.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!route || (!includeInactive && !route.isActive)) {
      throw new NotFoundException('Route not found.');
    }
    return route;
  }

  private async nextStopOrder(tenantId: string, routeId: string): Promise<number> {
    const last = await this.db.transportStop.findFirst({
      where: { tenantId, routeId, deletedAt: null },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    return (last?.order ?? 0) + 1;
  }

  /** Builds a DateTime from the trip's date plus a local clock string like "07:30". */
  private mergeTime(date: Date, time: string): Date {
    const [hours = '0', minutes = '0'] = time.split(':');
    const result = new Date(date);
    result.setHours(Number(hours) || 0, Number(minutes) || 0, 0, 0);
    return result;
  }
}