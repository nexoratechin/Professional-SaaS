import { columnMap, getReportDefinition } from './catalog';
import {
  ReportScopeError,
  type ExecuteReportOptions,
  type ReportColumn,
  type ReportDefinition,
  type ReportFilters,
  type ReportPrisma,
  type ReportResult,
  type ReportRow,
  type ReportScopeGrant,
  type ReportTemplateDefinition,
} from './types';

export const PREVIEW_LIMIT_DEFAULT = 100;
export const EXPORT_LIMIT_DEFAULT = 10_000;

type Shape = 'ADMISSIONS' | 'STUDENTS' | 'ATTENDANCE' | 'FEES' | 'EXAMS' | 'PLACEMENTS' | 'LIBRARY' | 'HOSTEL' | 'TRANSPORT' | 'INVENTORY';

interface ScopeResolution {
  allowed: boolean;
  clause?: unknown;
}

interface QueryPlan {
  delegate: keyof ReportPrisma;
  where: Record<string, unknown>;
  select: Record<string, unknown>;
  orderBy: Record<string, unknown>;
}

const MAX_FILTER_LENGTH = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function at(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const part of path.split('.')) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  return null;
}

function number(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function isoDate(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return text(value);
}

function escapeSearch(value: string): string {
  return value.slice(0, MAX_FILTER_LENGTH);
}

export function normalizeReportFilters(input: ReportFilters | undefined): ReportFilters {
  if (!input) return {};
  const result: ReportFilters = {};
  const stringKeys: Array<keyof ReportFilters> = [
    'dateFrom',
    'dateTo',
    'campusId',
    'departmentId',
    'programId',
    'sectionId',
    'academicYearId',
    'termId',
    'search',
    'status',
  ];
  for (const key of stringKeys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) {
      (result as Record<string, unknown>)[key] = value.trim().slice(0, MAX_FILTER_LENGTH);
    }
  }
  if (typeof input.includeInactive === 'boolean') result.includeInactive = input.includeInactive;
  if (result.dateFrom && result.dateTo && new Date(result.dateFrom).getTime() > new Date(result.dateTo).getTime()) {
    throw new ReportScopeError('The start date must be on or before the end date.');
  }
  return result;
}

function combine(...parts: Array<unknown | undefined | false>): Record<string, unknown> {
  const and = parts.filter((part): part is unknown => Boolean(part));
  return and.length ? { AND: and } : {};
}

function dateClause(field: string, filters: ReportFilters): unknown | undefined {
  const range: Record<string, Date> = {};
  if (filters.dateFrom) range.gte = new Date(filters.dateFrom);
  if (filters.dateTo) range.lte = new Date(filters.dateTo);
  return Object.keys(range).length ? { [field]: range } : undefined;
}

function searchClause(fields: string[], term: string): unknown {
  return { OR: fields.map((field) => ({ [field]: { contains: term, mode: 'insensitive' } })) };
}

function scopeConditions(shape: Shape, grant: ReportScopeGrant, actorUserId?: string): unknown | undefined {
  const { scopeType } = grant;
  if (scopeType === 'CAMPUS') {
    const campusId = grant.campusId;
    if (!campusId) return undefined;
    switch (shape) {
      case 'ADMISSIONS':
      case 'STUDENTS':
        return { campusId };
      case 'ATTENDANCE':
      case 'FEES':
      case 'PLACEMENTS':
      case 'HOSTEL':
        return { student: { campusId } };
      case 'TRANSPORT':
        return { OR: [{ student: { campusId } }, { route: { campusId } }] };
      case 'EXAMS':
        return { program: { department: { campusId } } };
      case 'LIBRARY':
        return { OR: [{ student: { campusId } }, { member: { student: { campusId } } }] };
      case 'INVENTORY':
        return { location: { campusId } };
    }
  }
  if (scopeType === 'DEPARTMENT') {
    const departmentId = grant.departmentId;
    if (!departmentId) return undefined;
    switch (shape) {
      case 'STUDENTS':
        return { program: { departmentId } };
      case 'ADMISSIONS':
        return { admissionProgram: { program: { departmentId } } };
      case 'EXAMS':
        return { program: { departmentId } };
      case 'ATTENDANCE':
      case 'FEES':
      case 'PLACEMENTS':
      case 'HOSTEL':
        return { student: { program: { departmentId } } };
      case 'TRANSPORT':
        return { student: { program: { departmentId } } };
      case 'LIBRARY':
        return { OR: [{ student: { program: { departmentId } } }, { member: { student: { program: { departmentId } } } }] };
      case 'INVENTORY':
        return undefined;
    }
  }
  if (scopeType === 'PROGRAM') {
    const programId = grant.programId;
    if (!programId) return undefined;
    switch (shape) {
      case 'STUDENTS':
        return { programId };
      case 'ADMISSIONS':
        return { admissionProgram: { programId } };
      case 'EXAMS':
        return { programId };
      case 'ATTENDANCE':
      case 'FEES':
      case 'PLACEMENTS':
      case 'HOSTEL':
      case 'TRANSPORT':
        return { student: { programId } };
      case 'LIBRARY':
        return { OR: [{ student: { programId } }, { member: { student: { programId } } }] };
      case 'INVENTORY':
        return undefined;
    }
  }
  if (scopeType === 'OWN') {
    if (!actorUserId) return undefined;
    switch (shape) {
      case 'STUDENTS':
        return { userId: actorUserId };
      case 'ATTENDANCE':
      case 'FEES':
      case 'PLACEMENTS':
      case 'HOSTEL':
      case 'TRANSPORT':
        return { student: { userId: actorUserId } };
      case 'EXAMS':
        return { registrations: { some: { student: { userId: actorUserId } } } };
      case 'LIBRARY':
        return { OR: [{ student: { userId: actorUserId } }, { member: { userId: actorUserId } }] };
      case 'ADMISSIONS':
      case 'INVENTORY':
        return undefined;
    }
  }
  return undefined;
}

export function resolveScope(shape: Shape, grants: ReportScopeGrant[], actorUserId?: string): ScopeResolution {
  if (!grants.length) return { allowed: false };
  if (grants.some((grant) => grant.scopeType === 'GLOBAL')) return { allowed: true };
  const clauses = grants
    .map((grant) => scopeConditions(shape, grant, actorUserId))
    .filter((clause): clause is unknown => Boolean(clause));
  if (!clauses.length) return { allowed: false };
  return { allowed: true, clause: clauses.length === 1 ? clauses[0] : { OR: clauses } };
}

function requestedCampus(shape: Shape, campusId: string): unknown {
  switch (shape) {
    case 'ADMISSIONS':
    case 'STUDENTS':
      return { campusId };
    case 'ATTENDANCE':
    case 'FEES':
    case 'PLACEMENTS':
    case 'HOSTEL':
      return { student: { campusId } };
    case 'TRANSPORT':
      return { OR: [{ student: { campusId } }, { route: { campusId } }] };
    case 'EXAMS':
      return { program: { department: { campusId } } };
    case 'LIBRARY':
      return { OR: [{ student: { campusId } }, { member: { student: { campusId } } }] };
    case 'INVENTORY':
      return { location: { campusId } };
  }
}

function requestedDepartment(shape: Shape, departmentId: string): unknown | undefined {
  switch (shape) {
    case 'STUDENTS':
      return { program: { departmentId } };
    case 'ADMISSIONS':
      return { admissionProgram: { program: { departmentId } } };
    case 'EXAMS':
      return { program: { departmentId } };
    case 'ATTENDANCE':
    case 'FEES':
    case 'PLACEMENTS':
    case 'HOSTEL':
    case 'TRANSPORT':
      return { student: { program: { departmentId } } };
    case 'LIBRARY':
      return { OR: [{ student: { program: { departmentId } } }, { member: { student: { program: { departmentId } } } }] };
    case 'INVENTORY':
      return undefined;
  }
}

function requestedProgram(shape: Shape, programId: string): unknown {
  switch (shape) {
    case 'STUDENTS':
      return { programId };
    case 'ADMISSIONS':
      return { admissionProgram: { programId } };
    case 'EXAMS':
      return { programId };
    case 'ATTENDANCE':
    case 'FEES':
    case 'PLACEMENTS':
    case 'HOSTEL':
    case 'TRANSPORT':
      return { student: { programId } };
    case 'LIBRARY':
      return { OR: [{ student: { programId } }, { member: { student: { programId } } }] };
    case 'INVENTORY':
      return undefined;
  }
}

function requestedSection(shape: Shape, sectionId: string): unknown | undefined {
  switch (shape) {
    case 'STUDENTS':
      return { sectionId };
    case 'ATTENDANCE':
      return { student: { sectionId } };
    default:
      return undefined;
  }
}

const SELECTS: Record<Shape, Record<string, unknown>> = {
  ADMISSIONS: {
    id: true,
    applicationNumber: true,
    fullName: true,
    status: true,
    submittedAt: true,
    createdAt: true,
    meritScore: true,
    meritRank: true,
    campus: { select: { name: true, code: true } },
    session: { select: { name: true, code: true } },
    academicYear: { select: { name: true, code: true } },
    admissionProgram: { select: { programId: true, program: { select: { name: true, code: true } } } },
  },
  STUDENTS: {
    id: true,
    admissionNumber: true,
    rollNumber: true,
    registrationNumber: true,
    fullName: true,
    status: true,
    gender: true,
    category: true,
    email: true,
    primaryPhone: true,
    admittedOn: true,
    dateOfBirth: true,
    campus: { select: { name: true, code: true } },
    program: { select: { name: true, code: true, department: { select: { name: true, code: true } } } },
    section: { select: { name: true, code: true } },
    batch: { select: { name: true, code: true } },
    academicYear: { select: { name: true, code: true } },
  },
  ATTENDANCE: {
    id: true,
    date: true,
    attendanceType: true,
    subjectCode: true,
    subjectName: true,
    status: true,
    markMethod: true,
    student: { select: { admissionNumber: true, fullName: true, campusId: true, program: { select: { name: true } }, section: { select: { name: true } } } },
    term: { select: { name: true, code: true } },
  },
  FEES: {
    id: true,
    headCode: true,
    headName: true,
    amountCents: true,
    paidCents: true,
    waivedCents: true,
    lateFeeCents: true,
    status: true,
    dueDate: true,
    createdAt: true,
    student: { select: { admissionNumber: true, fullName: true, campusId: true, program: { select: { name: true } } } },
    term: { select: { name: true, code: true } },
    demand: { select: { demandNumber: true } },
  },
  EXAMS: {
    id: true,
    name: true,
    code: true,
    status: true,
    examType: true,
    startDate: true,
    endDate: true,
    resultDeclarationDate: true,
    program: { select: { name: true, code: true, department: { select: { name: true, code: true } } } },
    academicYear: { select: { name: true, code: true } },
    term: { select: { name: true, code: true } },
    _count: { select: { subjects: true, registrations: true } },
  },
  PLACEMENTS: {
    id: true,
    outcomeStatus: true,
    finalPackageCents: true,
    placedAt: true,
    createdAt: true,
    student: { select: { admissionNumber: true, fullName: true, campusId: true, program: { select: { name: true } } } },
    academicYear: { select: { name: true, code: true } },
    drive: { select: { title: true, company: { select: { name: true } } } },
    position: { select: { title: true, location: true } },
  },
  LIBRARY: {
    id: true,
    itemTitle: true,
    itemAuthor: true,
    itemCode: true,
    itemType: true,
    borrowedAt: true,
    dueDate: true,
    returnedAt: true,
    status: true,
    fineCents: true,
    student: { select: { admissionNumber: true, fullName: true, campusId: true, program: { select: { name: true } } } },
    member: { select: { memberNumber: true, fullName: true, userId: true } },
    copy: { select: { accessionNumber: true, book: { select: { title: true } } } },
  },
  HOSTEL: {
    id: true,
    hostelName: true,
    roomNumber: true,
    bedNumber: true,
    allocationDate: true,
    checkInDate: true,
    checkOutDate: true,
    status: true,
    monthlyRentCents: true,
    student: { select: { admissionNumber: true, fullName: true, campusId: true, program: { select: { name: true } } } },
    hostel: { select: { name: true, code: true, campus: { select: { name: true } } } },
  },
  TRANSPORT: {
    id: true,
    routeCode: true,
    routeName: true,
    pickupPoint: true,
    dropPoint: true,
    vehicleNumber: true,
    periodStart: true,
    periodEnd: true,
    status: true,
    amountCents: true,
    dailyPickupTime: true,
    dailyDropTime: true,
    student: { select: { admissionNumber: true, fullName: true, campusId: true, program: { select: { name: true } } } },
    route: { select: { name: true, code: true, campus: { select: { name: true } } } },
  },
  INVENTORY: {
    id: true,
    quantityOnHand: true,
    reservedQuantity: true,
    lastMovementAt: true,
    product: {
      select: {
        code: true,
        name: true,
        unit: true,
        reorderLevel: true,
        unitPriceCents: true,
        isActive: true,
        category: { select: { name: true, code: true } },
      },
    },
    location: { select: { code: true, name: true, type: true, campus: { select: { name: true } } } },
  },
};

const ORDER_BY: Record<Shape, Record<string, unknown>> = {
  ADMISSIONS: { createdAt: 'desc' },
  STUDENTS: { admissionNumber: 'asc' },
  ATTENDANCE: { date: 'desc' },
  FEES: { dueDate: 'asc' },
  EXAMS: { startDate: 'desc' },
  PLACEMENTS: { placedAt: 'desc' },
  LIBRARY: { borrowedAt: 'desc' },
  HOSTEL: { allocationDate: 'desc' },
  TRANSPORT: { periodStart: 'desc' },
  INVENTORY: { lastMovementAt: 'desc' },
};

function baseWhere(shape: Shape, filters: ReportFilters): Array<unknown> {
  const parts: Array<unknown | undefined> = [];
  if (filters.campusId) parts.push(requestedCampus(shape, filters.campusId));
  if (filters.departmentId) parts.push(requestedDepartment(shape, filters.departmentId));
  if (filters.programId) parts.push(requestedProgram(shape, filters.programId));
  if (filters.sectionId) parts.push(requestedSection(shape, filters.sectionId));
  if (filters.academicYearId) {
    if (shape === 'STUDENTS' || shape === 'ADMISSIONS' || shape === 'EXAMS' || shape === 'PLACEMENTS') {
      parts.push({ academicYearId: filters.academicYearId });
    } else if (shape === 'FEES' || shape === 'ATTENDANCE' || shape === 'HOSTEL' || shape === 'TRANSPORT') {
      parts.push({ student: { academicYearId: filters.academicYearId } });
    }
  }
  if (filters.termId) {
    if (shape === 'EXAMS' || shape === 'ATTENDANCE' || shape === 'FEES') parts.push({ termId: filters.termId });
    else if (shape === 'STUDENTS') parts.push({ enrollments: { some: { termId: filters.termId } } });
  }
  if (filters.status) parts.push({ status: filters.status });
  const dateField: Record<Shape, string> = {
    ADMISSIONS: 'submittedAt',
    STUDENTS: 'admittedOn',
    ATTENDANCE: 'date',
    FEES: 'dueDate',
    EXAMS: 'startDate',
    PLACEMENTS: 'placedAt',
    LIBRARY: 'borrowedAt',
    HOSTEL: 'allocationDate',
    TRANSPORT: 'periodStart',
    INVENTORY: 'lastMovementAt',
  };
  parts.push(dateClause(dateField[shape], filters));
  if (filters.search) {
    const term = escapeSearch(filters.search);
    switch (shape) {
      case 'ADMISSIONS':
        parts.push(searchClause(['applicationNumber', 'fullName', 'email', 'phone'], term));
        break;
      case 'STUDENTS':
        parts.push(searchClause(['fullName', 'admissionNumber', 'rollNumber', 'registrationNumber', 'email', 'primaryPhone'], term));
        break;
      case 'ATTENDANCE':
        parts.push({
          OR: [
            { subjectName: { contains: term, mode: 'insensitive' } },
            { subjectCode: { contains: term, mode: 'insensitive' } },
            { student: { fullName: { contains: term, mode: 'insensitive' } } },
            { student: { admissionNumber: { contains: term, mode: 'insensitive' } } },
          ],
        });
        break;
      case 'FEES':
        parts.push({
          OR: [
            { headName: { contains: term, mode: 'insensitive' } },
            { headCode: { contains: term, mode: 'insensitive' } },
            { student: { fullName: { contains: term, mode: 'insensitive' } } },
            { student: { admissionNumber: { contains: term, mode: 'insensitive' } } },
          ],
        });
        break;
      case 'EXAMS':
        parts.push(searchClause(['name', 'code'], term));
        break;
      case 'PLACEMENTS':
        parts.push({
          OR: [
            { student: { fullName: { contains: term, mode: 'insensitive' } } },
            { student: { admissionNumber: { contains: term, mode: 'insensitive' } } },
            { drive: { title: { contains: term, mode: 'insensitive' } } },
            { drive: { company: { name: { contains: term, mode: 'insensitive' } } } },
          ],
        });
        break;
      case 'LIBRARY':
        parts.push({
          OR: [
            { itemTitle: { contains: term, mode: 'insensitive' } },
            { itemAuthor: { contains: term, mode: 'insensitive' } },
            { itemCode: { contains: term, mode: 'insensitive' } },
            { member: { fullName: { contains: term, mode: 'insensitive' } } },
            { student: { fullName: { contains: term, mode: 'insensitive' } } },
          ],
        });
        break;
      case 'HOSTEL':
        parts.push({
          OR: [
            { hostelName: { contains: term, mode: 'insensitive' } },
            { roomNumber: { contains: term, mode: 'insensitive' } },
            { student: { fullName: { contains: term, mode: 'insensitive' } } },
            { student: { admissionNumber: { contains: term, mode: 'insensitive' } } },
          ],
        });
        break;
      case 'TRANSPORT':
        parts.push({
          OR: [
            { routeName: { contains: term, mode: 'insensitive' } },
            { routeCode: { contains: term, mode: 'insensitive' } },
            { vehicleNumber: { contains: term, mode: 'insensitive' } },
            { student: { fullName: { contains: term, mode: 'insensitive' } } },
          ],
        });
        break;
      case 'INVENTORY':
        parts.push({
          OR: [
            { product: { name: { contains: term, mode: 'insensitive' } } },
            { product: { code: { contains: term, mode: 'insensitive' } } },
            { location: { name: { contains: term, mode: 'insensitive' } } },
            { location: { code: { contains: term, mode: 'insensitive' } } },
          ],
        });
        break;
    }
  }
  return parts.filter((part): part is unknown => Boolean(part));
}

function buildWhere(shape: Shape, filters: ReportFilters, scope: ScopeResolution): Record<string, unknown> {
  if (!scope.allowed) throw new ReportScopeError('Your report scope does not grant access to this data.');
  const parts = baseWhere(shape, filters);
  if (scope.clause) parts.push(scope.clause);
  return combine(...parts);
}

function mapAdmissions(row: Record<string, unknown>): ReportRow {
  const program = at(row, 'admissionProgram.program');
  return {
    id: String(row.id ?? ''),
    applicationNumber: text(row.applicationNumber),
    fullName: text(row.fullName),
    session: text(at(row, 'session.name')) ?? text(at(row, 'session.code')),
    program: text(at(program, 'name')) ?? text(at(program, 'code')),
    campus: text(at(row, 'campus.name')),
    status: text(row.status),
    meritScore: number(row.meritScore),
    meritRank: number(row.meritRank),
    submittedAt: isoDate(row.submittedAt) ?? isoDate(row.createdAt),
  };
}

function mapStudents(row: Record<string, unknown>): ReportRow {
  return {
    id: String(row.id ?? ''),
    admissionNumber: text(row.admissionNumber),
    rollNumber: text(row.rollNumber),
    registrationNumber: text(row.registrationNumber),
    fullName: text(row.fullName),
    status: text(row.status),
    gender: text(row.gender),
    category: text(row.category),
    email: text(row.email),
    primaryPhone: text(row.primaryPhone),
    campus: text(at(row, 'campus.name')),
    program: text(at(row, 'program.name')),
    department: text(at(row, 'program.department.name')),
    section: text(at(row, 'section.name')),
    batch: text(at(row, 'batch.name')),
    admittedOn: isoDate(row.admittedOn),
  };
}

function mapAttendance(row: Record<string, unknown>): ReportRow {
  const subject = [text(row.subjectName), text(row.subjectCode)].filter(Boolean).join(' · ');
  return {
    id: String(row.id ?? ''),
    date: isoDate(row.date),
    admissionNumber: text(at(row, 'student.admissionNumber')),
    student: text(at(row, 'student.fullName')),
    program: text(at(row, 'student.program.name')),
    section: text(at(row, 'student.section.name')),
    subject: subject || null,
    attendanceType: text(row.attendanceType),
    status: text(row.status),
    markMethod: text(row.markMethod),
    term: text(at(row, 'term.name')) ?? text(at(row, 'term.code')),
  };
}

function mapFees(row: Record<string, unknown>): ReportRow {
  const amount = number(row.amountCents) ?? 0;
  const paid = number(row.paidCents) ?? 0;
  const waived = number(row.waivedCents) ?? 0;
  const late = number(row.lateFeeCents) ?? 0;
  return {
    id: String(row.id ?? ''),
    admissionNumber: text(at(row, 'student.admissionNumber')),
    student: text(at(row, 'student.fullName')),
    program: text(at(row, 'student.program.name')),
    headCode: text(row.headCode),
    headName: text(row.headName),
    amountCents: amount,
    paidCents: paid,
    waivedCents: waived,
    lateFeeCents: late,
    balanceCents: Math.max(0, amount + late - paid - waived),
    status: text(row.status),
    dueDate: isoDate(row.dueDate),
    demandNumber: text(at(row, 'demand.demandNumber')),
    term: text(at(row, 'term.name')) ?? text(at(row, 'term.code')),
  };
}

function mapExams(row: Record<string, unknown>): ReportRow {
  return {
    id: String(row.id ?? ''),
    code: text(row.code),
    name: text(row.name),
    program: text(at(row, 'program.name')),
    department: text(at(row, 'program.department.name')),
    term: text(at(row, 'term.name')) ?? text(at(row, 'term.code')),
    status: text(row.status),
    examType: text(row.examType),
    subjectCount: number(at(row, '_count.subjects')) ?? 0,
    registrationCount: number(at(row, '_count.registrations')) ?? 0,
    startDate: isoDate(row.startDate),
    endDate: isoDate(row.endDate),
  };
}

function mapPlacements(row: Record<string, unknown>): ReportRow {
  return {
    id: String(row.id ?? ''),
    student: text(at(row, 'student.fullName')),
    admissionNumber: text(at(row, 'student.admissionNumber')),
    program: text(at(row, 'student.program.name')),
    company: text(at(row, 'drive.company.name')),
    position: text(at(row, 'position.title')) ?? text(at(row, 'position.location')),
    outcomeStatus: text(row.outcomeStatus),
    finalPackageCents: number(row.finalPackageCents),
    placedAt: isoDate(row.placedAt),
    academicYear: text(at(row, 'academicYear.name')) ?? text(at(row, 'academicYear.code')),
  };
}

function mapLibrary(row: Record<string, unknown>): ReportRow {
  return {
    id: String(row.id ?? ''),
    itemTitle: text(at(row, 'copy.book.title')) ?? text(row.itemTitle),
    itemAuthor: text(row.itemAuthor),
    itemCode: text(row.itemCode) ?? text(at(row, 'copy.accessionNumber')),
    member: text(at(row, 'member.fullName')) ?? text(at(row, 'student.fullName')),
    memberNumber: text(at(row, 'member.memberNumber')),
    status: text(row.status),
    borrowedAt: isoDate(row.borrowedAt),
    dueDate: isoDate(row.dueDate),
    returnedAt: isoDate(row.returnedAt),
    fineCents: number(row.fineCents) ?? 0,
  };
}

function mapHostel(row: Record<string, unknown>): ReportRow {
  return {
    id: String(row.id ?? ''),
    student: text(at(row, 'student.fullName')),
    admissionNumber: text(at(row, 'student.admissionNumber')),
    hostelName: text(at(row, 'hostel.name')) ?? text(row.hostelName),
    campus: text(at(row, 'hostel.campus.name')),
    roomNumber: text(row.roomNumber),
    bedNumber: text(row.bedNumber),
    status: text(row.status),
    monthlyRentCents: number(row.monthlyRentCents),
    allocationDate: isoDate(row.allocationDate),
    checkInDate: isoDate(row.checkInDate),
    checkOutDate: isoDate(row.checkOutDate),
  };
}

function mapTransport(row: Record<string, unknown>): ReportRow {
  return {
    id: String(row.id ?? ''),
    student: text(at(row, 'student.fullName')),
    admissionNumber: text(at(row, 'student.admissionNumber')),
    routeName: text(at(row, 'route.name')) ?? text(row.routeName),
    routeCode: text(at(row, 'route.code')) ?? text(row.routeCode),
    pickupPoint: text(row.pickupPoint),
    vehicleNumber: text(row.vehicleNumber),
    status: text(row.status),
    amountCents: number(row.amountCents),
    periodStart: isoDate(row.periodStart),
    periodEnd: isoDate(row.periodEnd),
  };
}

function mapInventory(row: Record<string, unknown>): ReportRow {
  return {
    id: String(row.id ?? ''),
    productCode: text(at(row, 'product.code')),
    product: text(at(row, 'product.name')),
    category: text(at(row, 'product.category.name')),
    location: text(at(row, 'location.name')),
    locationCode: text(at(row, 'location.code')),
    campus: text(at(row, 'location.campus.name')),
    quantityOnHand: number(row.quantityOnHand) ?? 0,
    reservedQuantity: number(row.reservedQuantity) ?? 0,
    reorderLevel: number(at(row, 'product.reorderLevel')) ?? 0,
    unitPriceCents: number(at(row, 'product.unitPriceCents')),
    lastMovementAt: isoDate(row.lastMovementAt),
  };
}

const MAPPERS: Record<Shape, (row: Record<string, unknown>) => ReportRow> = {
  ADMISSIONS: mapAdmissions,
  STUDENTS: mapStudents,
  ATTENDANCE: mapAttendance,
  FEES: mapFees,
  EXAMS: mapExams,
  PLACEMENTS: mapPlacements,
  LIBRARY: mapLibrary,
  HOSTEL: mapHostel,
  TRANSPORT: mapTransport,
  INVENTORY: mapInventory,
};

function summarize(shape: Shape, rows: ReportRow[]): Record<string, number> {
  const summary: Record<string, number> = { rows: rows.length };
  if (shape === 'FEES') {
    summary.billedCents = rows.reduce((total, row) => total + (number(row.amountCents) ?? 0), 0);
    summary.paidCents = rows.reduce((total, row) => total + (number(row.paidCents) ?? 0), 0);
    summary.balanceCents = rows.reduce((total, row) => total + (number(row.balanceCents) ?? 0), 0);
  } else if (shape === 'PLACEMENTS') {
    const placed = rows.filter((row) => row.outcomeStatus === 'PLACED');
    summary.placed = placed.length;
    summary.averagePackageCents = placed.length
      ? Math.round(placed.reduce((total, row) => total + (number(row.finalPackageCents) ?? 0), 0) / placed.length)
      : 0;
  } else if (shape === 'LIBRARY') {
    summary.fineCents = rows.reduce((total, row) => total + (number(row.fineCents) ?? 0), 0);
  } else if (shape === 'INVENTORY') {
    summary.quantityOnHand = rows.reduce((total, row) => total + (number(row.quantityOnHand) ?? 0), 0);
  }
  return summary;
}

function applyTemplate(definition: ReportDefinition, template: ReportTemplateDefinition | null | undefined): ReportColumn[] {
  if (!template?.columns?.length) return definition.columns;
  const available = columnMap(definition);
  const columns: ReportColumn[] = [];
  for (const override of template.columns) {
    const column = available.get(override.key);
    if (!column) continue;
    columns.push({ ...column, ...(override.label ? { label: override.label } : {}), ...(override.align ? { align: override.align } : {}) });
  }
  return columns.length ? columns : definition.columns;
}

export async function executeReport(
  prisma: ReportPrisma,
  reportType: string,
  filtersInput: ReportFilters | undefined,
  scopeGrants: ReportScopeGrant[],
  options: ExecuteReportOptions = {},
): Promise<ReportResult> {
  const definition = getReportDefinition(reportType);
  if (!definition) throw new ReportScopeError(`Unknown report type: ${reportType}`);
  const shape = definition.reportType as Shape;
  const filters = normalizeReportFilters(filtersInput);
  const scope = resolveScope(shape, scopeGrants, options.actorUserId);
  const where = buildWhere(shape, filters, scope);
  const limit = Math.max(1, Math.min(options.limit ?? (options.mode === 'export' ? EXPORT_LIMIT_DEFAULT : PREVIEW_LIMIT_DEFAULT), EXPORT_LIMIT_DEFAULT));

  const delegateKey: keyof ReportPrisma = {
    ADMISSIONS: 'admissionApplication',
    STUDENTS: 'student',
    ATTENDANCE: 'studentAttendance',
    FEES: 'studentFee',
    EXAMS: 'examSession',
    PLACEMENTS: 'placementOutcome',
    LIBRARY: 'studentLibraryLoan',
    HOSTEL: 'studentHostelBooking',
    TRANSPORT: 'studentTransportPass',
    INVENTORY: 'inventoryStockItem',
  }[shape] as keyof ReportPrisma;

  const plan: QueryPlan = {
    delegate: delegateKey,
    where,
    select: SELECTS[shape],
    orderBy: ORDER_BY[shape],
  };

  const [rawRows, totalCount] = await Promise.all([
    prisma[plan.delegate].findMany({ where: plan.where, select: plan.select, orderBy: plan.orderBy, take: limit }),
    prisma[plan.delegate].count({ where: plan.where }),
  ]);

  const rows = rawRows.map((row) => MAPPERS[shape](asRecord(row)));
  const columns = applyTemplate(definition, options.template);

  return {
    definition,
    columns,
    rows,
    summary: summarize(shape, rows),
    rowCount: rows.length,
    totalCount,
    truncated: totalCount > rows.length,
    generatedAt: (options.now ?? new Date()).toISOString(),
    filters,
  };
}
