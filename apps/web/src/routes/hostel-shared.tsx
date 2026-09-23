/** Hostel module shared types & constants — mirrors the payloads returned by the hostel API
 * (`apps/api/src/modules/hostel`). All taxonomies are stringly-typed over the wire (the module
 * deliberately exports no native Prisma enum values). */

export const HOSTEL_VIEW_PERMISSION = 'hostel.view';
export const HOSTEL_CREATE_PERMISSION = 'hostel.create';
export const HOSTEL_UPDATE_PERMISSION = 'hostel.update';
export const HOSTEL_DELETE_PERMISSION = 'hostel.delete';
export const HOSTEL_MANAGE_PERMISSION = 'hostel.manage';

export interface Paged<T> {
  data: T[];
  total: number;
}

export interface LookupOption {
  id: string;
  code: string;
  name: string;
}

export interface StudentRef {
  id: string;
  fullName: string;
  admissionNumber: string | null;
  rollNumber: string | null;
  userId: string | null;
}

export interface CampusRef {
  id: string;
  name: string;
}

export interface LookupsPayload {
  campuses: LookupOption[];
  hostels: (LookupOption & {
    genderType?: string;
    _count?: { buildings?: number; complaints?: number; bookings?: number };
  })[];
  buildings: (LookupOption & { hostelId: string })[];
  floors: (LookupOption & { buildingId: string; floorNumber: number })[];
  rooms: (LookupOption & {
    floorId: string;
    sharing: string;
    bedCapacity: number;
    monthlyRentCents: number;
    isActive: boolean;
  })[];
  beds: (LookupOption & { roomId: string; status: string; monthlyRentCents: number | null; isActive: boolean })[];
  feeHeads: LookupOption[];
  genderTypes: string[];
  roomSharing: string[];
  bedStatuses: string[];
  wardenRoles: string[];
  complaintCategories: string[];
  complaintStatuses: string[];
  visitorStatuses: string[];
  bookingStatuses: string[];
  feeStatuses: string[];
}

export interface HostelWardenRow {
  id: string;
  hostelId: string;
  userId: string;
  role: string;
  isActive: boolean;
  assignedBy: string | null;
  createdAt: string;
  updatedAt: string;
  hostel: { id: string; code: string; name: string };
}

export interface HostelRow {
  id: string;
  campusId: string;
  code: string;
  name: string;
  genderType: string;
  wardenUserId: string | null;
  description: string | null;
  feeHeadId: string | null;
  feeHead: { id: string; code: string; name: string } | null;
  chargeRentOnCheckIn: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  campus?: CampusRef;
  wardens?: { id: string; userId: string; role: string }[];
  _count?: { buildings?: number; complaints?: number; bookings?: number };
}

export interface BuildingRow {
  id: string;
  hostelId: string;
  code: string;
  name: string;
  isActive: boolean;
  hostel?: { id: string; code: string; name: string };
  _count?: { floors?: number; bookings?: number };
}

export interface FloorRow {
  id: string;
  buildingId: string;
  floorNumber: number;
  name: string | null;
  isActive: boolean;
  building?: { id: string; code: string; name: string };
  _count?: { rooms?: number; bookings?: number };
}

export interface RoomRow {
  id: string;
  floorId: string;
  code: string;
  name: string | null;
  sharing: string;
  bedCapacity: number;
  monthlyRentCents: number;
  hasAttachedBath: boolean;
  notes: string | null;
  isActive: boolean;
  floor?: {
    id: string;
    floorNumber: number;
    building: { id: string; code: string; name: string; hostel: { id: string; code: string; name: string } };
  };
  _count?: { beds?: number; bookings?: number };
}

export interface BedRef {
  id: string;
  code: string;
}

export interface BedRow {
  id: string;
  roomId: string;
  code: string;
  status: string;
  monthlyRentCents: number | null;
  notes: string | null;
  isActive: boolean;
  room?: {
    id: string;
    code: string;
    name: string | null;
    floor: {
      id: string;
      floorNumber: number;
      name: string | null;
      building: { id: string; code: string; name: string; hostel: { id: string; code: string; name: string } };
    };
  };
  bookings?: { id: string; student: { id: string; fullName: string; admissionNumber: string | null } }[];
}

export interface BookingRow {
  id: string;
  tenantId: string;
  studentId: string;
  hostelId: string | null;
  buildingId: string | null;
  floorId: string | null;
  roomId: string | null;
  bedId: string | null;
  previousBookingId: string | null;
  hostelName: string;
  roomNumber: string;
  bedNumber: string | null;
  allocationDate: string | null;
  checkInDate: string | null;
  checkOutDate: string | null;
  status: string;
  monthlyRentCents: number | null;
  remarks: string | null;
  createdAt: string;
  updatedAt: string;
  student: StudentRef & { program: { id: string; name: string; code: string } | null };
  hostel: { id: string; code: string; name: string; genderType: string } | null;
  building: { id: string; code: string; name: string } | null;
  floor: { id: string; floorNumber: number; name: string | null } | null;
  room: { id: string; code: string; name: string | null } | null;
  bed: BedRef | null;
}

export interface ChargeRow {
  id: string;
  studentId: string;
  headCode: string;
  headName: string;
  amountCents: number;
  paidCents: number;
  waivedCents: number;
  lateFeeCents: number;
  status: string;
  dueDate: string | null;
  remarks: string | null;
  createdAt: string;
  student: { id: string; fullName: string; admissionNumber: string | null };
  hostelBooking: {
    id: string;
    hostelId: string | null;
    roomId: string | null;
    roomNumber: string;
    hostel: { id: string; name: string; code: string } | null;
  } | null;
}

export interface ComplaintRow {
  id: string;
  hostelId: string;
  studentId: string | null;
  roomId: string | null;
  category: string;
  priority: string;
  status: string;
  subject: string;
  description: string;
  assignedToUserId: string | null;
  assignedAt: string | null;
  resolvedByUserId: string | null;
  resolutionNotes: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  hostel: { id: string; name: string; code: string };
  student: { id: string; fullName: string; admissionNumber: string | null; userId: string | null } | null;
  room: { id: string; code: string } | null;
}

export interface VisitorRow {
  id: string;
  hostelId: string;
  visitorName: string;
  phone: string | null;
  email: string | null;
  idProofType: string | null;
  idProofNumber: string | null;
  purpose: string | null;
  studentId: string | null;
  visitorLabel: string | null;
  checkInAt: string;
  checkOutAt: string | null;
  status: string;
  recordedByUserId: string | null;
  notes: string | null;
  hostel: { id: string; name: string; code: string };
  student: { id: string; fullName: string; admissionNumber: string | null } | null;
}

export interface SearchableUser {
  id: string;
  fullName: string;
  email: string;
}

export interface SearchableStudent {
  id: string;
  fullName: string;
  admissionNumber: string | null;
  rollNumber: string | null;
  userId: string | null;
}

export interface SummaryPerHostel {
  hostelId: string;
  code: string;
  name: string;
  genderType: string;
  campusId: string;
  totalBuildings: number;
  totalFloors: number;
  totalRooms: number;
  totalBeds: number;
  availableBeds: number;
  reservedBeds: number;
  occupiedBeds: number;
  maintenanceBeds: number;
  occupancyRate: number;
  activeBookings: number;
  openComplaints: number;
  visitorsInside: number;
}

export interface HostelSummary {
  hostels: SummaryPerHostel[];
  totals: SummaryPerHostel;
}

export interface OccupancyBedRef {
  id: string;
  code: string;
  status: string;
  room: {
    id: string;
    code: string;
    floor: {
      id: string;
      floorNumber: number;
      name: string | null;
      building: { id: string; code: string; name: string; hostel: { id: string; code: string; name: string } };
    };
  };
}

export interface OccupancyReport {
  bookings: BookingRow[];
  beds: OccupancyBedRef[];
  total: number;
}

export interface VacancyBedRef {
  id: string;
  code: string;
  monthlyRentCents: number | null;
  room: {
    id: string;
    code: string;
    name: string | null;
    sharing: string;
    floor: {
      id: string;
      floorNumber: number;
      name: string | null;
      building: { id: string; code: string; name: string; hostel: { id: string; code: string; name: string } };
    };
  };
}

export interface VacancyReport {
  data: VacancyBedRef[];
  total: number;
}

export interface HistoryReport {
  roomId?: string;
  studentId?: string;
  data: BookingRow[];
  total: number;
}

export interface DuesReport {
  data: (ChargeRow & {
    hostelBooking: { id: string; roomNumber: string; bedNumber: string | null; hostel: { id: string; code: string; name: string } | null };
  })[];
  total: number;
  totalDueCents: number;
}

export interface ComplaintDist {
  status: string;
  count: number;
}

export interface ComplaintsReport {
  total: number;
  byStatus: ComplaintDist[];
  byCategory: ComplaintDist[];
  byPriority: ComplaintDist[];
}