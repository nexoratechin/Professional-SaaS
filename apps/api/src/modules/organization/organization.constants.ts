/**
 * Single source of truth for every organization entity's RBAC keys, audit-action constants,
 * Prisma-model name, CSV-column mapping, and parent-foreign-key metadata. Keeps the
 * service, controller, import/export, and hierarchy logic DRY and self-documenting.
 */

import {
  PERMISSION_KEYS as K,
  AUDIT_ACTIONS as A,
  type PermissionKey,
  type AuditAction,
} from '@college-erp/auth';

// ── Entity identifiers ────────────────────────────────────────────────────────

export const ENTITY_NAMES = [
  'campus',
  'department',
  'program',
  'academicYear',
  'term',
  'room',
  'building',
  'section',
  'batch',
] as const;

export type EntityName = (typeof ENTITY_NAMES)[number];

// ── Entity metadata ───────────────────────────────────────────────────────────

export interface OrganizationEntityMeta {
  /** Model name as Prisma expects in `findMany({ where: { ... } })` via the TenantScopedPrismaClient. */
  model: string;
  /** PascalCase entity name for audit entityType / error messages. */
  entityType: string;
  viewKey: PermissionKey;
  manageKey: PermissionKey;
  createAuditAction: AuditAction;
  updateAuditAction: AuditAction;
  archiveAuditAction: AuditAction;
  /**
   * CSV column definitions. The first tuple element is the header string the user sees
   * (and that appears in exported CSVs); the second is the JS field name written by
   * parseCsvToRows / consumed by the service.  Nullable fields are declared as such;
   * booleans are lowercase 'true'/'false' strings in the CSV.
   */
  csvColumns: ReadonlyArray<readonly [header: string, field: string]>;
  /**
   * Parent-reference columns that must be resolved from *code* to *id* at import time.
   * `header` matches a csvColumns header; `refEntity` is the parent EntityName whose code
   * column (the parent's first csvColumn) matches.  The service resolves these once before
   * upserting, so N import rows don't incur N lookups.
   */
  parentRefs?: ReadonlyArray<{ header: string; field: string; refEntity: EntityName }>;
}

export const ENTITY_META: Record<EntityName, OrganizationEntityMeta> = {
  campus: {
    model: 'campus',
    entityType: 'Campus',
    viewKey: K.CAMPUSES_VIEW,
    manageKey: K.CAMPUSES_MANAGE,
    createAuditAction: A.CAMPUS_CREATED,
    updateAuditAction: A.CAMPUS_UPDATED,
    archiveAuditAction: A.CAMPUS_ARCHIVED,
    csvColumns: [
      ['code', 'code'],
      ['name', 'name'],
      ['addressLine', 'addressLine'],
      ['city', 'city'],
      ['state', 'state'],
      ['country', 'country'],
      ['isActive', 'isActive'],
    ],
  },

  department: {
    model: 'department',
    entityType: 'Department',
    viewKey: K.DEPARTMENTS_VIEW,
    manageKey: K.DEPARTMENTS_MANAGE,
    createAuditAction: A.DEPARTMENT_CREATED,
    updateAuditAction: A.DEPARTMENT_UPDATED,
    archiveAuditAction: A.DEPARTMENT_ARCHIVED,
    csvColumns: [
      ['code', 'code'],
      ['name', 'name'],
      ['description', 'description'],
      ['campus', 'campusId'],
      ['isActive', 'isActive'],
    ],
    parentRefs: [{ header: 'campus', field: 'campusId', refEntity: 'campus' }],
  },

  program: {
    model: 'program',
    entityType: 'Program',
    viewKey: K.PROGRAMS_VIEW,
    manageKey: K.PROGRAMS_MANAGE,
    createAuditAction: A.PROGRAM_CREATED,
    updateAuditAction: A.PROGRAM_UPDATED,
    archiveAuditAction: A.PROGRAM_ARCHIVED,
    csvColumns: [
      ['code', 'code'],
      ['name', 'name'],
      ['degreeLevel', 'degreeLevel'],
      ['durationYears', 'durationYears'],
      ['department', 'departmentId'],
      ['isActive', 'isActive'],
    ],
    parentRefs: [{ header: 'department', field: 'departmentId', refEntity: 'department' }],
  },

  academicYear: {
    model: 'academicYear',
    entityType: 'AcademicYear',
    viewKey: K.ACADEMIC_YEARS_VIEW,
    manageKey: K.ACADEMIC_YEARS_MANAGE,
    createAuditAction: A.ACADEMIC_YEAR_CREATED,
    updateAuditAction: A.ACADEMIC_YEAR_UPDATED,
    archiveAuditAction: A.ACADEMIC_YEAR_ARCHIVED,
    csvColumns: [
      ['code', 'code'],
      ['name', 'name'],
      ['startDate', 'startDate'],
      ['endDate', 'endDate'],
      ['isCurrent', 'isCurrent'],
    ],
  },

  term: {
    model: 'term',
    entityType: 'Term',
    viewKey: K.TERMS_VIEW,
    manageKey: K.TERMS_MANAGE,
    createAuditAction: A.TERM_CREATED,
    updateAuditAction: A.TERM_UPDATED,
    archiveAuditAction: A.TERM_ARCHIVED,
    csvColumns: [
      ['academicYear', 'academicYearId'],
      ['code', 'code'],
      ['name', 'name'],
      ['sequence', 'sequence'],
      ['startDate', 'startDate'],
      ['endDate', 'endDate'],
      ['isCurrent', 'isCurrent'],
    ],
    parentRefs: [{ header: 'academicYear', field: 'academicYearId', refEntity: 'academicYear' }],
  },

  room: {
    model: 'room',
    entityType: 'Room',
    viewKey: K.ROOMS_VIEW,
    manageKey: K.ROOMS_MANAGE,
    createAuditAction: A.ROOM_CREATED,
    updateAuditAction: A.ROOM_UPDATED,
    archiveAuditAction: A.ROOM_ARCHIVED,
    csvColumns: [
      ['code', 'code'],
      ['name', 'name'],
      ['campus', 'campusId'],
      ['building', 'buildingId'],
      ['roomType', 'roomType'],
      ['capacity', 'capacity'],
      ['floor', 'floor'],
      ['isActive', 'isActive'],
    ],
    parentRefs: [
      { header: 'campus', field: 'campusId', refEntity: 'campus' },
      { header: 'building', field: 'buildingId', refEntity: 'building' },
    ],
  },

  building: {
    model: 'building',
    entityType: 'Building',
    viewKey: K.BUILDINGS_VIEW,
    manageKey: K.BUILDINGS_MANAGE,
    createAuditAction: A.BUILDING_CREATED,
    updateAuditAction: A.BUILDING_UPDATED,
    archiveAuditAction: A.BUILDING_ARCHIVED,
    csvColumns: [
      ['code', 'code'],
      ['name', 'name'],
      ['campus', 'campusId'],
      ['addressLine', 'addressLine'],
      ['isActive', 'isActive'],
    ],
    parentRefs: [{ header: 'campus', field: 'campusId', refEntity: 'campus' }],
  },

  section: {
    model: 'section',
    entityType: 'Section',
    viewKey: K.SECTIONS_VIEW,
    manageKey: K.SECTIONS_MANAGE,
    createAuditAction: A.SECTION_CREATED,
    updateAuditAction: A.SECTION_UPDATED,
    archiveAuditAction: A.SECTION_ARCHIVED,
    csvColumns: [
      ['code', 'code'],
      ['name', 'name'],
      ['program', 'programId'],
      ['academicYear', 'academicYearId'],
      ['capacity', 'capacity'],
      ['isActive', 'isActive'],
    ],
    parentRefs: [
      { header: 'program', field: 'programId', refEntity: 'program' },
      { header: 'academicYear', field: 'academicYearId', refEntity: 'academicYear' },
    ],
  },

  batch: {
    model: 'batch',
    entityType: 'Batch',
    viewKey: K.BATCHES_VIEW,
    manageKey: K.BATCHES_MANAGE,
    createAuditAction: A.BATCH_CREATED,
    updateAuditAction: A.BATCH_UPDATED,
    archiveAuditAction: A.BATCH_ARCHIVED,
    csvColumns: [
      ['code', 'code'],
      ['name', 'name'],
      ['program', 'programId'],
      ['academicYear', 'academicYearId'],
      ['startDate', 'startDate'],
      ['endDate', 'endDate'],
      ['isActive', 'isActive'],
    ],
    parentRefs: [
      { header: 'program', field: 'programId', refEntity: 'program' },
      { header: 'academicYear', field: 'academicYearId', refEntity: 'academicYear' },
    ],
  },
};