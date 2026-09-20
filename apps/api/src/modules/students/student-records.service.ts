/**
 * Student 360 sub-resource service: CRUD + lifecycle actions for the 16 record types hanging
 * off a student profile (guardians, documents, admissions, academic records, enrollments,
 * attendance, fees, payments, exams, results, certificates, library loans, hostel bookings,
 * transport passes, holds, communications) plus the activity timeline.
 *
 * Reads/writes are tenant-scoped (TenantScopedPrismaService) and gated behind
 * assertStudentInScope so a user can never touch a student they aren't granted to see.
 * Fees/payments recompute the fee ledger status; certificates/holds/loans/hostel have their
 * own lifecycle transitions instead of plain deletes.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { Injectable, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@college-erp/database';
import { AUDIT_ACTIONS } from '@college-erp/auth';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { AuditService } from '../audit/audit.service';
import { StudentsService } from './students.service';
import { STUDENT_EVENTS, STUDENT_RESOURCE_META, type StudentResource } from './students.constants';

type Client = PrismaClient;

/** Models with a createdBy column; the tenant extension covers tenantId only. */
const CREATED_BY_MODELS: readonly string[] = [
  'guardian', 'admission', 'academicRecord', 'enrollment', 'fee', 'exam', 'result',
  'certificate', 'libraryLoan', 'hostelBooking', 'transportPass', 'hold', 'communication',
];
/** Models with an updatedBy column. */
const UPDATED_BY_MODELS: readonly string[] = ['guardian', 'fee', 'libraryLoan', 'hostelBooking', 'transportPass'];

@Injectable()
export class StudentRecordsService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditService: AuditService,
    private readonly studentsService: StudentsService,
  ) {}

  // ── Generic CRUD dispatch ─────────────────────────────────────────────────

  async list(studentId: string, resource: StudentResource, tenantId: string, userId: string, query: any) {
    await this.studentsService.assertStudentInScope(studentId, tenantId, userId);
    const meta = STUDENT_RESOURCE_META[resource];
    const delegate = (this.tenantPrisma.client as any)[meta.model];

    const where: Record<string, any> = { studentId };
    if (query.ids && Array.isArray(query.ids) && query.ids.length) where.id = { in: query.ids };

    const [data, total] = await Promise.all([
      delegate.findMany({
        where,
        include: meta.include ?? undefined,
        orderBy: { createdAt: 'desc' },
        skip: query.skip ?? 0,
        take: query.take ?? 100,
      }),
      delegate.count({ where }),
    ]);
    return { data, total };
  }

  async getOne(studentId: string, resource: StudentResource, recordId: string, tenantId: string, userId: string) {
    await this.studentsService.assertStudentInScope(studentId, tenantId, userId);
    const meta = STUDENT_RESOURCE_META[resource];
    const row = await (this.tenantPrisma.client as any)[meta.model].findFirst({
      where: { id: recordId, studentId },
      include: meta.include ?? undefined,
    });
    if (!row) throw new NotFoundException(`${meta.entityType} not found.`);
    return row;
  }

  async create(studentId: string, resource: StudentResource, tenantId: string, userId: string, dto: Record<string, any>) {
    await this.studentsService.assertStudentInScope(studentId, tenantId, userId);
    const meta = STUDENT_RESOURCE_META[resource];

    if (resource === 'payment') {
      return this.createPayment(studentId, tenantId, userId, dto);
    }

    const data: Record<string, any> = this.cleanData(dto, meta);
    data.studentId = studentId;
    if (resource === 'document') data.uploadedBy = userId;
    else if (resource === 'attendance') data.markedByUserId = userId;
    else if (CREATED_BY_MODELS.includes(meta.model)) data.createdBy = userId;

    const row = await (this.tenantPrisma.client as any)[meta.model].create({ data });

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId: userId,
      action: meta.createAuditAction,
      module: 'students',
      entityType: meta.entityType,
      entityId: row.id,
      after: { studentId, ...data },
    });
    await this.logActivity(studentId, this.eventKeyFor(resource, 'create'), this.eventTitle(resource, 'create'), userId, undefined, meta.entityType, row.id);

    if (resource === 'fee') {
      await this.recomputeFeeStatus(row.id);
    }
    return this.getOne(studentId, resource, row.id, tenantId, userId);
  }

  async update(studentId: string, resource: StudentResource, recordId: string, tenantId: string, userId: string, dto: Record<string, any>) {
    await this.studentsService.assertStudentInScope(studentId, tenantId, userId);
    const meta = STUDENT_RESOURCE_META[resource];
    const delegate = (this.tenantPrisma.client as any)[meta.model];

    const existing = await delegate.findFirst({ where: { id: recordId, studentId } });
    if (!existing) throw new NotFoundException(`${meta.entityType} not found.`);

    const data: Record<string, any> = this.cleanData(dto, meta);
    if (UPDATED_BY_MODELS.includes(meta.model)) data.updatedBy = userId;
    const row = await delegate.update({ where: { id: recordId }, data });

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId: userId,
      action: meta.updateAuditAction,
      module: 'students',
      entityType: meta.entityType,
      entityId: recordId,
      before: existing,
      after: row,
    });
    await this.logActivity(studentId, this.eventKeyFor(resource, 'update'), this.eventTitle(resource, 'update'), userId, undefined, meta.entityType, recordId);

    if (resource === 'fee') await this.recomputeFeeStatus(recordId);
    return this.getOne(studentId, resource, recordId, tenantId, userId);
  }

  async remove(studentId: string, resource: StudentResource, recordId: string, tenantId: string, userId: string) {
    await this.studentsService.assertStudentInScope(studentId, tenantId, userId);
    const meta = STUDENT_RESOURCE_META[resource];
    const delegate = (this.tenantPrisma.client as any)[meta.model];

    const existing = await delegate.findFirst({ where: { id: recordId, studentId } });
    if (!existing) throw new NotFoundException(`${meta.entityType} not found.`);

    await delegate.delete({ where: { id: recordId } });

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId: userId,
      action: meta.deleteAuditAction,
      module: 'students',
      entityType: meta.entityType,
      entityId: recordId,
      before: existing,
    });
    await this.logActivity(studentId, this.eventKeyFor(resource, 'delete'), this.eventTitle(resource, 'delete'), userId, undefined, meta.entityType, recordId);
    return { id: recordId, deleted: true };
  }

  // ── Documents ─────────────────────────────────────────────────────────────

  async verifyDocument(studentId: string, documentId: string, tenantId: string, userId: string, remarks?: string) {
    const doc = await this.getOne(studentId, 'document', documentId, tenantId, userId);
    const row = await (this.tenantPrisma.client as Client).studentDocument.update({
      where: { id: documentId },
      data: { status: 'VERIFIED', verifiedAt: new Date(), verifiedBy: userId, remarks: remarks ?? doc.remarks },
    });
    await this.auditService.record({
      scope: 'TENANT', tenantId, actorType: 'USER', actorUserId: userId,
      action: AUDIT_ACTIONS.STUDENT_DOCUMENT_UPDATED, module: 'students',
      entityType: 'StudentDocument', entityId: documentId, after: { status: 'VERIFIED', remarks: remarks ?? null },
    });
    await this.logActivity(studentId, STUDENT_EVENTS.DOCUMENT_VERIFIED, 'Document verified', userId, remarks);
    return row;
  }

  async rejectDocument(studentId: string, documentId: string, tenantId: string, userId: string, remarks?: string) {
    const doc = await this.getOne(studentId, 'document', documentId, tenantId, userId);
    const row = await (this.tenantPrisma.client as Client).studentDocument.update({
      where: { id: documentId },
      data: { status: 'REJECTED', remarks: remarks ?? doc.remarks },
    });
    await this.auditService.record({
      scope: 'TENANT', tenantId, actorType: 'USER', actorUserId: userId,
      action: AUDIT_ACTIONS.STUDENT_DOCUMENT_UPDATED, module: 'students',
      entityType: 'StudentDocument', entityId: documentId, after: { status: 'REJECTED', remarks: remarks ?? null },
    });
    await this.logActivity(studentId, STUDENT_EVENTS.DOCUMENT_REJECTED, 'Document rejected', userId, remarks);
    return row;
  }

  // ── Fees / payments ───────────────────────────────────────────────────────

  async waiveFee(studentId: string, feeId: string, tenantId: string, userId: string, amountCents: number, reason?: string) {
    const fee = await this.getOne(studentId, 'fee', feeId, tenantId, userId);
    const waived = Math.max(0, Math.min(amountCents, fee.amountCents - fee.paidCents));
    const row = await (this.tenantPrisma.client as Client).studentFee.update({
      where: { id: feeId },
      data: { waivedCents: fee.waivedCents + waived, remarks: reason ?? fee.remarks, updatedBy: userId },
    });
    await this.recomputeFeeStatus(feeId);
    await this.auditService.record({
      scope: 'TENANT', tenantId, actorType: 'USER', actorUserId: userId,
      action: AUDIT_ACTIONS.STUDENT_FEE_UPDATED, module: 'students',
      entityType: 'StudentFee', entityId: feeId,
      before: { waivedCents: fee.waivedCents }, after: { waivedCents: row.waivedCents, reason: reason ?? null },
    });
    await this.logActivity(studentId, STUDENT_EVENTS.FEE_WAIVED, `Fee waived ₹${(waived / 100).toFixed(2)}`, userId, reason);
    return this.getOne(studentId, 'fee', feeId, tenantId, userId);
  }

  private async createPayment(studentId: string, tenantId: string, userId: string, dto: Record<string, any>) {
    const client = this.tenantPrisma.client as Client;

    let feeId: string | null = dto.studentFeeId ?? null;
    if (feeId) {
      const fee = await client.studentFee.findFirst({ where: { id: feeId, studentId } });
      if (!fee) throw new NotFoundException('The fee to reconcile against was not found.');
    }

    const data: Record<string, any> = {
      studentId,
      receiptNumber: dto.receiptNumber,
      amountCents: dto.amountCents,
      currency: dto.currency ?? 'INR',
      paymentDate: dto.paymentDate,
      method: dto.method,
      status: dto.status ?? 'SUCCEEDED',
      referenceNumber: dto.referenceNumber ?? null,
      recordedByUserId: userId,
      remarks: dto.remarks ?? null,
      studentFeeId: feeId,
    };

    const payment = await (this.tenantPrisma.client as any).studentPayment.create({ data });

    if (feeId && payment.status === 'SUCCEEDED') {
      await this.applyPaymentToFee(feeId, payment.amountCents);
    }

    await this.auditService.record({
      scope: 'TENANT', tenantId, actorType: 'USER', actorUserId: userId,
      action: AUDIT_ACTIONS.STUDENT_PAYMENT_RECORDED, module: 'students',
      entityType: 'StudentPayment', entityId: payment.id,
      after: { receiptNumber: payment.receiptNumber, amountCents: payment.amountCents, status: payment.status },
    });
    await this.logActivity(studentId, STUDENT_EVENTS.PAYMENT_RECORDED, `Payment recorded ₹${(payment.amountCents / 100).toFixed(2)}`, userId, dto.remarks);
    return this.getOne(studentId, 'payment', payment.id, tenantId, userId);
  }

  async refundPayment(studentId: string, paymentId: string, tenantId: string, userId: string, remarks?: string) {
    const client = this.tenantPrisma.client as Client;
    const payment = await this.getOne(studentId, 'payment', paymentId, tenantId, userId);
    if (payment.status === 'REFUNDED') return this.getOne(studentId, 'payment', paymentId, tenantId, userId);

    await client.studentPayment.update({
      where: { id: paymentId },
      data: { status: 'REFUNDED', remarks: remarks ?? payment.remarks },
    });

    if (payment.studentFeeId && payment.status === 'SUCCEEDED') {
      await this.reversePaymentFromFee(payment.studentFeeId, payment.amountCents);
    }

    await this.auditService.record({
      scope: 'TENANT', tenantId, actorType: 'USER', actorUserId: userId,
      action: AUDIT_ACTIONS.STUDENT_PAYMENT_REFUNDED, module: 'students',
      entityType: 'StudentPayment', entityId: paymentId,
      before: { status: payment.status }, after: { status: 'REFUNDED', remarks: remarks ?? null },
    });
    await this.logActivity(studentId, STUDENT_EVENTS.PAYMENT_REFUNDED, `Payment refunded ₹${(payment.amountCents / 100).toFixed(2)}`, userId, remarks);
    return this.getOne(studentId, 'payment', paymentId, tenantId, userId);
  }

  private async applyPaymentToFee(feeId: string, amountCents: number) {
    const fee = await (this.tenantPrisma.client as Client).studentFee.findFirst({ where: { id: feeId } });
    if (!fee) return;
    await (this.tenantPrisma.client as Client).studentFee.update({
      where: { id: feeId },
      data: { paidCents: fee.paidCents + amountCents },
    });
    await this.recomputeFeeStatus(feeId);
  }

  private async reversePaymentFromFee(feeId: string, amountCents: number) {
    const fee = await (this.tenantPrisma.client as Client).studentFee.findFirst({ where: { id: feeId } });
    if (!fee) return;
    await (this.tenantPrisma.client as Client).studentFee.update({
      where: { id: feeId },
      data: { paidCents: Math.max(0, fee.paidCents - amountCents) },
    });
    await this.recomputeFeeStatus(feeId);
  }

  private async recomputeFeeStatus(feeId: string) {
    const fee = await (this.tenantPrisma.client as Client).studentFee.findFirst({ where: { id: feeId } });
    if (!fee) return;
    const settledByWaiver = fee.waivedCents >= fee.amountCents;
    const settledByPayment = fee.paidCents >= fee.amountCents - fee.waivedCents;
    const status = settledByWaiver ? 'WAIVED' : settledByPayment ? 'PAID' : fee.paidCents > 0 ? 'PARTIALLY_PAID' : 'ISSUED';
    if (status !== fee.status) {
      await (this.tenantPrisma.client as Client).studentFee.update({ where: { id: feeId }, data: { status } });
    }
  }

  // ── Certificates ──────────────────────────────────────────────────────────

  async changeCertificateStatus(studentId: string, certificateId: string, tenantId: string, userId: string, status: string, certificateNumber?: string, remarks?: string) {
    const before = await this.getOne(studentId, 'certificate', certificateId, tenantId, userId);
    const data: Record<string, any> = { status };
    if (certificateNumber) data.certificateNumber = certificateNumber;
    if (remarks !== undefined) data.remarks = remarks;
    if (status === 'GENERATED') {
      data.generatedAt = new Date();
      data.generatedByUserId = userId;
    } else if (status === 'APPROVED') {
      data.approvedAt = new Date();
      data.approvedByUserId = userId;
    } else if (status === 'ISSUED') {
      data.issuedAt = new Date();
      data.issuedByUserId = userId;
    }

    const row = await (this.tenantPrisma.client as any).studentCertificate.update({
      where: { id: certificateId },
      data,
    });
    await this.auditService.record({
      scope: 'TENANT', tenantId, actorType: 'USER', actorUserId: userId,
      action: AUDIT_ACTIONS.STUDENT_CERTIFICATE_STATUS_CHANGED, module: 'students',
      entityType: 'StudentCertificate', entityId: certificateId,
      before: { status: before.status }, after: { status, certificateNumber: certificateNumber ?? null },
    });
    await this.logActivity(studentId, STUDENT_EVENTS.CERTIFICATE_STATUS_CHANGED, `Certificate ${status.toLowerCase()}`, userId, remarks);
    return row;
  }

  // ── Library / hostel / transport ──────────────────────────────────────────

  async returnLibraryLoan(studentId: string, loanId: string, tenantId: string, userId: string, returnedAt?: string, fineCents?: number, remarks?: string) {
    const before = await this.getOne(studentId, 'libraryLoan', loanId, tenantId, userId);
    const row = await (this.tenantPrisma.client as Client).studentLibraryLoan.update({
      where: { id: loanId },
      data: {
        status: 'RETURNED',
        returnedAt: returnedAt ? new Date(returnedAt) : new Date(),
        fineCents: fineCents ?? before.fineCents ?? 0,
        remarks: remarks ?? before.remarks,
        updatedBy: userId,
      },
    });
    await this.auditService.record({
      scope: 'TENANT', tenantId, actorType: 'USER', actorUserId: userId,
      action: AUDIT_ACTIONS.STUDENT_LIBRARY_LOAN_UPDATED, module: 'students',
      entityType: 'StudentLibraryLoan', entityId: loanId,
      before: { status: before.status }, after: { status: 'RETURNED', fineCents: row.fineCents },
    });
    await this.logActivity(studentId, STUDENT_EVENTS.LIBRARY_LOAN_RETURNED, 'Library loan returned', userId, remarks);
    return row;
  }

  async hostelCheckIn(studentId: string, bookingId: string, tenantId: string, userId: string) {
    return this.setHostelStatus(studentId, bookingId, tenantId, userId, 'CHECKED_IN', STUDENT_EVENTS.HOSTEL_CHECKED_IN, 'Checked into hostel', { checkInDate: new Date() });
  }

  async hostelCheckOut(studentId: string, bookingId: string, tenantId: string, userId: string) {
    return this.setHostelStatus(studentId, bookingId, tenantId, userId, 'CHECKED_OUT', STUDENT_EVENTS.HOSTEL_CHECKED_OUT, 'Checked out of hostel', { checkOutDate: new Date() });
  }

  async cancelHostelBooking(studentId: string, bookingId: string, tenantId: string, userId: string, remarks?: string) {
    const before = await this.getOne(studentId, 'hostelBooking', bookingId, tenantId, userId);
    const row = await (this.tenantPrisma.client as Client).studentHostelBooking.update({
      where: { id: bookingId },
      data: { status: 'CANCELLED', remarks: remarks ?? before.remarks, updatedBy: userId },
    });
    await this.auditService.record({
      scope: 'TENANT', tenantId, actorType: 'USER', actorUserId: userId,
      action: AUDIT_ACTIONS.STUDENT_HOSTEL_BOOKING_CANCELLED, module: 'students',
      entityType: 'StudentHostelBooking', entityId: bookingId,
      before: { status: before.status }, after: { status: 'CANCELLED', remarks: remarks ?? null },
    });
    await this.logActivity(studentId, 'hostel_booking.cancelled', 'Hostel booking cancelled', userId, remarks);
    return row;
  }

  private async setHostelStatus(studentId: string, bookingId: string, tenantId: string, userId: string, status: string, event: string, title: string, extra: Record<string, any>) {
    const before = await this.getOne(studentId, 'hostelBooking', bookingId, tenantId, userId);
    const row = await (this.tenantPrisma.client as any).studentHostelBooking.update({
      where: { id: bookingId },
      data: { status, ...extra, updatedBy: userId },
    });
    await this.auditService.record({
      scope: 'TENANT', tenantId, actorType: 'USER', actorUserId: userId,
      action: AUDIT_ACTIONS.STUDENT_HOSTEL_BOOKING_UPDATED, module: 'students',
      entityType: 'StudentHostelBooking', entityId: bookingId,
      before: { status: before.status }, after: { status },
    });
    await this.logActivity(studentId, event, title, userId, undefined);
    return row;
  }

  async cancelTransportPass(studentId: string, passId: string, tenantId: string, userId: string, remarks?: string) {
    const before = await this.getOne(studentId, 'transportPass', passId, tenantId, userId);
    const row = await (this.tenantPrisma.client as Client).studentTransportPass.update({
      where: { id: passId },
      data: { status: 'CANCELLED', remarks: remarks ?? before.remarks, updatedBy: userId },
    });
    await this.auditService.record({
      scope: 'TENANT', tenantId, actorType: 'USER', actorUserId: userId,
      action: AUDIT_ACTIONS.STUDENT_TRANSPORT_PASS_CANCELLED, module: 'students',
      entityType: 'StudentTransportPass', entityId: passId,
      before: { status: before.status }, after: { status: 'CANCELLED' },
    });
    await this.logActivity(studentId, STUDENT_EVENTS.TRANSPORT_PASS_CANCELLED, 'Transport pass cancelled', userId, remarks);
    return row;
  }

  // ── Enrollment / holds ────────────────────────────────────────────────────

  async withdrawEnrollment(studentId: string, enrollmentId: string, tenantId: string, userId: string, remarks?: string) {
    const before = await this.getOne(studentId, 'enrollment', enrollmentId, tenantId, userId);
    const row = await (this.tenantPrisma.client as any).studentEnrollment.update({
      where: { id: enrollmentId },
      data: { status: 'WITHDRAWN', completedAt: new Date(), remarks: remarks ?? before.remarks },
    });
    await this.auditService.record({
      scope: 'TENANT', tenantId, actorType: 'USER', actorUserId: userId,
      action: AUDIT_ACTIONS.STUDENT_ENROLLMENT_UPDATED, module: 'students',
      entityType: 'StudentEnrollment', entityId: enrollmentId,
      before: { status: before.status }, after: { status: 'WITHDRAWN' },
    });
    await this.logActivity(studentId, STUDENT_EVENTS.ENROLLMENT_WITHDRAWN, 'Enrollment withdrawn', userId, remarks);
    return row;
  }

  async liftHold(studentId: string, holdId: string, tenantId: string, userId: string, remarks?: string) {
    const before = await this.getOne(studentId, 'hold', holdId, tenantId, userId);
    const row = await (this.tenantPrisma.client as any).studentHold.update({
      where: { id: holdId },
      data: { status: 'RESOLVED', liftedOn: new Date(), liftedByUserId: userId, remarks: remarks ?? before.remarks },
    });
    await this.auditService.record({
      scope: 'TENANT', tenantId, actorType: 'USER', actorUserId: userId,
      action: AUDIT_ACTIONS.STUDENT_HOLD_LIFTED, module: 'students',
      entityType: 'StudentHold', entityId: holdId,
      before: { status: before.status }, after: { status: 'RESOLVED' },
    });
    await this.logActivity(studentId, STUDENT_EVENTS.HOLD_LIFTED, 'Hold lifted', userId, remarks);
    return row;
  }

  // ── Timeline ──────────────────────────────────────────────────────────────

  async timeline(studentId: string, tenantId: string, userId: string) {
    await this.studentsService.assertStudentInScope(studentId, tenantId, userId);
    const client = this.tenantPrisma.client as Client;
    const [activities, statusHistory] = await Promise.all([
      client.studentActivity.findMany({
        where: { studentId },
        orderBy: { occurredAt: 'desc' },
        take: 100,
      }),
      client.studentStatusHistory.findMany({
        where: { studentId },
        orderBy: { changedAt: 'desc' },
        take: 100,
      }),
    ]);

    const entries = [
      ...activities.map((a) => ({
        kind: 'activity' as const,
        occurredAt: a.occurredAt,
        eventType: a.eventType,
        title: a.title,
        description: a.description,
        entityType: a.entityType,
        entityId: a.entityId,
        actorUserId: a.actorUserId,
      })),
      ...statusHistory.map((s) => ({
        kind: 'status' as const,
        occurredAt: s.changedAt,
        fromStatus: s.fromStatus,
        toStatus: s.toStatus,
        reason: s.reason,
        actorUserId: s.changedByUserId,
      })),
    ];
    entries.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
    return { entries, total: entries.length };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private cleanData(dto: Record<string, any>, meta: (typeof STUDENT_RESOURCE_META)[StudentResource]): Record<string, any> {
    const data = { ...dto };
    for (const key of meta.relationFields ?? []) delete data[key];
    return data;
  }

  private eventKeyFor(resource: StudentResource, op: 'create' | 'update' | 'delete'): string {
    if (op === 'delete') return `${resource}.deleted`;
    switch (resource) {
      case 'guardian':
        return op === 'create' ? STUDENT_EVENTS.GUARDIAN_CREATED : STUDENT_EVENTS.GUARDIAN_UPDATED;
      case 'document':
        return STUDENT_EVENTS.DOCUMENT_UPLOADED;
      case 'admission':
        return STUDENT_EVENTS.ADMISSION_RECORDED;
      case 'academicRecord':
        return STUDENT_EVENTS.ACADEMIC_RECORD_CREATED;
      case 'enrollment':
        return op === 'create' ? STUDENT_EVENTS.ENROLLED : STUDENT_EVENTS.ENROLLMENT_WITHDRAWN;
      case 'attendance':
        return STUDENT_EVENTS.ATTENDANCE_RECORDED;
      case 'fee':
        return op === 'create' ? STUDENT_EVENTS.FEE_ISSUED : STUDENT_EVENTS.FEE_UPDATED;
      case 'payment':
        return op === 'create' ? STUDENT_EVENTS.PAYMENT_RECORDED : STUDENT_EVENTS.PAYMENT_REFUNDED;
      case 'exam':
        return STUDENT_EVENTS.EXAM_CREATED;
      case 'result':
        return op === 'create' ? STUDENT_EVENTS.RESULT_RECORDED : STUDENT_EVENTS.RESULT_UPDATED;
      case 'certificate':
        return op === 'create' ? STUDENT_EVENTS.CERTIFICATE_REQUESTED : STUDENT_EVENTS.CERTIFICATE_STATUS_CHANGED;
      case 'libraryLoan':
        return op === 'create' ? STUDENT_EVENTS.LIBRARY_LOAN_ISSUED : STUDENT_EVENTS.LIBRARY_LOAN_RETURNED;
      case 'hostelBooking':
        return STUDENT_EVENTS.HOSTEL_BOOKING_CREATED;
      case 'transportPass':
        return op === 'create' ? STUDENT_EVENTS.TRANSPORT_PASS_CREATED : STUDENT_EVENTS.TRANSPORT_PASS_CANCELLED;
      case 'hold':
        return op === 'create' ? STUDENT_EVENTS.HOLD_PLACED : STUDENT_EVENTS.HOLD_LIFTED;
      case 'communication':
        return STUDENT_EVENTS.COMMUNICATION_LOGGED;
    }
  }

  private eventTitle(resource: StudentResource, op: 'create' | 'update' | 'delete'): string {
    const names: Record<StudentResource, string> = {
      guardian: 'Guardian',
      document: 'Document',
      admission: 'Admission',
      academicRecord: 'Academic record',
      enrollment: 'Enrollment',
      attendance: 'Attendance',
      fee: 'Fee',
      payment: 'Payment',
      exam: 'Exam',
      result: 'Result',
      certificate: 'Certificate',
      libraryLoan: 'Library loan',
      hostelBooking: 'Hostel booking',
      transportPass: 'Transport pass',
      hold: 'Hold',
      communication: 'Communication',
    };
    const verb = op === 'create' ? 'added' : op === 'update' ? 'updated' : 'removed';
    return `${names[resource]} ${verb}`;
  }

  private async logActivity(
    studentId: string,
    eventType: string,
    title: string,
    actorUserId: string,
    description?: string,
    entityType?: string,
    entityId?: string,
  ) {
    await (this.tenantPrisma.client as any).studentActivity.create({
      data: {
        studentId,
        eventType,
        title,
        description: description ?? null,
        entityType: entityType ?? null,
        entityId: entityId ?? null,
        actorUserId,
      },
    });
  }
}