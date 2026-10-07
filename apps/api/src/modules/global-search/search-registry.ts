/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The searchable-entity registry: one descriptor per row family the palette can return.
 *
 * Security model — every descriptor names the permission the owning module's own list endpoint
 * requires, plus (where that module applies row-level scoping) the exact helper it uses. The
 * service only runs a descriptor when the caller's effective permission map contains that key, and
 * then merges the descriptor's scope fragment into the query. Families whose modules are
 * permission-only today (fees, payments, helpdesk, documents) intentionally carry no `scope` and
 * therefore behave identically to those modules' own list endpoints.
 *
 * Adding a family: add its `GlobalSearchEntityType` to packages/types/src/search.ts, then a
 * descriptor here — nothing else. The frontend renders whatever types the API reports.
 */
import type { PermissionKey } from '@college-erp/auth';
import { PERMISSION_KEYS as K } from '@college-erp/auth';
import type { TenantScopedPrismaClient } from '@college-erp/database';
import type { GlobalSearchEntityType, GlobalSearchResultItemDto } from '@college-erp/types';
import { academicScopeFilter } from '../academics/academics-scope';
import { admissionScopeFilter } from '../admissions/admissions-scope';
import { certificateScopeFilter } from '../certificates/certificate-scope';
import { examSessionScopeFilter, examStudentWhereInput } from '../exams/exams-scope';
import { hrEmployeeScopeFilter } from '../hr/hr-scope';
import type { ScopeGrant } from '../rbac/permissions.service';
import { studentScopeFilter } from '../students/student-scope';
import { toScopeIdGrants } from './search-scope';
import { formatAmount, formatDate, humanizeCode, relevanceScore } from './search-scoring';

export interface SearchEntityDescriptor {
  type: GlobalSearchEntityType;
  /** Group heading shown in the palette. */
  label: string;
  /** Permission whose grant admits the type and supplies its row scope. */
  permission: PermissionKey;
  /** `OR`-of-contains fragment for the free-text query. */
  textWhere(query: string): Record<string, any>;
  /** Row scoping; omitted for permission-only families (see the file header). */
  scope?(
    grants: ScopeGrant[],
    actorUserId: string,
    client: TenantScopedPrismaClient,
  ): Record<string, any> | undefined | Promise<Record<string, any> | undefined>;
  /** Soft-delete / sub-type narrowing, merged under AND with text + scope. */
  baseWhere?: Record<string, any>;
  query(
    client: TenantScopedPrismaClient,
    where: Record<string, any>,
    take: number,
  ): Promise<{ rows: any[]; count: number }>;
  map(row: any, query: string): GlobalSearchResultItemDto;
}

/** Case-insensitive OR over the given columns. */
function contains(query: string, fields: string[]): Record<string, any> {
  return { OR: fields.map((field) => ({ [field]: { contains: query, mode: 'insensitive' } })) };
}

/** Newest-first page plus the uncapped match count, in one round trip pair. */
async function page<Row>(
  fetch: () => Promise<Row[]>,
  count: () => Promise<number>,
): Promise<{ rows: Row[]; count: number }> {
  const [rows, total] = await Promise.all([fetch(), count()]);
  return { rows, count: total };
}

const NEWEST_FIRST = [{ createdAt: 'desc' as const }, { id: 'asc' as const }];

export function buildSearchRegistry(): SearchEntityDescriptor[] {
  return [
    {
      type: 'student',
      label: 'Students',
      permission: K.STUDENTS_VIEW,
      baseWhere: { deletedAt: null },
      textWhere: (q) =>
        contains(q, ['fullName', 'admissionNumber', 'rollNumber', 'registrationNumber', 'email', 'primaryPhone']),
      scope: (grants, actorUserId) => studentScopeFilter(grants, actorUserId),
      query: (c, where, take) =>
        page(
          () =>
            c.student.findMany({
              where,
              take,
              orderBy: NEWEST_FIRST,
              select: {
                id: true,
                fullName: true,
                admissionNumber: true,
                rollNumber: true,
                email: true,
                primaryPhone: true,
                status: true,
              },
            }),
          () => c.student.count({ where }),
        ),
      map: (row, q) => ({
        type: 'student',
        id: row.id,
        title: row.fullName,
        subtitle:
          [row.admissionNumber, row.rollNumber ? `Roll ${row.rollNumber}` : null].filter(Boolean).join(' · ') || null,
        description: row.email ?? row.primaryPhone ?? null,
        href: `/students/${row.id}`,
        score: relevanceScore(q, [row.fullName, row.admissionNumber, row.rollNumber, row.email, row.primaryPhone]),
        meta: { status: humanizeCode(row.status) ?? 'Unknown' },
      }),
    },
    {
      type: 'faculty',
      label: 'Faculty & Staff',
      permission: K.HR_VIEW,
      baseWhere: { deletedAt: null, employeeType: 'FACULTY' },
      textWhere: (q) => contains(q, ['firstName', 'middleName', 'lastName', 'employeeCode', 'personalEmail', 'phone']),
      scope: async (grants, actorUserId, c) => {
        // Employee rows have no programId, so PROGRAM grants resolve UP to their department — the
        // same convention hr.service.resolveEmployeeScope uses.
        const campusIds = new Set<string>();
        const departmentIds = new Set<string>();
        const programIds = new Set<string>();
        for (const g of grants) {
          if (g.scopeType === 'CAMPUS' && g.campusId) campusIds.add(g.campusId);
          if (g.scopeType === 'DEPARTMENT' && g.departmentId) departmentIds.add(g.departmentId);
          if (g.scopeType === 'PROGRAM' && g.programId) programIds.add(g.programId);
        }
        if (programIds.size > 0) {
          const programs = await c.program.findMany({
            where: { id: { in: [...programIds] } },
            select: { id: true, departmentId: true },
          });
          for (const program of programs) if (program.departmentId) departmentIds.add(program.departmentId);
        }
        return hrEmployeeScopeFilter({ grants, actorUserId, campusIds, departmentIds }).employeeWhere;
      },
      query: (c, where, take) =>
        page(
          () =>
            c.employee.findMany({
              where,
              take,
              orderBy: NEWEST_FIRST,
              select: {
                id: true,
                firstName: true,
                middleName: true,
                lastName: true,
                employeeCode: true,
                personalEmail: true,
                phone: true,
                employmentStatus: true,
                employeeType: true,
              },
            }),
          () => c.employee.count({ where }),
        ),
      map: (row, q) => {
        const name = [row.firstName, row.middleName, row.lastName].filter(Boolean).join(' ');
        return {
          type: 'faculty',
          id: row.id,
          title: name,
          subtitle: row.employeeCode,
          description: row.personalEmail ?? row.phone ?? null,
          href: '/hr',
          score: relevanceScore(q, [name, row.employeeCode, row.personalEmail, row.phone]),
          meta: { status: humanizeCode(row.employmentStatus) ?? 'Unknown' },
        };
      },
    },
    {
      type: 'application',
      label: 'Applications',
      permission: K.ADMISSIONS_VIEW,
      textWhere: (q) => contains(q, ['fullName', 'applicationNumber', 'email', 'phone']),
      scope: (grants) => admissionScopeFilter(grants),
      query: (c, where, take) =>
        page(
          () =>
            c.admissionApplication.findMany({
              where,
              take,
              orderBy: NEWEST_FIRST,
              select: { id: true, fullName: true, applicationNumber: true, email: true, phone: true, status: true },
            }),
          () => c.admissionApplication.count({ where }),
        ),
      map: (row, q) => ({
        type: 'application',
        id: row.id,
        title: row.fullName,
        subtitle: row.applicationNumber,
        description: row.email ?? row.phone ?? null,
        href: '/admissions',
        score: relevanceScore(q, [row.fullName, row.applicationNumber, row.email, row.phone]),
        meta: { status: humanizeCode(row.status) ?? 'Unknown' },
      }),
    },
    {
      type: 'course',
      label: 'Courses',
      permission: K.ACADEMICS_VIEW,
      baseWhere: { deletedAt: null },
      textWhere: (q) => contains(q, ['name', 'code', 'description']),
      scope: (grants, actorUserId) => academicScopeFilter(grants, actorUserId, 'course'),
      query: (c, where, take) =>
        page(
          () =>
            c.course.findMany({
              where,
              take,
              orderBy: NEWEST_FIRST,
              select: { id: true, name: true, code: true, description: true, isActive: true },
            }),
          () => c.course.count({ where }),
        ),
      map: (row, q) => ({
        type: 'course',
        id: row.id,
        title: row.name,
        subtitle: row.code,
        description: row.description ?? null,
        href: '/academics',
        score: relevanceScore(q, [row.name, row.code, row.description]),
        meta: { status: row.isActive ? 'Active' : 'Inactive' },
      }),
    },
    {
      // StudentFee is the tenant-side "invoice" record (platform Invoice/Payment are SaaS billing).
      // The fees module gates by permission only, so search does too.
      type: 'invoice',
      label: 'Fee Invoices',
      permission: K.FEES_VIEW,
      textWhere: (q) => contains(q, ['headName', 'headCode']),
      query: (c, where, take) =>
        page(
          () =>
            c.studentFee.findMany({
              where,
              take,
              orderBy: NEWEST_FIRST,
              select: {
                id: true,
                studentId: true,
                headName: true,
                headCode: true,
                amountCents: true,
                paidCents: true,
                status: true,
                dueDate: true,
                student: { select: { fullName: true, admissionNumber: true } },
              },
            }),
          () => c.studentFee.count({ where }),
        ),
      map: (row, q) => {
        const due = formatDate(row.dueDate);
        return {
          type: 'invoice',
          id: row.id,
          title: row.headName,
          subtitle: row.student?.fullName ?? null,
          description: [formatAmount(row.amountCents), due ? `due ${due}` : null].filter(Boolean).join(' · '),
          href: `/students/${row.studentId}`,
          score: relevanceScore(q, [row.headName, row.headCode, row.student?.fullName, row.student?.admissionNumber]),
          meta: { status: humanizeCode(row.status) ?? 'Unknown', amount: formatAmount(row.amountCents) },
        };
      },
    },
    {
      // StudentPayment is the fee receipt. Permission-only, mirroring the fees module.
      type: 'payment',
      label: 'Payments',
      permission: K.PAYMENTS_VIEW,
      textWhere: (q) => contains(q, ['receiptNumber', 'referenceNumber']),
      query: (c, where, take) =>
        page(
          () =>
            c.studentPayment.findMany({
              where,
              take,
              orderBy: NEWEST_FIRST,
              select: {
                id: true,
                studentId: true,
                receiptNumber: true,
                referenceNumber: true,
                amountCents: true,
                method: true,
                status: true,
                student: { select: { fullName: true, admissionNumber: true } },
              },
            }),
          () => c.studentPayment.count({ where }),
        ),
      map: (row, q) => ({
        type: 'payment',
        id: row.id,
        title: row.receiptNumber,
        subtitle: row.student?.fullName ?? null,
        description: [formatAmount(row.amountCents), humanizeCode(row.method)].filter(Boolean).join(' · '),
        href: `/students/${row.studentId}`,
        score: relevanceScore(q, [row.receiptNumber, row.referenceNumber, row.student?.fullName]),
        meta: { status: humanizeCode(row.status) ?? 'Unknown', amount: formatAmount(row.amountCents) },
      }),
    },
    {
      type: 'exam',
      label: 'Exams',
      permission: K.EXAMS_VIEW,
      baseWhere: { deletedAt: null },
      textWhere: (q) => contains(q, ['name', 'code']),
      scope: (grants, actorUserId) => examSessionScopeFilter(toScopeIdGrants(grants), actorUserId),
      query: (c, where, take) =>
        page(
          () =>
            c.examSession.findMany({
              where,
              take,
              orderBy: NEWEST_FIRST,
              select: { id: true, name: true, code: true, examType: true, status: true },
            }),
          () => c.examSession.count({ where }),
        ),
      map: (row, q) => ({
        type: 'exam',
        id: row.id,
        title: row.name,
        subtitle: row.code,
        description: humanizeCode(row.examType),
        href: '/exams',
        score: relevanceScore(q, [row.name, row.code]),
        meta: { status: humanizeCode(row.status) ?? 'Unknown' },
      }),
    },
    {
      type: 'result',
      label: 'Results',
      permission: K.RESULTS_VIEW,
      textWhere: (q) => contains(q, ['subjectName', 'subjectCode', 'grade']),
      scope: (grants, actorUserId) => {
        const studentWhere = examStudentWhereInput(toScopeIdGrants(grants), actorUserId);
        return studentWhere ? { student: studentWhere } : undefined;
      },
      query: (c, where, take) =>
        page(
          () =>
            c.studentResult.findMany({
              where,
              take,
              orderBy: NEWEST_FIRST,
              select: {
                id: true,
                studentId: true,
                subjectName: true,
                subjectCode: true,
                grade: true,
                outcome: true,
                student: { select: { fullName: true, admissionNumber: true } },
              },
            }),
          () => c.studentResult.count({ where }),
        ),
      map: (row, q) => ({
        type: 'result',
        id: row.id,
        title: row.subjectName,
        subtitle:
          [row.student?.fullName, row.subjectCode].filter(Boolean).join(' · ') || null,
        description: row.grade ? `Grade ${row.grade}` : null,
        href: '/exams',
        score: relevanceScore(q, [row.subjectName, row.subjectCode, row.grade, row.student?.fullName]),
        meta: { status: humanizeCode(row.outcome) ?? 'Unknown' },
      }),
    },
    {
      type: 'certificate',
      label: 'Certificates',
      permission: K.CERTIFICATES_VIEW,
      textWhere: (q) => contains(q, ['certificateNumber', 'title']),
      scope: (grants, actorUserId) => certificateScopeFilter(toScopeIdGrants(grants), actorUserId),
      query: (c, where, take) =>
        page(
          () =>
            c.studentCertificate.findMany({
              where,
              take,
              orderBy: NEWEST_FIRST,
              select: {
                id: true,
                studentId: true,
                certificateType: true,
                certificateNumber: true,
                title: true,
                status: true,
                student: { select: { fullName: true, admissionNumber: true } },
              },
            }),
          () => c.studentCertificate.count({ where }),
        ),
      map: (row, q) => ({
        type: 'certificate',
        id: row.id,
        title: row.title ?? humanizeCode(row.certificateType) ?? 'Certificate',
        subtitle: row.certificateNumber,
        description: row.student?.fullName ?? null,
        href: '/certificates',
        score: relevanceScore(q, [row.title, row.certificateNumber, row.certificateType, row.student?.fullName]),
        meta: { status: humanizeCode(row.status) ?? 'Unknown' },
      }),
    },
    {
      // Helpdesk is permission-only (no campus/program anchor on tickets).
      type: 'ticket',
      label: 'Helpdesk Tickets',
      permission: K.HELPDESK_VIEW,
      textWhere: (q) => contains(q, ['ticketNumber', 'subject', 'requesterName', 'requesterEmail']),
      query: (c, where, take) =>
        page(
          () =>
            c.helpdeskTicket.findMany({
              where,
              take,
              orderBy: NEWEST_FIRST,
              select: {
                id: true,
                ticketNumber: true,
                subject: true,
                status: true,
                priority: true,
                requesterName: true,
              },
            }),
          () => c.helpdeskTicket.count({ where }),
        ),
      map: (row, q) => ({
        type: 'ticket',
        id: row.id,
        title: row.subject,
        subtitle: row.ticketNumber,
        description: row.requesterName ?? null,
        href: '/helpdesk',
        score: relevanceScore(q, [row.subject, row.ticketNumber, row.requesterName]),
        meta: { status: humanizeCode(row.status) ?? 'Unknown', priority: humanizeCode(row.priority) ?? '' },
      }),
    },
    {
      // Documents list is gated by documents.read with per-document download grants; search returns
      // only metadata the same list endpoint already exposes.
      type: 'document',
      label: 'Documents',
      permission: K.DOCUMENTS_VIEW,
      baseWhere: { deletedAt: null },
      textWhere: (q) => contains(q, ['title', 'originalFilename', 'category', 'description']),
      query: (c, where, take) =>
        page(
          () =>
            c.document.findMany({
              where,
              take,
              orderBy: NEWEST_FIRST,
              select: { id: true, title: true, originalFilename: true, category: true, status: true },
            }),
          () => c.document.count({ where }),
        ),
      map: (row, q) => ({
        type: 'document',
        id: row.id,
        title: row.title || row.originalFilename || 'Untitled document',
        subtitle: row.category,
        description: row.originalFilename ?? null,
        href: '/documents',
        score: relevanceScore(q, [row.title, row.originalFilename, row.category]),
        meta: { status: humanizeCode(row.status) ?? 'Unknown' },
      }),
    },
  ];
}
