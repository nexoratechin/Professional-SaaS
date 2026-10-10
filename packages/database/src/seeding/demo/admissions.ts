/**
 * Demo module 05 — admissions: the closed 2026 intake (fully processed, several applicants
 * enrolled into the student body) and the currently-open 2027 intake (enquiries, in-flight
 * applications with documents/qualifications, counselling slots, offers and fee receipts).
 */
import type { PrismaClient } from '@prisma/client';
import { demoDate, demoDateTime, demoId, logDemo, spread, stablePick, type DemoContext, type IdMap } from './core';
import { ADMISSION_ENQUIRY_NAMES, STUDENT_LAST_NAMES } from './names';
import type { SeededPeople } from './people';

export interface SeededAdmissions {
  closedSessionId: string;
  openSessionId: string;
  applicationCount: number;
}

export interface AdmissionsInput {
  prisma: PrismaClient;
  ctx: DemoContext;
  org: IdMap;
  people: SeededPeople;
}

const PROGRAM_KEYS = ['btechCse', 'btechEce', 'btechMe', 'bba', 'mca'] as const;

export async function seedAdmissions(input: AdmissionsInput): Promise<SeededAdmissions> {
  const { prisma, ctx, org, people } = input;
  const { tenantId, creator } = ctx;
  const id = (segment: string) => demoId(`admissions/${segment}`);

  const sessions = [
    {
      key: 'closed',
      code: 'ADM-2026',
      name: 'Admissions 2026-27 — Regular Round',
      academicYearId: org['yearCurrent'] as string,
      startAt: demoDate('2026-02-01'),
      endAt: demoDate('2026-07-31'),
      applicationFeeCents: 100_000,
      admissionFeeCents: 2_500_000,
      status: 'CLOSED' as const,
      meritPublishedAt: demoDate('2026-06-10'),
    },
    {
      key: 'open',
      code: 'ADM-2027',
      name: 'Admissions 2027-28 — Regular Round',
      academicYearId: org['yearNext'] as string,
      startAt: demoDate('2026-10-01'),
      endAt: demoDate('2027-06-30'),
      applicationFeeCents: 120_000,
      admissionFeeCents: 2_800_000,
      status: 'OPEN' as const,
      meritPublishedAt: null as Date | null,
    },
  ];

  const sessionIds: Record<string, string> = {};
  const programOfferIds: Record<string, Record<string, string>> = {};

  for (const session of sessions) {
    const row = await prisma.admissionSession.upsert({
      where: { tenantId_code: { tenantId, code: session.code } },
      update: {
        name: session.name,
        startAt: session.startAt,
        endAt: session.endAt,
        status: session.status,
        meritPublishedAt: session.meritPublishedAt,
        updatedBy: creator,
      },
      create: {
        id: id(`session/${session.code}`),
        tenantId,
        code: session.code,
        name: session.name,
        academicYearId: session.academicYearId,
        startAt: session.startAt,
        endAt: session.endAt,
        applicationFeeCents: session.applicationFeeCents,
        admissionFeeCents: session.admissionFeeCents,
        status: session.status,
        source: 'FRONT_DESK',
        requiredDocuments: ['Class XII marksheet', 'Transfer certificate', 'Photo ID', 'Passport photo'],
        meritPublishedAt: session.meritPublishedAt ?? undefined,
        createdBy: creator,
      },
    });
    sessionIds[session.key] = row.id;

    programOfferIds[session.key] = {};
    for (const [index, programKey] of PROGRAM_KEYS.entries()) {
      const offer = await prisma.admissionProgramOffer.upsert({
        where: { tenantId_sessionId_programId: { tenantId, sessionId: row.id, programId: org[programKey] as string } },
        update: { status: 'OPEN', updatedBy: creator },
        create: {
          id: id(`program-offer/${session.code}/${programKey}`),
          tenantId,
          sessionId: row.id,
          programId: org[programKey] as string,
          seats: programKey.startsWith('btech') ? 60 : 40,
          filledSeats: session.key === 'closed' ? spread(index, 9, 18, 55) : 0,
          applicationFeeCents: session.applicationFeeCents,
          admissionFeeCents: session.admissionFeeCents,
          tuitionFeeCents: programKey === 'bba' ? 9_000_000 : programKey === 'mca' ? 11_000_000 : 13_500_000,
          requiredDocuments: ['Class XII marksheet', 'Transfer certificate', 'Photo ID'],
          createdBy: creator,
        },
      });
      programOfferIds[session.key]![programKey] = offer.id;
    }
  }

  const closedSessionId = sessionIds['closed'] as string;
  const openSessionId = sessionIds['open'] as string;

  // ------------------------------------------------------------------ 2027 intake (open)
  const formFields = [
    { code: 'category', label: 'Admission category', fieldType: 'SELECT' as const, options: ['General', 'OBC', 'SC', 'ST', 'EWS'], required: true },
    { code: 'previousSchool', label: 'Previous school / college', fieldType: 'TEXT' as const, options: null, required: true },
    { code: 'boardRollNo', label: 'Board roll number', fieldType: 'TEXT' as const, options: null, required: false },
    { code: 'hostelRequired', label: 'Hostel accommodation required?', fieldType: 'CHECKBOX' as const, options: null, required: false },
  ];
  for (const [index, field] of formFields.entries()) {
    await prisma.admissionFormField.upsert({
      where: { tenantId_sessionId_code: { tenantId, sessionId: openSessionId, code: field.code } },
      update: { label: field.label, required: field.required, sequenceOrder: index },
      create: {
        id: id(`form-field/${field.code}`),
        tenantId,
        sessionId: openSessionId,
        code: field.code,
        label: field.label,
        fieldType: field.fieldType,
        options: field.options ?? undefined,
        required: field.required,
        sequenceOrder: index,
        createdBy: creator,
      },
    });
  }

  const eligibilityRules = [
    { programKey: 'btechCse', ruleType: 'MIN_PERCENTAGE' as const, config: { minPercentage: 60 }, description: 'Minimum 60% aggregate in Class XII (PCM)' },
    { programKey: 'btechEce', ruleType: 'MIN_PERCENTAGE' as const, config: { minPercentage: 55 }, description: 'Minimum 55% aggregate in Class XII (PCM)' },
    { programKey: 'btechMe', ruleType: 'MIN_PERCENTAGE' as const, config: { minPercentage: 55 }, description: 'Minimum 55% aggregate in Class XII (PCM)' },
    { programKey: 'bba', ruleType: 'MIN_PERCENTAGE' as const, config: { minPercentage: 50 }, description: 'Minimum 50% aggregate in Class XII' },
    { programKey: 'mca', ruleType: 'MIN_GPA' as const, config: { minGpa: 6, scale: 10 }, description: 'Bachelor\u2019s degree with 60% or CGPA 6.0' },
  ];
  for (const rule of eligibilityRules) {
    await prisma.admissionEligibilityRule.upsert({
      where: { id: id(`eligibility/${rule.programKey}`) },
      update: { description: rule.description, isActive: true },
      create: {
        id: id(`eligibility/${rule.programKey}`),
        tenantId,
        // AdmissionEligibilityRule.programId references the session's AdmissionProgramOffer,
        // not the Program itself (see schema.prisma).
        programId: programOfferIds['open']?.[rule.programKey] as string,
        name: `${rule.programKey.toUpperCase()} eligibility`,
        description: rule.description,
        ruleType: rule.ruleType,
        config: rule.config,
        isActive: true,
        createdBy: creator,
      },
    });
  }

  const slots = [
    { key: 'slot-1', day: '2027-05-10', venue: 'Main Campus — Admission Hall', capacity: 20, program: null },
    { key: 'slot-2', day: '2027-05-12', venue: 'Main Campus — Admission Hall', capacity: 20, program: null },
    { key: 'slot-3', day: '2027-05-15', venue: 'City Campus — Counselling Room', capacity: 15, program: 'bba' },
    { key: 'slot-4', day: '2027-05-18', venue: 'Main Campus — Seminar Hall A-202', capacity: 25, program: null },
  ];
  for (const slot of slots) {
    await prisma.admissionCounsellingSlot.upsert({
      where: { id: id(`counselling/${slot.key}`) },
      update: { venue: slot.venue, capacity: slot.capacity },
      create: {
        id: id(`counselling/${slot.key}`),
        tenantId,
        sessionId: openSessionId,
        programId: slot.program ? (org[slot.program] as string) : null,
        date: demoDate(slot.day),
        venue: slot.venue,
        capacity: slot.capacity,
        bookedCount: spread(slots.indexOf(slot), 3, 2, 8),
        createdBy: creator,
      },
    });
  }

  const enquiries = ADMISSION_ENQUIRY_NAMES.map((name, index) => ({
    key: `enquiry-${index + 1}`,
    name,
    email: `enquiry.${index + 1}@example.com`,
    phone: `+9190${String(50_000_000 + index * 4231).slice(0, 8)}`,
    source: stablePick(['WEBSITE', 'WALK_IN', 'PHONE', 'REFERRAL'], index),
    programKey: stablePick([...PROGRAM_KEYS], index),
  }));
  for (const enquiry of enquiries) {
    await prisma.admissionEnquiry.upsert({
      where: { id: id(`enquiry/${enquiry.key}`) },
      update: { message: 'Interested in the programme and hostel facilities; requested a prospectus.' },
      create: {
        id: id(`enquiry/${enquiry.key}`),
        tenantId,
        sessionId: openSessionId,
        programId: org[enquiry.programKey] as string,
        name: enquiry.name,
        email: enquiry.email,
        phone: enquiry.phone,
        source: enquiry.source,
        message: 'Interested in the programme and hostel facilities; requested a prospectus.',
        followUpAt: demoDate('2026-10-20'),
        createdBy: creator,
      },
    });
  }

  const openApplications = [
    { key: 'oa-1', programKey: 'btechCse', name: 'Ritika Shah', status: 'SUBMITTED' as const, submittedAt: '2026-10-05', enquiryIndex: 0 },
    { key: 'oa-2', programKey: 'btechEce', name: 'Nikhil Menon', status: 'UNDER_VERIFICATION' as const, submittedAt: '2026-10-03', enquiryIndex: 1 },
    { key: 'oa-3', programKey: 'bba', name: 'Aditi Bhosale', status: 'DOCUMENTS_VERIFIED' as const, submittedAt: '2026-10-02', enquiryIndex: 2 },
    { key: 'oa-4', programKey: 'mca', name: 'Manav Rathi', status: 'INITIATED' as const, submittedAt: null, enquiryIndex: 4 },
    { key: 'oa-5', programKey: 'btechMe', name: 'Sahil Gaba', status: 'INITIATED' as const, submittedAt: null, enquiryIndex: 5 },
  ];

  let applicationCount = 0;
  const upsertApplication = async (args: {
    key: string;
    applicationNumber: string;
    sessionId: string;
    programKey: string;
    name: string;
    status: 'INITIATED' | 'SUBMITTED' | 'UNDER_VERIFICATION' | 'DOCUMENTS_VERIFIED' | 'MERIT_LISTED' | 'ENROLLED' | 'REJECTED' | 'WAITLISTED' | 'FEE_PAID';
    submittedAt: string | null;
    email: string | null;
    phone: string | null;
    meritScore?: number;
    meritRank?: number;
    enrolledStudentId?: string | null;
    feePaidAt?: string | null;
    feeReceiptNumber?: string | null;
    enquiryId?: string | null;
    rejectedReason?: string | null;
  }) => {
    const [first, ...rest] = args.name.split(' ');
    const lastName = rest.join(' ') || stablePick(STUDENT_LAST_NAMES, 3);
    const row = await prisma.admissionApplication.upsert({
      where: { tenantId_applicationNumber: { tenantId, applicationNumber: args.applicationNumber } },
      update: {
        status: args.status,
        submittedAt: args.submittedAt ? demoDate(args.submittedAt) : null,
        meritScore: args.meritScore ?? null,
        meritRank: args.meritRank ?? null,
        enrolledStudentId: args.enrolledStudentId ?? null,
        feePaidAt: args.feePaidAt ? demoDate(args.feePaidAt) : null,
        feeReceiptNumber: args.feeReceiptNumber ?? null,
        rejectedReason: args.rejectedReason ?? null,
        updatedBy: creator,
      },
      create: {
        id: id(`application/${args.key}`),
        tenantId,
        applicationNumber: args.applicationNumber,
        sessionId: args.sessionId,
        admissionProgramId: programOfferIds[args.sessionId === closedSessionId ? 'closed' : 'open']![args.programKey] as string,
        campusId: (org['campusMain'] ?? org['campusCity']) as string,
        academicYearId: (args.sessionId === closedSessionId ? org['yearCurrent'] : org['yearNext']) as string,
        enquiryId: args.enquiryId ?? null,
        firstName: first ?? 'Applicant',
        lastName,
        fullName: args.name,
        gender: (applicationCount % 2 === 0 ? 'MALE' : 'FEMALE') as 'MALE' | 'FEMALE',
        dateOfBirth: demoDate(`${2007 + (applicationCount % 3)}-0${(applicationCount % 9) + 1}-1${applicationCount % 9}`),
        email: args.email,
        phone: args.phone,
        category: 'General',
        nationality: 'Indian',
        addressLine1: `${spread(applicationCount, 7, 1, 90)}, Kothrud`,
        city: 'Pune',
        state: 'Maharashtra',
        postalCode: '411038',
        country: 'India',
        guardian: { name: `Guardian of ${args.name}`, relation: 'FATHER', phone: args.phone },
        status: args.status,
        submittedAt: args.submittedAt ? demoDate(args.submittedAt) : null,
        submittedBy: args.submittedAt ? creator : null,
        meritScore: args.meritScore ?? null,
        meritRank: args.meritRank ?? null,
        enrolledStudentId: args.enrolledStudentId ?? null,
        feePaidAt: args.feePaidAt ? demoDate(args.feePaidAt) : null,
        feeReceiptNumber: args.feeReceiptNumber ?? null,
        rejectedReason: args.rejectedReason ?? null,
        createdBy: creator,
      },
    });
    applicationCount += 1;
    return row;
  };

  for (const [index, application] of openApplications.entries()) {
    await upsertApplication({
      key: application.key,
      applicationNumber: `ADM-2026-${String(index + 101).padStart(6, '0')}`,
      sessionId: openSessionId,
      programKey: application.programKey,
      name: application.name,
      status: application.status,
      submittedAt: application.submittedAt,
      email: `applicant.${index + 1}@example.com`,
      phone: `+9188${String(60_000_000 + index * 5387).slice(0, 8)}`,
      enquiryId: id(`enquiry/${enquiries[application.enquiryIndex]?.key ?? 'enquiry-1'}`),
    });
  }

  // ------------------------------------------------------------------ 2026 intake (closed)
  const closedApplicants = [
    { programKey: 'btechCse', name: 'Aarav Sharma', status: 'ENROLLED' as const, studentIndex: 0 },
    { programKey: 'btechCse', name: 'Ananya Patel', status: 'ENROLLED' as const, studentIndex: 2 },
    { programKey: 'btechEce', name: 'Vivaan Iyer', status: 'ENROLLED' as const, studentIndex: 1 },
    { programKey: 'bba', name: 'Diya Deshmukh', status: 'ENROLLED' as const, studentIndex: 3 },
    { programKey: 'btechMe', name: 'Aditya Kulkarni', status: 'FEE_PAID' as const, studentIndex: null },
    { programKey: 'mca', name: 'Ishita Reddy', status: 'WAITLISTED' as const, studentIndex: null },
    { programKey: 'btechCse', name: 'Arjun Nair', status: 'REJECTED' as const, studentIndex: null },
    { programKey: 'bba', name: 'Saanvi Joshi', status: 'REJECTED' as const, studentIndex: null },
  ];

  const enrolledStudents = people.students;
  for (const [index, applicant] of closedApplicants.entries()) {
    const linkedStudent =
      applicant.studentIndex !== null ? enrolledStudents[applicant.studentIndex] : undefined;
    const application = await upsertApplication({
      key: `ca-${index + 1}`,
      applicationNumber: `ADM-2026-${String(index + 1).padStart(6, '0')}`,
      sessionId: closedSessionId,
      programKey: applicant.programKey,
      name: applicant.name,
      status: applicant.status,
      submittedAt: `2026-0${(index % 5) + 2}-1${index % 9}`,
      email: `applicant.closed.${index + 1}@example.com`,
      phone: `+9187${String(70_000_000 + index * 6151).slice(0, 8)}`,
      meritScore: spread(index, 5, 55, 96),
      meritRank: index + 1,
      enrolledStudentId: linkedStudent?.id ?? null,
      feePaidAt: applicant.status === 'ENROLLED' || applicant.status === 'FEE_PAID' ? `2026-07-1${(index % 9)}` : null,
      feeReceiptNumber: applicant.status === 'ENROLLED' || applicant.status === 'FEE_PAID' ? `RCP-2026-00010${index + 1}` : null,
      rejectedReason: applicant.status === 'REJECTED' ? 'Merit below the qualifying cut-off for the programme' : null,
    });

    // Documents + qualifications for the closed-intake applications.
    await prisma.admissionDocument.upsert({
      where: { id: id(`document/${applicant.name}/xii`) },
      update: { status: 'VERIFIED' },
      create: {
        id: id(`document/${applicant.name}/xii`),
        tenantId,
        applicationId: application.id,
        category: 'ACADEMIC',
        documentName: 'Class XII marksheet',
        status: 'VERIFIED',
        verifiedAt: demoDate('2026-06-15'),
        verifiedBy: creator,
        uploadedBy: creator,
      },
    });
    await prisma.admissionQualification.upsert({
      where: { id: id(`qualification/${applicant.name}`) },
      update: {},
      create: {
        id: id(`qualification/${applicant.name}`),
        tenantId,
        applicationId: application.id,
        institution: 'Modern English School, Pune',
        board: 'CBSE',
        yearOfPassing: 2026,
        percentage: spread(index, 6, 58, 93),
        isHighestQualification: true,
        verificationStatus: 'VERIFIED',
        createdBy: creator,
      },
    });
    await prisma.admissionActivity.upsert({
      where: { id: id(`activity/${applicant.name}/submitted`) },
      update: {},
      create: {
        id: id(`activity/${applicant.name}/submitted`),
        tenantId,
        applicationId: application.id,
        eventType: 'SUBMITTED',
        title: 'Application submitted at the front desk',
        actorUserId: creator,
        occurredAt: demoDate('2026-06-01'),
      },
    });
  }

  // Offers: accepted + issued + expired examples from the closed intake.
  const offerSpecs = [
    { key: 'offer-1', applicationKey: 'ca-1', offerNumber: 'OFF-2026-000001', status: 'ACCEPTED' as const, issued: '2026-06-20', expires: '2026-07-05' },
    { key: 'offer-2', applicationKey: 'ca-5', offerNumber: 'OFF-2026-000002', status: 'ISSUED' as const, issued: '2026-07-01', expires: '2026-07-15' },
    { key: 'offer-3', applicationKey: 'ca-6', offerNumber: 'OFF-2026-000003', status: 'EXPIRED' as const, issued: '2026-06-20', expires: '2026-07-05' },
  ];
  for (const offer of offerSpecs) {
    const applicationId = id(`application/${offer.applicationKey}`);
    await prisma.admissionOffer.upsert({
      where: { tenantId_applicationId: { tenantId, applicationId } },
      update: { status: offer.status, acceptedAt: offer.status === 'ACCEPTED' ? demoDate('2026-07-02') : null },
      create: {
        id: id(`offer/${offer.key}`),
        tenantId,
        applicationId,
        offerNumber: offer.offerNumber,
        admissionFeeCents: 2_500_000,
        issuedAt: demoDate(offer.issued),
        expiresAt: demoDate(offer.expires),
        status: offer.status,
        acceptedAt: offer.status === 'ACCEPTED' ? demoDate('2026-07-02') : null,
        createdBy: creator,
      },
    });
  }

  const receipts = [
    { key: 'receipt-1', applicationKey: 'ca-1', receiptNumber: 'RCP-2026-000101', amount: 2_500_000, method: 'UPI' as const, date: '2026-07-03' },
    { key: 'receipt-2', applicationKey: 'ca-2', receiptNumber: 'RCP-2026-000102', amount: 2_500_000, method: 'CARD' as const, date: '2026-07-04' },
    { key: 'receipt-3', applicationKey: 'ca-3', receiptNumber: 'RCP-2026-000103', amount: 2_500_000, method: 'BANK_TRANSFER' as const, date: '2026-07-05' },
    { key: 'receipt-4', applicationKey: 'ca-4', receiptNumber: 'RCP-2026-000104', amount: 2_500_000, method: 'UPI' as const, date: '2026-07-08' },
    { key: 'receipt-5', applicationKey: 'ca-5', receiptNumber: 'RCP-2026-000105', amount: 2_500_000, method: 'OFFLINE' as const, date: '2026-07-12' },
  ];
  for (const receipt of receipts) {
    await prisma.admissionFeePayment.upsert({
      where: { tenantId_receiptNumber: { tenantId, receiptNumber: receipt.receiptNumber } },
      update: {},
      create: {
        id: id(`fee-payment/${receipt.key}`),
        tenantId,
        applicationId: id(`application/${receipt.applicationKey}`),
        amountCents: receipt.amount,
        currency: 'INR',
        paymentDate: demoDate(receipt.date),
        method: receipt.method,
        status: 'SUCCEEDED',
        referenceNumber: `DEMO-TXN-${receipt.receiptNumber}`,
        receiptNumber: receipt.receiptNumber,
        recordedByUserId: people.staff['accountant']?.userId,
        remarks: 'Admission fee for the 2026-27 intake',
      },
    });
  }

  for (const [index, applicant] of closedApplicants.entries()) {
    await prisma.admissionMessage.upsert({
      where: { id: id(`message/${applicant.name}/offer`) },
      update: {},
      create: {
        id: id(`message/${applicant.name}/offer`),
        tenantId,
        applicationId: id(`application/ca-${index + 1}`),
        subject: 'Admission offer — Sunrise Institute',
        body: `Dear ${applicant.name}, congratulations! Your admission offer for the 2026-27 intake has been issued. Please complete fee payment by the offer expiry date.`,
        channel: index % 2 === 0 ? 'EMAIL' : 'SMS',
        sentBy: people.staff['registrar']?.userId,
        sentAt: demoDateTime(`2026-06-20T10:3${index % 9}`),
      },
    });
  }

  logDemo('admissions', {
    sessions: sessions.length,
    programOffers: PROGRAM_KEYS.length * sessions.length,
    enquiries: enquiries.length,
    applications: applicationCount,
    receipts: receipts.length,
  });

  return { closedSessionId, openSessionId, applicationCount };
}
