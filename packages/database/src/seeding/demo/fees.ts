/**
 * Demo module 07 — fees & payments: fee heads, per-program annual fee structures with lines,
 * per-student assignments, two installment demands, paid/partial/overdue statuses, allocations
 * of payments to fee lines, scholarships and a refund request.
 */
import type { FeeStatus } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { demoDate, demoId, installments60_40, logDemo, type DemoContext, type IdMap } from './core';
import type { SeededPeople } from './people';

export interface FeesInput {
  prisma: PrismaClient;
  ctx: DemoContext;
  org: IdMap;
  people: SeededPeople;
}

export interface FeesResult {
  receipts: number;
  demands: number;
}

const HEAD_SPECS = [
  { code: 'TUITION', name: 'Tuition Fee', frequency: 'PER_TERM' as const, defaultAmountCents: 4_500_000, isOptional: false, isRefundable: true },
  { code: 'EXAM', name: 'Examination Fee', frequency: 'PER_TERM' as const, defaultAmountCents: 150_000, isOptional: false, isRefundable: false },
  { code: 'LIBRARY', name: 'Library Fee', frequency: 'ANNUAL' as const, defaultAmountCents: 200_000, isOptional: false, isRefundable: true },
  { code: 'LAB', name: 'Laboratory Fee', frequency: 'PER_TERM' as const, defaultAmountCents: 250_000, isOptional: false, isRefundable: true },
  { code: 'SPORTS', name: 'Sports & Cultural Fee', frequency: 'ANNUAL' as const, defaultAmountCents: 120_000, isOptional: false, isRefundable: false },
  { code: 'DEV', name: 'Development Fee (one-time)', frequency: 'ONE_TIME' as const, defaultAmountCents: 500_000, isOptional: true, isRefundable: false },
  { code: 'HOSTEL_RENT', name: 'Hostel Rent', frequency: 'PER_TERM' as const, defaultAmountCents: 900_000, isOptional: true, isRefundable: true },
  { code: 'TRANSPORT', name: 'Transport Fee', frequency: 'PER_TERM' as const, defaultAmountCents: 600_000, isOptional: true, isRefundable: true },
] as const;

const STRUCTURE_SPECS: Array<{
  programKey: string;
  name: string;
  lines: Array<{ code: string; annualCents: number }>;
}> = [
  {
    programKey: 'btechCse',
    name: 'B.Tech CSE — Academic Year 2026-27',
    lines: [
      { code: 'TUITION', annualCents: 9_000_000 },
      { code: 'EXAM', annualCents: 300_000 },
      { code: 'LIBRARY', annualCents: 200_000 },
      { code: 'LAB', annualCents: 500_000 },
      { code: 'SPORTS', annualCents: 120_000 },
    ],
  },
  {
    programKey: 'btechEce',
    name: 'B.Tech ECE — Academic Year 2026-27',
    lines: [
      { code: 'TUITION', annualCents: 8_500_000 },
      { code: 'EXAM', annualCents: 300_000 },
      { code: 'LIBRARY', annualCents: 200_000 },
      { code: 'LAB', annualCents: 500_000 },
      { code: 'SPORTS', annualCents: 120_000 },
    ],
  },
  {
    programKey: 'btechMe',
    name: 'B.Tech Mechanical — Academic Year 2026-27',
    lines: [
      { code: 'TUITION', annualCents: 8_000_000 },
      { code: 'EXAM', annualCents: 300_000 },
      { code: 'LIBRARY', annualCents: 200_000 },
      { code: 'LAB', annualCents: 450_000 },
      { code: 'SPORTS', annualCents: 120_000 },
    ],
  },
  {
    programKey: 'bba',
    name: 'BBA — Academic Year 2026-27',
    lines: [
      { code: 'TUITION', annualCents: 6_000_000 },
      { code: 'EXAM', annualCents: 300_000 },
      { code: 'LIBRARY', annualCents: 200_000 },
      { code: 'SPORTS', annualCents: 120_000 },
    ],
  },
  {
    programKey: 'mca',
    name: 'MCA — Academic Year 2026-27',
    lines: [
      { code: 'TUITION', annualCents: 7_000_000 },
      { code: 'EXAM', annualCents: 300_000 },
      { code: 'LIBRARY', annualCents: 200_000 },
      { code: 'LAB', annualCents: 400_000 },
      { code: 'SPORTS', annualCents: 120_000 },
    ],
  },
];

export async function seedFees(input: FeesInput): Promise<FeesResult> {
  const { prisma, ctx, org, people } = input;
  const { tenantId, creator } = ctx;
  const id = (segment: string) => demoId(`fees/${segment}`);
  const accountantUserId = people.staff['accountant']?.userId;

  // ------------------------------------------------------------------ heads + sequences
  const headIds: Record<string, string> = {};
  for (const head of HEAD_SPECS) {
    const row = await prisma.feeHead.upsert({
      where: { tenantId_code: { tenantId, code: head.code } },
      update: {
        name: head.name,
        frequency: head.frequency,
        defaultAmountCents: head.defaultAmountCents,
        isActive: true,
        updatedBy: creator,
      },
      create: {
        id: id(`head/${head.code}`),
        tenantId,
        code: head.code,
        name: head.name,
        frequency: head.frequency,
        defaultAmountCents: head.defaultAmountCents,
        isOptional: head.isOptional,
        isRefundable: head.isRefundable,
        createdBy: creator,
      },
    });
    headIds[head.code] = row.id;
  }

  const sequences = [
    { kind: 'RECEIPT' as const, prefix: 'RCT', nextValue: 500 },
    { kind: 'DEMAND' as const, prefix: 'DEM', nextValue: 500 },
    { kind: 'REFUND' as const, prefix: 'RFN', nextValue: 11 },
  ];
  for (const sequence of sequences) {
    await prisma.feeSequence.upsert({
      where: { tenantId_kind_prefix: { tenantId, kind: sequence.kind, prefix: sequence.prefix } },
      update: { nextValue: sequence.nextValue },
      create: {
        id: id(`sequence/${sequence.kind}/${sequence.prefix}`),
        tenantId,
        kind: sequence.kind,
        prefix: sequence.prefix,
        nextValue: sequence.nextValue,
      },
    });
  }

  // ------------------------------------------------------------------ structures + lines
  const structureIds: Record<string, string> = {};
  const structureLines: Record<string, Array<{ id: string; headId: string; amountCents: number }>> = {};
  for (const spec of STRUCTURE_SPECS) {
    const structure = await prisma.feeStructure.upsert({
      where: { id: id(`structure/${spec.programKey}`) },
      update: { name: spec.name, status: 'ACTIVE', updatedBy: creator },
      create: {
        id: id(`structure/${spec.programKey}`),
        tenantId,
        name: spec.name,
        status: 'ACTIVE',
        academicYearId: org['yearCurrent'] as string,
        programId: org[spec.programKey] as string,
        installmentCount: 2,
        dueDayOffset: 30,
        installmentGapDays: 120,
        lateFeePercentBps: 100,
        lateFeeGraceDays: 10,
        lateFeeFlatCents: 0,
        description: 'Annual fee payable in two installments (60% / 40%)',
        createdBy: creator,
      },
    });
    structureIds[spec.programKey] = structure.id;

    structureLines[spec.programKey] = [];
    for (const [index, line] of spec.lines.entries()) {
      const structureLine = await prisma.feeStructureLine.upsert({
        where: { structureId_headId: { structureId: structure.id, headId: headIds[line.code] as string } },
        update: { amountCents: line.annualCents, sortOrder: index },
        create: {
          id: id(`structure-line/${spec.programKey}/${line.code}`),
          tenantId,
          structureId: structure.id,
          headId: headIds[line.code] as string,
          amountCents: line.annualCents,
          isRequired: true,
          sortOrder: index,
        },
      });
      structureLines[spec.programKey]!.push({
        id: structureLine.id,
        headId: headIds[line.code] as string,
        amountCents: line.annualCents,
      });
    }
  }

  // ------------------------------------------------------------------ per-student assignments, demands, fees, payments
  let demandCounter = 0;
  let receiptCounter = 0;
  const receiptIds: string[] = [];

  for (const [studentIndex, student] of people.students.entries()) {
    const programKey = { 'BTECH-CSE': 'btechCse', 'BTECH-ECE': 'btechEce', 'BTECH-ME': 'btechMe', BBA: 'bba', MCA: 'mca' }[student.programKey];
    if (!programKey) continue;
    const structureId = structureIds[programKey] as string;
    const lines = structureLines[programKey] ?? [];

    const assignment = await prisma.studentFeeAssignment.upsert({
      where: {
        tenantId_studentId_structureId_termId: {
          tenantId,
          studentId: student.id,
          structureId,
          termId: org['termOddCurrent'] as string,
        },
      },
      update: { status: 'ACTIVE' },
      create: {
        id: id(`assignment/${student.admissionNumber}`),
        tenantId,
        studentId: student.id,
        structureId,
        termId: org['termOddCurrent'] as string,
        status: 'ACTIVE',
        effectiveDate: demoDate('2026-07-20'),
        assignedBy: accountantUserId,
      },
    });

    // Decide the payment story for this student before writing rows.
    const mode = studentIndex % 6; // 0 = unpaid, 4 = partial, otherwise full
    const scholarship = mode === 0 && studentIndex % 12 === 0 ? 2500 : 0; // 25% on tuition for a few

    for (const installmentIndex of [1, 2] as const) {
      const isFirst = installmentIndex === 1;
      const issueDate = isFirst ? demoDate('2026-07-20') : demoDate('2026-11-15');
      const dueDate = isFirst ? demoDate('2026-08-10') : demoDate('2026-12-10');
      demandCounter += 1;
      const demandNumber = `DEM-${String(demandCounter).padStart(6, '0')}`;

      // Compute line amounts and statuses for this installment.
      const feeLines = lines.map((line) => {
        const { first, second } = installments60_40(line.amountCents);
        const amountCents = isFirst ? first : second;
        const waivedCents = isFirst && scholarship > 0
          ? Math.round((amountCents * scholarship) / 10_000 / 100) * 100
          : 0;
        return { ...line, amountCents, waivedCents };
      });

      let paymentTarget = 0;
      if (isFirst && mode !== 0) {
        const payable = feeLines.reduce((sum, line) => sum + line.amountCents - line.waivedCents, 0);
        paymentTarget = mode === 4 ? Math.round(payable * 0.6 * 0.01) * 100 : payable;
      }

      // Allocate the payment across lines, then freeze final values.
      let remaining = paymentTarget;
      const allocations: Array<{ studentFeeId: string; amountCents: number }> = [];
      for (const line of feeLines) {
        const payable = line.amountCents - line.waivedCents;
        const paid = Math.max(0, Math.min(payable, remaining));
        remaining -= paid;
        (line as { paidCents?: number }).paidCents = paid;
        if (paid > 0) {
          allocations.push({ studentFeeId: id(`fee/${student.admissionNumber}/i${installmentIndex}/${line.headId}`), amountCents: paid });
        }
      }

      const totalCents = feeLines.reduce((sum, line) => sum + line.amountCents, 0);
      const paidTotal = feeLines.reduce((sum, line) => sum + ((line as { paidCents?: number }).paidCents ?? 0), 0);
      const waivedTotal = feeLines.reduce((sum, line) => sum + line.waivedCents, 0);

      const demandStatus: FeeStatus =
        paidTotal >= totalCents - waivedTotal && paidTotal > 0
          ? 'PAID'
          : waivedTotal > 0 && paidTotal > 0
            ? 'PARTIALLY_PAID'
            : waivedTotal > 0
              ? 'PARTIALLY_PAID'
              : isFirst && dueDate < demoDate('2026-10-10')
                ? 'OVERDUE'
                : 'ISSUED';

      const demand = await prisma.feeDemand.upsert({
        where: { tenantId_demandNumber: { tenantId, demandNumber } },
        update: {
          status: demandStatus,
          totalCents,
          paidCents: paidTotal,
          waivedCents: waivedTotal,
          updatedBy: creator,
        },
        create: {
          id: id(`demand/${student.admissionNumber}/i${installmentIndex}`),
          tenantId,
          assignmentId: assignment.id,
          studentId: student.id,
          termId: org['termOddCurrent'] as string,
          demandNumber,
          installmentIndex,
          issueDate,
          dueDate,
          status: demandStatus,
          totalCents,
          paidCents: paidTotal,
          waivedCents: waivedTotal,
          createdBy: creator,
        },
      });

      for (const line of feeLines) {
        const paid = (line as { paidCents?: number }).paidCents ?? 0;
        const lineStatus: FeeStatus =
          line.waivedCents >= line.amountCents
            ? 'WAIVED'
            : paid >= line.amountCents - line.waivedCents && paid > 0
              ? 'PAID'
              : paid > 0
                ? 'PARTIALLY_PAID'
                : line.waivedCents > 0
                  ? 'PARTIALLY_PAID'
                  : isFirst && dueDate < demoDate('2026-10-10')
                    ? 'OVERDUE'
                    : 'ISSUED';
        await prisma.studentFee.upsert({
          where: { id: id(`fee/${student.admissionNumber}/i${installmentIndex}/${line.headId}`) },
          update: {
            amountCents: line.amountCents,
            paidCents: paid,
            waivedCents: line.waivedCents,
            status: lineStatus,
            demandId: demand.id,
            updatedBy: creator,
          },
          create: {
            id: id(`fee/${student.admissionNumber}/i${installmentIndex}/${line.headId}`),
            tenantId,
            studentId: student.id,
            termId: org['termOddCurrent'] as string,
            structureId,
            structureLineId: line.id,
            demandId: demand.id,
            installmentIndex,
            headCode: HEAD_SPECS.find((head) => headIds[head.code] === line.headId)?.code ?? 'FEE',
            headName: HEAD_SPECS.find((head) => headIds[head.code] === line.headId)?.name ?? 'Fee',
            amountCents: line.amountCents,
            paidCents: paid,
            waivedCents: line.waivedCents,
            lateFeeCents: 0,
            status: lineStatus,
            dueDate,
            createdBy: creator,
          },
        });
      }

      // One payment per paying student for installment 1.
      if (isFirst && paymentTarget > 0) {
        receiptCounter += 1;
        const receiptNumber = `RCT-${String(receiptCounter).padStart(6, '0')}`;
        const method = (['UPI', 'CARD', 'BANK_TRANSFER', 'CASH', 'UPI', 'UPI'] as const)[studentIndex % 6] ?? 'UPI';
        const payment = await prisma.studentPayment.upsert({
          where: { tenantId_receiptNumber: { tenantId, receiptNumber } },
          update: {
            amountCents: paymentTarget,
            status: 'SUCCEEDED',
            studentFeeId: null,
          },
          create: {
            id: id(`payment/${student.admissionNumber}`),
            tenantId,
            studentId: student.id,
            receiptNumber,
            amountCents: paymentTarget,
            currency: 'INR',
            paymentDate: demoDate(`2026-08-0${(studentIndex % 9) + 1}`),
            method,
            status: 'SUCCEEDED',
            referenceNumber: `DEMO-${method}-${receiptNumber}`,
            idempotencyKey: `demo-fee-${student.admissionNumber}-i1`,
            recordedByUserId: accountantUserId,
            remarks: mode === 4 ? 'Partial payment — balance pending' : 'First installment paid in full',
          },
        });
        receiptIds.push(payment.id);

        for (const allocation of allocations) {
          await prisma.studentFeeAllocation.upsert({
            where: { paymentId_studentFeeId: { paymentId: payment.id, studentFeeId: allocation.studentFeeId } },
            update: { amountCents: allocation.amountCents },
            create: {
              id: id(`allocation/${student.admissionNumber}/${allocation.studentFeeId.slice(-8)}`),
              tenantId,
              paymentId: payment.id,
              studentFeeId: allocation.studentFeeId,
              amountCents: allocation.amountCents,
            },
          });
        }

        // Scholarship concession row attached to the tuition line when applicable.
        if (scholarship > 0) {
          const tuitionLine = feeLines[0];
          const tuitionFeeId = id(`fee/${student.admissionNumber}/i1/${tuitionLine?.headId}`);
          await prisma.feeConcession.upsert({
            where: { id: id(`concession/${student.admissionNumber}`) },
            update: { status: 'APPROVED', appliedCents: tuitionLine?.waivedCents ?? 0 },
            create: {
              id: id(`concession/${student.admissionNumber}`),
              tenantId,
              studentId: student.id,
              demandId: demand.id,
              studentFeeId: tuitionFeeId,
              headId: tuitionLine?.headId,
              kind: 'SCHOLARSHIP',
              basis: 'PERCENT',
              percentBps: scholarship,
              appliedCents: tuitionLine?.waivedCents ?? 0,
              reason: 'Merit scholarship — Class XII topper',
              status: 'APPROVED',
              requestedBy: accountantUserId,
              decidedBy: creator,
              decidedAt: demoDate('2026-08-01'),
            },
          });
        }
      } else if (isFirst && scholarship > 0) {
        // Unpaid student with a scholarship: record the approved concession anyway.
        const tuitionLine = feeLines[0];
        await prisma.feeConcession.upsert({
          where: { id: id(`concession/${student.admissionNumber}`) },
          update: { status: 'APPROVED', appliedCents: tuitionLine?.waivedCents ?? 0 },
          create: {
            id: id(`concession/${student.admissionNumber}`),
            tenantId,
            studentId: student.id,
            demandId: demand.id,
            studentFeeId: id(`fee/${student.admissionNumber}/i1/${tuitionLine?.headId}`),
            headId: tuitionLine?.headId,
            kind: 'SCHOLARSHIP',
            basis: 'PERCENT',
            percentBps: scholarship,
            appliedCents: tuitionLine?.waivedCents ?? 0,
            reason: 'Merit scholarship — Class XII topper',
            status: 'APPROVED',
            requestedBy: accountantUserId,
            decidedBy: creator,
            decidedAt: demoDate('2026-08-01'),
          },
        });
      }
    }

    // One pending concession request for the accounts team to work through.
    if (studentIndex === 2) {
      await prisma.feeConcession.upsert({
        where: { id: id('concession/pending-1') },
        update: { status: 'PENDING' },
        create: {
          id: id('concession/pending-1'),
          tenantId,
          studentId: student.id,
          kind: 'CONCESSION',
          basis: 'PERCENT',
          percentBps: 1000,
          reason: 'Sibling concession request (10%) — pending verification',
          status: 'PENDING',
          requestedBy: accountantUserId,
        },
      });
    }
  }

  // One refund request against the first collected installment payment.
  const refundPaymentId = receiptIds[0];
  const refundStudent = people.students[0];
  if (refundPaymentId && refundStudent) {
    await prisma.feeRefund.upsert({
      where: { tenantId_refundNumber: { tenantId, refundNumber: 'RFN-000001' } },
      update: { status: 'REQUESTED' },
      create: {
        id: id('refund/1'),
        tenantId,
        studentId: refundStudent.id,
        paymentId: refundPaymentId,
        refundNumber: 'RFN-000001',
        amountCents: 500_000,
        method: 'BANK_TRANSFER',
        reason: 'Excess amount collected — transport fee cancelled after payment',
        status: 'REQUESTED',
        requestedBy: accountantUserId,
      },
    });
  }

  logDemo('fees', {
    heads: HEAD_SPECS.length,
    structures: STRUCTURE_SPECS.length,
    demands: demandCounter,
    receipts: receiptCounter,
  });

  return { receipts: receiptCounter, demands: demandCounter };
}
