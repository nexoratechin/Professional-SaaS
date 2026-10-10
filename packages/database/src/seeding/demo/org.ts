/**
 * Demo module 01+02 — the demo college tenant itself (subscription, configuration, SaaS invoice)
 * and its academic organisation (campuses, buildings, rooms, departments, academic years, terms,
 * programs, batches, sections, HR designations, leave types, calendar events).
 */
import type { PrismaClient } from '@prisma/client';
import { recomputeTenantEntitlements } from '../../provisioning/entitlement-recompute';
import { demoDate, demoId, logDemo, type IdMap } from './core';

export const DEMO_TENANT = {
  slug: 'demo-college',
  name: 'Sunrise Institute of Technology & Management',
  billingEmail: 'billing@sunrise-demo.edu',
  timezone: 'Asia/Kolkata',
} as const;

const ENTERPRISE_BASE_CENTS = 45_000_000; // INR 4,50,000 / year
const ENTERPRISE_PER_STUDENT_CENTS = 4_500_00;
const PER_STUDENT_COUNT = 400;
const AI_ADDON_CENTS = 15_000_000;

export interface OrganisationIds extends IdMap {
  campusMain: string;
  campusCity: string;
  btechCse: string;
  btechEce: string;
  btechMe: string;
  bba: string;
  mca: string;
  deptCse: string;
  deptEce: string;
  deptMe: string;
  deptBba: string;
  deptMca: string;
  deptAdmin: string;
  yearCurrent: string;
  yearPrevious: string;
  yearNext: string;
  termOddCurrent: string;
  termEvenCurrent: string;
  termOddPrevious: string;
  termEvenPrevious: string;
  batchCse2023: string;
  batchBba2023: string;
  batchCse2025: string;
  batchEce2025: string;
  batchBba2025: string;
  batchCse2026: string;
  batchEce2026: string;
  batchMe2026: string;
  batchBba2026: string;
  batchMca2026: string;
  sectionCse2026A: string;
  sectionEce2026A: string;
}

/** Seeds (idempotently) the tenant, its enterprise subscription + SaaS billing snapshot, the
 *  tenant configuration/security documents, and the academic organisation skeleton. */
export async function seedTenantAndOrganisation(
  prisma: PrismaClient,
): Promise<{ tenantId: string; ids: OrganisationIds }> {
  const id = (segment: string) => demoId(`organisation/${segment}`);

  // ------------------------------------------------------------------ tenant + SaaS billing
  const tenant = await prisma.tenant.upsert({
    where: { slug: DEMO_TENANT.slug },
    update: {
      name: DEMO_TENANT.name,
      status: 'ACTIVE',
      billingEmail: DEMO_TENANT.billingEmail,
      timezone: DEMO_TENANT.timezone,
      dataIsolationMode: 'SHARED',
    },
    create: {
      id: id('tenant'),
      slug: DEMO_TENANT.slug,
      name: DEMO_TENANT.name,
      status: 'ACTIVE',
      billingEmail: DEMO_TENANT.billingEmail,
      timezone: DEMO_TENANT.timezone,
      dataIsolationMode: 'SHARED',
      createdAt: demoDate('2026-06-15'),
    },
  });

  const plan = await prisma.plan.findUniqueOrThrow({ where: { code: 'enterprise' } });

  const subscription = await prisma.subscription.upsert({
    where: { id: id('subscription') },
    update: {
      planId: plan.id,
      status: 'ACTIVE',
      billingCycle: 'ANNUAL',
      currentPeriodStart: demoDate('2026-07-01'),
      currentPeriodEnd: demoDate('2027-06-30'),
    },
    create: {
      id: id('subscription'),
      tenantId: tenant.id,
      planId: plan.id,
      status: 'ACTIVE',
      billingCycle: 'ANNUAL',
      currentPeriodStart: demoDate('2026-07-01'),
      currentPeriodEnd: demoDate('2027-06-30'),
      createdAt: demoDate('2026-06-15'),
    },
  });

  const subscriptionItems = [
    {
      key: 'base',
      itemType: 'BASE' as const,
      description: 'Enterprise Plan — annual subscription',
      moduleKey: null,
      quantity: 1,
      unitPriceCents: ENTERPRISE_BASE_CENTS,
    },
    {
      key: 'per-student',
      itemType: 'PER_STUDENT' as const,
      description: 'Per-student platform fee',
      moduleKey: null,
      quantity: PER_STUDENT_COUNT,
      unitPriceCents: ENTERPRISE_PER_STUDENT_CENTS,
    },
    {
      key: 'ai-addon',
      itemType: 'ADDON_MODULE' as const,
      description: 'AI Assistant add-on',
      moduleKey: 'ai',
      quantity: 1,
      unitPriceCents: AI_ADDON_CENTS,
    },
  ];
  for (const item of subscriptionItems) {
    await prisma.subscriptionItem.upsert({
      where: { id: id(`subscription-item/${item.key}`) },
      update: {
        description: item.description,
        moduleKey: item.moduleKey,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
      },
      create: {
        id: id(`subscription-item/${item.key}`),
        tenantId: tenant.id,
        subscriptionId: subscription.id,
        itemType: item.itemType,
        description: item.description,
        moduleKey: item.moduleKey,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        createdAt: demoDate('2026-06-15'),
      },
    });
  }

  const subtotalCents =
    ENTERPRISE_BASE_CENTS + PER_STUDENT_COUNT * ENTERPRISE_PER_STUDENT_CENTS + AI_ADDON_CENTS;
  const taxCents = Math.round(subtotalCents * 0.18 * 0.01) * 100;
  const invoice = await prisma.invoice.upsert({
    where: { id: id('saas-invoice') },
    update: {
      status: 'PAID',
      subtotalCents,
      taxCents,
      totalCents: subtotalCents + taxCents,
      paidAt: demoDate('2026-07-05'),
    },
    create: {
      id: id('saas-invoice'),
      tenantId: tenant.id,
      subscriptionId: subscription.id,
      invoiceNumber: 'INV-2026-000001',
      status: 'PAID',
      currency: 'INR',
      subtotalCents,
      taxCents,
      totalCents: subtotalCents + taxCents,
      periodStart: demoDate('2026-07-01'),
      periodEnd: demoDate('2027-06-30'),
      issuedAt: demoDate('2026-06-20'),
      dueAt: demoDate('2026-07-05'),
      paidAt: demoDate('2026-07-05'),
      createdAt: demoDate('2026-06-20'),
    },
  });

  const invoiceLines = [
    { key: 'base', description: 'Enterprise Plan — annual subscription', quantity: 1, unitPriceCents: ENTERPRISE_BASE_CENTS },
    {
      key: 'per-student',
      description: `Per-student platform fee (${PER_STUDENT_COUNT} students)`,
      quantity: PER_STUDENT_COUNT,
      unitPriceCents: ENTERPRISE_PER_STUDENT_CENTS,
    },
    { key: 'ai', description: 'AI Assistant add-on', quantity: 1, unitPriceCents: AI_ADDON_CENTS },
  ];
  for (const line of invoiceLines) {
    await prisma.invoiceLineItem.upsert({
      where: { id: id(`invoice-line/${line.key}`) },
      update: {
        description: line.description,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        amountCents: line.quantity * line.unitPriceCents,
      },
      create: {
        id: id(`invoice-line/${line.key}`),
        tenantId: tenant.id,
        invoiceId: invoice.id,
        description: line.description,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        amountCents: line.quantity * line.unitPriceCents,
        createdAt: demoDate('2026-06-20'),
      },
    });
  }

  await prisma.payment.upsert({
    where: { id: id('saas-payment') },
    update: { status: 'SUCCEEDED', paidAt: demoDate('2026-07-05') },
    create: {
      id: id('saas-payment'),
      tenantId: tenant.id,
      subscriptionId: subscription.id,
      invoiceId: invoice.id,
      amountCents: subtotalCents + taxCents,
      currency: 'INR',
      status: 'SUCCEEDED',
      method: 'BANK_TRANSFER',
      gatewayReference: 'DEMO-NEFT-20260705-0001',
      paidAt: demoDate('2026-07-05'),
      createdAt: demoDate('2026-07-05'),
    },
  });

  // ------------------------------------------------------------------ tenant documents
  await prisma.tenantConfiguration.upsert({
    where: { tenantId: tenant.id },
    update: {},
    create: {
      id: id('tenant-config'),
      tenantId: tenant.id,
      data: {
        branding: {
          displayName: DEMO_TENANT.name,
          shortName: 'Sunrise Institute',
          primaryColor: '#1d4ed8',
          accentColor: '#f59e0b',
        },
        attendance: { minimumPercent: 75, lateToleranceMinutes: 10 },
        numbering: { receiptPrefix: 'RCT', demandPrefix: 'DEM', refundPrefix: 'RFN' },
      },
      createdBy: undefined,
    },
  });

  await prisma.tenantSecuritySettings.upsert({
    where: { tenantId: tenant.id },
    update: {},
    create: {
      id: id('tenant-security'),
      tenantId: tenant.id,
      notifyOnNewDeviceLogin: true,
      blockSuspiciousLogins: false,
      localAuthEnabled: true,
    },
  });

  // Materialize the enterprise plan's entitlements so every module in this dataset is unlocked.
  await recomputeTenantEntitlements(prisma, tenant.id);

  // ------------------------------------------------------------------ organisation
  const campuses = [
    {
      key: 'campusMain',
      code: 'MAIN',
      name: 'Main Campus — Baner',
      addressLine: 'Survey No. 42, Baner Road',
      city: 'Pune',
      state: 'Maharashtra',
    },
    {
      key: 'campusCity',
      code: 'CITY',
      name: 'City Campus — Shivaji Nagar',
      addressLine: 'Plot 7, FC Road, Shivaji Nagar',
      city: 'Pune',
      state: 'Maharashtra',
    },
  ];
  const campusIds: Record<string, string> = {};
  for (const campus of campuses) {
    const row = await prisma.campus.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: campus.code } },
      update: {
        name: campus.name,
        addressLine: campus.addressLine,
        city: campus.city,
        state: campus.state,
        country: 'India',
        isActive: true,
      },
      create: {
        id: id(`campus/${campus.code}`),
        tenantId: tenant.id,
        code: campus.code,
        name: campus.name,
        addressLine: campus.addressLine,
        city: campus.city,
        state: campus.state,
        country: 'India',
      },
    });
    campusIds[campus.key] = row.id;
  }
  const campusMain = campusIds['campusMain'] as string;
  const campusCity = campusIds['campusCity'] as string;

  const buildings = [
    { key: 'blockA', campusId: campusMain, code: 'BLOCK-A', name: 'Academic Block A' },
    { key: 'blockB', campusId: campusMain, code: 'BLOCK-B', name: 'Academic Block B' },
    { key: 'cityBlock', campusId: campusCity, code: 'CITY-1', name: 'City Academic Block' },
  ];
  const buildingIds: Record<string, string> = {};
  for (const building of buildings) {
    const row = await prisma.building.upsert({
      where: {
        tenantId_campusId_code: { tenantId: tenant.id, campusId: building.campusId, code: building.code },
      },
      update: { name: building.name, isActive: true },
      create: {
        id: id(`building/${building.code}`),
        tenantId: tenant.id,
        campusId: building.campusId,
        code: building.code,
        name: building.name,
      },
    });
    buildingIds[building.key] = row.id;
  }

  const rooms = [
    { key: 'a101', campusId: campusMain, building: 'blockA', code: 'A-101', name: 'Classroom A-101', roomType: 'CLASSROOM', capacity: 60 },
    { key: 'a102', campusId: campusMain, building: 'blockA', code: 'A-102', name: 'Classroom A-102', roomType: 'CLASSROOM', capacity: 60 },
    { key: 'a201', campusId: campusMain, building: 'blockA', code: 'A-201', name: 'CS Laboratory', roomType: 'LABORATORY', capacity: 40 },
    { key: 'a202', campusId: campusMain, building: 'blockA', code: 'A-202', name: 'Seminar Hall', roomType: 'SEMINAR_HALL', capacity: 90 },
    { key: 'b101', campusId: campusMain, building: 'blockB', code: 'B-101', name: 'Classroom B-101', roomType: 'CLASSROOM', capacity: 70 },
    { key: 'b102', campusId: campusMain, building: 'blockB', code: 'B-102', name: 'Classroom B-102', roomType: 'CLASSROOM', capacity: 70 },
    { key: 'lib1', campusId: campusMain, building: 'blockB', code: 'LIB-1', name: 'Central Library Reading Hall', roomType: 'LIBRARY', capacity: 120 },
    { key: 'c101', campusId: campusCity, building: 'cityBlock', code: 'C-101', name: 'Classroom C-101', roomType: 'CLASSROOM', capacity: 50 },
    { key: 'c102', campusId: campusCity, building: 'cityBlock', code: 'C-102', name: 'City Computer Lab', roomType: 'LABORATORY', capacity: 30 },
  ] as const;
  const roomIds: Record<string, string> = {};
  for (const room of rooms) {
    const row = await prisma.room.upsert({
      where: { campusId_code: { campusId: room.campusId, code: room.code } },
      update: { name: room.name, roomType: room.roomType, capacity: room.capacity, isActive: true },
      create: {
        id: id(`room/${room.code}`),
        tenantId: tenant.id,
        campusId: room.campusId,
        buildingId: buildingIds[room.building] as string,
        code: room.code,
        name: room.name,
        roomType: room.roomType,
        capacity: room.capacity,
      },
    });
    roomIds[room.key] = row.id;
  }

  const departments = [
    { key: 'deptCse', campusId: campusMain, code: 'CSE', name: 'Computer Science & Engineering' },
    { key: 'deptEce', campusId: campusMain, code: 'ECE', name: 'Electronics & Communication Engineering' },
    { key: 'deptMe', campusId: campusMain, code: 'ME', name: 'Mechanical Engineering' },
    { key: 'deptBba', campusId: campusCity, code: 'BBA', name: 'Business Administration' },
    { key: 'deptMca', campusId: campusCity, code: 'MCA', name: 'Computer Applications' },
    { key: 'deptAdmin', campusId: campusMain, code: 'ADMIN', name: 'Administration' },
  ] as const;
  const departmentIds: Record<string, string> = {};
  for (const dept of departments) {
    const row = await prisma.department.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: dept.code } },
      update: { name: dept.name, campusId: dept.campusId, isActive: true },
      create: {
        id: id(`department/${dept.code}`),
        tenantId: tenant.id,
        campusId: dept.campusId,
        code: dept.code,
        name: dept.name,
      },
    });
    departmentIds[dept.key] = row.id;
  }

  const academicYears = [
    {
      key: 'yearPrevious',
      code: '2025-26',
      name: 'Academic Year 2025-26',
      startDate: demoDate('2025-07-01'),
      endDate: demoDate('2026-06-30'),
      isCurrent: false,
    },
    {
      key: 'yearCurrent',
      code: '2026-27',
      name: 'Academic Year 2026-27',
      startDate: demoDate('2026-07-01'),
      endDate: demoDate('2027-06-30'),
      isCurrent: true,
    },
    {
      key: 'yearNext',
      code: '2027-28',
      name: 'Academic Year 2027-28',
      startDate: demoDate('2027-07-01'),
      endDate: demoDate('2028-06-30'),
      isCurrent: false,
    },
  ] as const;
  const academicYearIds: Record<string, string> = {};
  for (const year of academicYears) {
    const row = await prisma.academicYear.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: year.code } },
      update: { name: year.name, startDate: year.startDate, endDate: year.endDate, isCurrent: year.isCurrent },
      create: {
        id: id(`academic-year/${year.code}`),
        tenantId: tenant.id,
        code: year.code,
        name: year.name,
        startDate: year.startDate,
        endDate: year.endDate,
        isCurrent: year.isCurrent,
      },
    });
    academicYearIds[year.key] = row.id;
  }
  const yearCurrent = academicYearIds['yearCurrent'] as string;
  const yearPrevious = academicYearIds['yearPrevious'] as string;

  const terms = [
    { key: 'termOddPrevious', year: 'yearPrevious', code: 'ODD-2526', name: 'Odd Semester 2025-26', startDate: demoDate('2025-07-15'), endDate: demoDate('2025-12-20'), sequence: 1, isCurrent: false },
    { key: 'termEvenPrevious', year: 'yearPrevious', code: 'EVEN-2526', name: 'Even Semester 2025-26', startDate: demoDate('2026-01-05'), endDate: demoDate('2026-06-15'), sequence: 2, isCurrent: false },
    { key: 'termOddCurrent', year: 'yearCurrent', code: 'ODD-2627', name: 'Odd Semester 2026-27', startDate: demoDate('2026-07-15'), endDate: demoDate('2026-12-20'), sequence: 1, isCurrent: true },
    { key: 'termEvenCurrent', year: 'yearCurrent', code: 'EVEN-2627', name: 'Even Semester 2026-27', startDate: demoDate('2027-01-05'), endDate: demoDate('2027-06-15'), sequence: 2, isCurrent: false },
  ] as const;
  const termIds: Record<string, string> = {};
  for (const term of terms) {
    const academicYearId = academicYearIds[term.year] as string;
    const row = await prisma.term.upsert({
      where: { academicYearId_code: { academicYearId, code: term.code } },
      update: {
        name: term.name,
        sequence: term.sequence,
        startDate: term.startDate,
        endDate: term.endDate,
        isCurrent: term.isCurrent,
      },
      create: {
        id: id(`term/${term.code}`),
        tenantId: tenant.id,
        academicYearId,
        code: term.code,
        name: term.name,
        sequence: term.sequence,
        startDate: term.startDate,
        endDate: term.endDate,
        isCurrent: term.isCurrent,
      },
    });
    termIds[term.key] = row.id;
  }

  const programs = [
    { key: 'btechCse', dept: 'deptCse', code: 'BTECH-CSE', name: 'B.Tech Computer Science & Engineering', degreeLevel: 'UG', durationYears: 4 },
    { key: 'btechEce', dept: 'deptEce', code: 'BTECH-ECE', name: 'B.Tech Electronics & Communication Engineering', degreeLevel: 'UG', durationYears: 4 },
    { key: 'btechMe', dept: 'deptMe', code: 'BTECH-ME', name: 'B.Tech Mechanical Engineering', degreeLevel: 'UG', durationYears: 4 },
    { key: 'bba', dept: 'deptBba', code: 'BBA', name: 'Bachelor of Business Administration', degreeLevel: 'UG', durationYears: 3 },
    { key: 'mca', dept: 'deptMca', code: 'MCA', name: 'Master of Computer Applications', degreeLevel: 'PG', durationYears: 2 },
  ] as const;
  const programIds: Record<string, string> = {};
  for (const program of programs) {
    const row = await prisma.program.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: program.code } },
      update: {
        name: program.name,
        departmentId: departmentIds[program.dept] as string,
        degreeLevel: program.degreeLevel,
        durationYears: program.durationYears,
        isActive: true,
      },
      create: {
        id: id(`program/${program.code}`),
        tenantId: tenant.id,
        departmentId: departmentIds[program.dept] as string,
        code: program.code,
        name: program.name,
        degreeLevel: program.degreeLevel,
        durationYears: program.durationYears,
      },
    });
    programIds[program.key] = row.id;
  }

  const batches = [
    { key: 'batchCse2023', program: 'btechCse', code: '2023', start: '2023-07-15', end: '2027-06-30' },
    { key: 'batchBba2023', program: 'bba', code: '2023', start: '2023-07-15', end: '2026-06-30' },
    { key: 'batchCse2025', program: 'btechCse', code: '2025', start: '2025-07-15', end: '2029-06-30' },
    { key: 'batchEce2025', program: 'btechEce', code: '2025', start: '2025-07-15', end: '2029-06-30' },
    { key: 'batchBba2025', program: 'bba', code: '2025', start: '2025-07-15', end: '2028-06-30' },
    { key: 'batchCse2026', program: 'btechCse', code: '2026', start: '2026-07-15', end: '2030-06-30' },
    { key: 'batchEce2026', program: 'btechEce', code: '2026', start: '2026-07-15', end: '2030-06-30' },
    { key: 'batchMe2026', program: 'btechMe', code: '2026', start: '2026-07-15', end: '2030-06-30' },
    { key: 'batchBba2026', program: 'bba', code: '2026', start: '2026-07-15', end: '2029-06-30' },
    { key: 'batchMca2026', program: 'mca', code: '2026', start: '2026-07-15', end: '2028-06-30' },
  ] as const;
  const batchIds: Record<string, string> = {};
  for (const batch of batches) {
    const programId = programIds[batch.program] as string;
    const row = await prisma.batch.upsert({
      where: { tenantId_programId_code: { tenantId: tenant.id, programId, code: batch.code } },
      update: {
        name: `${batch.code} Batch`,
        startDate: demoDate(batch.start),
        endDate: demoDate(batch.end),
        isActive: true,
      },
      create: {
        id: id(`batch/${batch.program}/${batch.code}`),
        tenantId: tenant.id,
        programId,
        code: batch.code,
        name: `${batch.code} Batch`,
        startDate: demoDate(batch.start),
        endDate: demoDate(batch.end),
      },
    });
    batchIds[batch.key] = row.id;
  }

  const sections = [
    { key: 'sectionCse2026A', program: 'btechCse', year: 'yearCurrent', code: 'A-2026', name: 'CSE 2026 — Section A', capacity: 60 },
    { key: 'sectionCse2026B', program: 'btechCse', year: 'yearCurrent', code: 'B-2026', name: 'CSE 2026 — Section B', capacity: 60 },
    { key: 'sectionEce2026A', program: 'btechEce', year: 'yearCurrent', code: 'A-2026', name: 'ECE 2026 — Section A', capacity: 60 },
    { key: 'sectionMe2026A', program: 'btechMe', year: 'yearCurrent', code: 'A-2026', name: 'ME 2026 — Section A', capacity: 60 },
    { key: 'sectionBba2026A', program: 'bba', year: 'yearCurrent', code: 'A-2026', name: 'BBA 2026 — Section A', capacity: 50 },
    { key: 'sectionMca2026A', program: 'mca', year: 'yearCurrent', code: 'A-2026', name: 'MCA 2026 — Section A', capacity: 40 },
    { key: 'sectionCse2025A', program: 'btechCse', year: 'yearPrevious', code: 'A-2025', name: 'CSE 2025 — Section A', capacity: 60 },
    { key: 'sectionEce2025A', program: 'btechEce', year: 'yearPrevious', code: 'A-2025', name: 'ECE 2025 — Section A', capacity: 60 },
    { key: 'sectionBba2025A', program: 'bba', year: 'yearPrevious', code: 'A-2025', name: 'BBA 2025 — Section A', capacity: 50 },
    { key: 'sectionCse2023A', program: 'btechCse', year: 'yearPrevious', code: 'A-2023', name: 'CSE 2023 — Section A', capacity: 60 },
    { key: 'sectionBba2023A', program: 'bba', year: 'yearPrevious', code: 'A-2023', name: 'BBA 2023 — Section A', capacity: 50 },
  ] as const;
  const sectionIds: Record<string, string> = {};
  for (const section of sections) {
    const programId = programIds[section.program] as string;
    const row = await prisma.section.upsert({
      where: { tenantId_programId_code: { tenantId: tenant.id, programId, code: section.code } },
      update: {
        name: section.name,
        academicYearId: academicYearIds[section.year] as string,
        capacity: section.capacity,
        isActive: true,
      },
      create: {
        id: id(`section/${section.program}/${section.code}`),
        tenantId: tenant.id,
        programId,
        academicYearId: academicYearIds[section.year] as string,
        code: section.code,
        name: section.name,
        capacity: section.capacity,
      },
    });
    sectionIds[section.key] = row.id;
  }

  const designations = [
    ['PROFESSOR', 'Professor', 'deptAdmin'],
    ['ASSOC_PROF', 'Associate Professor', 'deptAdmin'],
    ['ASST_PROF', 'Assistant Professor', 'deptAdmin'],
    ['REGISTRAR', 'Registrar', 'deptAdmin'],
    ['ACCOUNTANT', 'Senior Accountant', 'deptAdmin'],
    ['LIBRARIAN', 'Chief Librarian', 'deptAdmin'],
    ['WARDEN', 'Hostel Warden', 'deptAdmin'],
    ['TRANSPORT_MGR', 'Transport Manager', 'deptAdmin'],
    ['HR_MGR', 'HR Manager', 'deptAdmin'],
    ['PLACEMENT_OFF', 'Placement Officer', 'deptAdmin'],
    ['EXAM_CTRL', 'Exam Controller', 'deptAdmin'],
    ['ADMIN_OFFICER', 'Administrative Officer', 'deptAdmin'],
  ] as const;
  for (const [code, name, deptKey] of designations) {
    await prisma.hrDesignation.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code } },
      update: { name, departmentId: departmentIds[deptKey] as string, isActive: true },
      create: {
        id: id(`designation/${code}`),
        tenantId: tenant.id,
        departmentId: departmentIds[deptKey] as string,
        code,
        name,
      },
    });
  }

  const leaveTypes = [
    { code: 'CL', name: 'Casual Leave', category: 'CASUAL' as const, maxDays: 12 },
    { code: 'SL', name: 'Sick Leave', category: 'SICK' as const, maxDays: 10 },
    { code: 'EL', name: 'Earned Leave', category: 'EARNED' as const, maxDays: 15 },
  ];
  for (const type of leaveTypes) {
    await prisma.leaveType.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: type.code } },
      update: { name: type.name, category: type.category, maxDaysPerYear: type.maxDays, isActive: true },
      create: {
        id: id(`leave-type/${type.code}`),
        tenantId: tenant.id,
        code: type.code,
        name: type.name,
        category: type.category,
        maxDaysPerYear: type.maxDays,
      },
    });
  }

  const calendarEvents = [
    { key: 'term-start', title: 'Odd Semester 2026-27 commences', eventType: 'TERM', startAt: demoDate('2026-07-15'), endAt: demoDate('2026-07-15'), term: 'termOddCurrent' },
    { key: 'gandhi-jayanti', title: 'Gandhi Jayanti — Holiday', eventType: 'HOLIDAY', startAt: demoDate('2026-10-02'), endAt: demoDate('2026-10-02'), term: 'termOddCurrent' },
    { key: 'mid-sem', title: 'Mid-semester Examinations', eventType: 'EXAM', startAt: demoDate('2026-09-14'), endAt: demoDate('2026-09-19'), term: 'termOddCurrent' },
    { key: 'tech-fest', title: 'Sunrise TechnoVision 2026', eventType: 'EVENT', startAt: demoDate('2026-11-06'), endAt: demoDate('2026-11-07'), term: 'termOddCurrent' },
    { key: 'end-sem', title: 'Odd Semester 2026-27 End-term Examinations', eventType: 'EXAM', startAt: demoDate('2026-12-01'), endAt: demoDate('2026-12-16'), term: 'termOddCurrent' },
    { key: 'results', title: 'Odd Semester Results Declaration', eventType: 'RESULT', startAt: demoDate('2027-01-05'), endAt: demoDate('2027-01-05'), term: 'termOddCurrent' },
  ];
  for (const event of calendarEvents) {
    const academicYearId = yearCurrent;
    await prisma.academicCalendarEvent.upsert({
      where: { id: id(`calendar/${event.key}`) },
      update: {
        title: event.title,
        eventType: event.eventType,
        startAt: event.startAt,
        endAt: event.endAt,
        termId: termIds[event.term] as string,
        isPublished: true,
      },
      create: {
        id: id(`calendar/${event.key}`),
        tenantId: tenant.id,
        academicYearId,
        termId: termIds[event.term] as string,
        eventType: event.eventType,
        title: event.title,
        startAt: event.startAt,
        endAt: event.endAt,
        isPublished: true,
        createdBy: undefined,
      },
    });
  }

  const ids: OrganisationIds = {
    campusMain,
    campusCity,
    btechCse: programIds['btechCse'] as string,
    btechEce: programIds['btechEce'] as string,
    btechMe: programIds['btechMe'] as string,
    bba: programIds['bba'] as string,
    mca: programIds['mca'] as string,
    deptCse: departmentIds['deptCse'] as string,
    deptEce: departmentIds['deptEce'] as string,
    deptMe: departmentIds['deptMe'] as string,
    deptBba: departmentIds['deptBba'] as string,
    deptMca: departmentIds['deptMca'] as string,
    deptAdmin: departmentIds['deptAdmin'] as string,
    yearCurrent,
    yearPrevious,
    yearNext: academicYearIds['yearNext'] as string,
    termOddCurrent: termIds['termOddCurrent'] as string,
    termEvenCurrent: termIds['termEvenCurrent'] as string,
    termOddPrevious: termIds['termOddPrevious'] as string,
    termEvenPrevious: termIds['termEvenPrevious'] as string,
    batchCse2023: batchIds['batchCse2023'] as string,
    batchBba2023: batchIds['batchBba2023'] as string,
    batchCse2025: batchIds['batchCse2025'] as string,
    batchEce2025: batchIds['batchEce2025'] as string,
    batchBba2025: batchIds['batchBba2025'] as string,
    batchCse2026: batchIds['batchCse2026'] as string,
    batchEce2026: batchIds['batchEce2026'] as string,
    batchMe2026: batchIds['batchMe2026'] as string,
    batchBba2026: batchIds['batchBba2026'] as string,
    batchMca2026: batchIds['batchMca2026'] as string,
    sectionCse2026A: sectionIds['sectionCse2026A'] as string,
    sectionEce2026A: sectionIds['sectionEce2026A'] as string,
    // Extra keys consumed by later modules and returned via the map below.
    roomA201: roomIds['a201'] as string,
    roomA101: roomIds['a101'] as string,
    roomB101: roomIds['b101'] as string,
    roomLib1: roomIds['lib1'] as string,
    buildingBlockA: buildingIds['blockA'] as string,
    buildingBlockB: buildingIds['blockB'] as string,
    buildingCity: buildingIds['cityBlock'] as string,
    sectionMe2026A: sectionIds['sectionMe2026A'] as string,
    sectionBba2026A: sectionIds['sectionBba2026A'] as string,
    sectionMca2026A: sectionIds['sectionMca2026A'] as string,
    sectionCse2025A: sectionIds['sectionCse2025A'] as string,
    sectionEce2025A: sectionIds['sectionEce2025A'] as string,
    sectionBba2025A: sectionIds['sectionBba2025A'] as string,
    sectionCse2023A: sectionIds['sectionCse2023A'] as string,
    sectionBba2023A: sectionIds['sectionBba2023A'] as string,
  };

  logDemo('tenant+organisation', {
    campuses: campuses.length,
    buildings: buildings.length,
    rooms: rooms.length,
    departments: departments.length,
    programs: programs.length,
    batches: batches.length,
    sections: sections.length,
  });

  return { tenantId: tenant.id, ids };
}