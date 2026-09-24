/** Transport module shared types & constants — mirrors the payloads returned by the transport
 *  API (`apps/api/src/modules/transport`). All taxonomies are stringly-typed over the wire (the
 *  module exports no native Prisma enum values). */

export const TRANSPORT_VIEW_PERMISSION = 'transport.view';
export const TRANSPORT_CREATE_PERMISSION = 'transport.create';
export const TRANSPORT_UPDATE_PERMISSION = 'transport.update';
export const TRANSPORT_DELETE_PERMISSION = 'transport.delete';
export const TRANSPORT_MANAGE_PERMISSION = 'transport.manage';

export interface Paged<T> {
  data: T[];
  total: number;
}

export interface RefOption {
  id: string;
  code?: string | null;
  name?: string | null;
}

export interface LookupVehicle {
  id: string;
  registrationNumber: string;
  make: string | null;
  model: string | null;
  type: string;
  status: string;
}

export interface LookupDriver {
  id: string;
  name: string;
  licenseNumber: string | null;
  status: string;
}

export interface LookupRoute {
  id: string;
  code: string;
  name: string;
  vehicleId: string | null;
  monthlyFeeCents: number | null;
  status: string;
}

export interface LookupStop {
  id: string;
  routeId: string;
  name: string;
  type: string;
  latitude: number | null;
  longitude: number | null;
}

export interface LookupsPayload {
  campuses: RefOption[];
  vehicles: LookupVehicle[];
  drivers: LookupDriver[];
  routes: LookupRoute[];
  stops: LookupStop[];
  feeHeads: RefOption[];
  vehicleTypes: string[];
  vehicleStatuses: string[];
  documentTypes: string[];
  documentStatuses: string[];
  routeStatuses: string[];
  stopTypes: string[];
  driverStatuses: string[];
  tripStatuses: string[];
  maintenanceTypes: string[];
  maintenanceStatuses: string[];
  alertTypes: string[];
  alertSeverities: string[];
  passStatuses: string[];
  feeStatuses: string[];
}

export interface StudentRef {
  id: string;
  fullName: string;
  admissionNumber: string | null;
  rollNumber: string | null;
  userId: string | null;
  program?: { id: string; name: string; code: string } | null;
}

export interface UserRef {
  id: string;
  fullName: string;
  email: string;
}

export interface VehicleRow {
  id: string;
  campusId: string | null;
  type: string;
  registrationNumber: string;
  chassisNumber: string | null;
  engineNumber: string | null;
  make: string | null;
  model: string | null;
  yearOfManufacture: number | null;
  fuelType: string | null;
  seatingCapacity: number | null;
  standingCapacity: number | null;
  isAc: boolean;
  gpsDeviceId: string | null;
  status: string;
  campus?: { id: string; name: string } | null;
  documents?: {
    id: string;
    documentType: string;
    documentNumber: string | null;
    expiryDate: string | null;
    status: string;
  }[];
  driverAssignments?: {
    id: string;
    isActive: boolean;
    assignedAt: string;
    releasedAt: string | null;
    driver: { id: string; name: string; licenseNumber: string | null };
  }[];
  routes?: { id: string; code: string; name: string }[];
  maintenanceRecords?: MaintenanceRow[];
  latestPosition?: { latitude: number; longitude: number; speedKmh: number | null; recordedAt: string } | null;
  _count?: { trips?: number; maintenanceRecords?: number; alerts?: number };
}

export interface VehicleDocumentRow {
  id: string;
  vehicleId: string;
  documentType: string;
  documentNumber: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  issuer: string | null;
  status: string;
  remarks: string | null;
  originalFilename?: string | null;
  createdAt: string;
}

export interface DriverRow {
  id: string;
  name: string;
  phone: string | null;
  alternatePhone: string | null;
  email: string | null;
  licenseNumber: string;
  licenseClass: string | null;
  licenseExpiry: string | null;
  joinedAt: string | null;
  status: string;
  notes: string | null;
  user?: { id: string; fullName: string } | null;
  assignments?: {
    id: string;
    isActive: boolean;
    assignedAt: string;
    releasedAt: string | null;
    vehicle?: { id: string; registrationNumber: string } | null;
  }[];
  trips?: {
    id: string;
    date: string;
    status: string;
    route: { id: string; code: string; name: string };
  }[];
}

export interface RouteRow {
  id: string;
  campusId: string | null;
  code: string;
  name: string;
  status: string;
  distanceKm: number | null;
  estimatedDurationMin: number | null;
  monthlyFeeCents: number | null;
  description: string | null;
  isActive: boolean;
  vehicleId: string | null;
  campus?: { id: string; name: string } | null;
  vehicle?: { id: string; registrationNumber: string } | null;
  stops?: StopRow[];
  passAssignments?: {
    id: string;
    status: string;
    student: { id: string; fullName: string; admissionNumber: string | null };
  }[];
  _count?: { stops?: number; trips?: number; passAssignments?: number };
}

export interface StopRow {
  id: string;
  routeId: string;
  name: string;
  order: number;
  type: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  pickupTime: string | null;
  dropTime: string | null;
  reachRadiusMeters: number | null;
  isActive: boolean;
}

export interface PassRow {
  id: string;
  studentId: string;
  routeId: string;
  stopId: string | null;
  dropStopId: string | null;
  vehicleId: string | null;
  driverId: string | null;
  routeCode: string;
  routeName: string;
  pickupPoint: string | null;
  dropPoint: string | null;
  vehicleNumber: string | null;
  periodStart: string;
  periodEnd: string | null;
  status: string;
  amountCents: number | null;
  dailyPickupTime: string | null;
  dailyDropTime: string | null;
  issuedOn: string;
  issuedByUserId: string | null;
  remarks: string | null;
  student?: StudentRef;
  route?: { id: string; code: string; name: string; monthlyFeeCents: number | null } | null;
  stop?: { id: string; name: string; address: string | null } | null;
  dropStop?: { id: string; name: string; address: string | null } | null;
  vehicle?: { id: string; registrationNumber: string; type: string } | null;
  driver?: { id: string; name: string; licenseNumber: string | null } | null;
  feeCharges?: ChargeRow[];
}

export interface ChargeRow {
  id: string;
  studentId: string;
  transportPassId: string | null;
  headCode: string;
  headName: string;
  amountCents: number;
  dueDate: string;
  status: string;
  remarks: string | null;
  createdAt: string;
  updatedAt: string;
  student?: { id: string; fullName: string; admissionNumber: string | null };
  transportPass?: {
    id: string;
    routeId: string | null;
    routeName: string | null;
    route: { id: string; code: string } | null;
  } | null;
}

export interface TripRow {
  id: string;
  routeId: string;
  vehicleId: string | null;
  driverId: string | null;
  date: string;
  status: string;
  scheduledDeparture: string | null;
  scheduledArrival: string | null;
  actualDepartureAt: string | null;
  actualArrivalAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  remarks: string | null;
  route?: { id: string; code: string; name: string };
  vehicle?: { id: string; registrationNumber: string } | null;
  driver?: { id: string; name: string } | null;
  tripStops?: TripStopRow[];
  alerts?: AlertRow[];
  _count?: { tripStops?: number; alerts?: number };
}

export interface TripStopRow {
  id: string;
  tripId: string;
  stopId: string;
  order: number;
  scheduledTime: string | null;
  actualArrivalAt: string | null;
  actualDepartureAt: string | null;
  studentsBoarded: number | null;
  studentsAlighted: number | null;
  skipped: boolean;
  notes: string | null;
  stop?: { id: string; name: string; address: string | null };
}

export interface MaintenanceRow {
  id: string;
  vehicleId: string;
  type: string;
  status: string;
  scheduledDate: string | null;
  startedAt: string | null;
  completedAt: string | null;
  odometerKm: number | null;
  description: string | null;
  vendor: string | null;
  costCents: number | null;
  performedBy: string | null;
  notes: string | null;
  createdAt: string;
  vehicle?: { id: string; registrationNumber: string; make: string | null; model: string | null };
}

export interface AlertRow {
  id: string;
  vehicleId: string | null;
  tripId: string | null;
  type: string;
  severity: string;
  title: string;
  message: string;
  latitude: number | null;
  longitude: number | null;
  acknowledgedAt: string | null;
  acknowledgedByUserId: string | null;
  resolvedAt: string | null;
  resolvedByUserId: string | null;
  resolution: string | null;
  createdAt: string;
  vehicle?: { id: string; registrationNumber: string } | null;
  trip?: {
    id: string;
    routeId: string | null;
    date: string;
    route: { code: string; name: string } | null;
  } | null;
}

export interface GpsConfigRow {
  id: string | null;
  tenantId: string;
  provider: string;
  enabled: boolean;
  pollEnabled: boolean;
  pollIntervalSeconds: number;
  settings: Record<string, unknown> | null;
  lastPolledAt: string | null;
}

export interface GpsPositionRow {
  id: string;
  vehicleId: string;
  latitude: number;
  longitude: number;
  speedKmh: number | null;
  heading: number | null;
  accuracyMeters: number | null;
  recordedAt: string;
  source: string | null;
}

export interface TransportSummary {
  vehicles: number;
  inServiceVehicles: number;
  drivers: number;
  routes: number;
  activePasses: number;
  overdueDocuments: number;
  scheduledTrips: number;
  ongoingTrips: number;
  openAlerts: number;
  openMaintenance: number;
}

export interface RouteLoadReportRow {
  routeId: string;
  code: string;
  name: string;
  allocated: number;
  perStop: { stopId: string; name: string; order: number; allocated: number }[];
  tripsToday: number;
  tripStatuses: Record<string, number>;
}

export interface VehicleUtilizationRow {
  vehicleId: string;
  registrationNumber: string;
  type: string;
  status: string;
  trips: number;
  completedTrips: number;
  maintenanceCostCents: number;
  gpsTracked: boolean;
}

export interface AlertsReport {
  bySeverity: { severity: string; _count: { _all: number } }[];
  byType: { type: string; _count: { _all: number } }[];
  recent: AlertRow[];
}