/**
 * Demo module 12 — placements: companies with contacts, a completed/ongoing/scheduled drive mix,
 * positions, eligibility evaluation for final-year students, resumes, applications, rounds with
 * results, selections, offers, one joining and the placement outcomes roll-up.
 */
import type { PrismaClient } from '@prisma/client';
import { demoDate, demoDateTime, demoId, logDemo, spread, type DemoContext, type IdMap } from './core';
import { PLACEMENT_COMPANIES } from './names';
import type { SeededPeople, SeededStudent } from './people';

export interface PlacementInput {
  prisma: PrismaClient;
  ctx: DemoContext;
  org: IdMap;
  people: SeededPeople;
}

export async function seedPlacement(input: PlacementInput): Promise<{ drives: number; offers: number; placed: number }> {
  const { prisma, ctx, org, people } = input;
  const { tenantId, creator } = ctx;
  const id = (segment: string) => demoId(`placement/${segment}`);
  const placementOfficerUserId = people.staff['placementOfficer']?.userId;

  // ------------------------------------------------------------------ companies + contacts
  const companyIds: Record<string, string> = {};
  for (const company of PLACEMENT_COMPANIES) {
    const row = await prisma.placementCompany.upsert({
      where: { tenantId_code: { tenantId, code: company.code } },
      update: { name: company.name, industry: company.industry, isActive: true, updatedBy: creator },
      create: {
        id: id(`company/${company.code}`),
        tenantId,
        code: company.code,
        name: company.name,
        companyType: company.companyType,
        industry: company.industry,
        website: company.website,
        headquartersCity: company.city,
        city: company.city,
        state: company.city === 'Mumbai' ? 'Maharashtra' : undefined,
        country: 'India',
        description: `${company.name} recruits through the campus placement programme.`,
        createdBy: creator,
      },
    });
    companyIds[company.code] = row.id;
  }

  const contacts = [
    { key: 'nexora-hr', company: 'NEXORA', name: 'Shruti Kapoor', designation: 'Talent Acquisition Lead', email: 'shruti.kapoor@nexora.example.com', phone: '+919820011001', primary: true },
    { key: 'nexora-tech', company: 'NEXORA', name: 'Chanchal Verma', designation: 'Engineering Manager', email: 'chanchal.verma@nexora.example.com', phone: '+919820011002', primary: false },
    { key: 'blueorbit-hr', company: 'BLUEORBIT', name: 'Rohit Sharma', designation: 'HR Business Partner', email: 'rohit.sharma@blueorbit.example.com', phone: '+919820011003', primary: true },
    { key: 'zenith-hr', company: 'ZENITH', name: 'Neha Jain', designation: 'Campus Hiring Manager', email: 'neha.jain@zenith-consulting.example.com', phone: '+919820011004', primary: true },
    { key: 'cognivue-hr', company: 'COGNIVUE', name: 'Girish Rao', designation: 'Director — Talent', email: 'girish.rao@cognivue.example.com', phone: '+919820011005', primary: true },
  ];
  const contactIds: Record<string, string> = {};
  for (const contact of contacts) {
    const row = await prisma.placementContact.upsert({
      where: { id: id(`contact/${contact.key}`) },
      update: { fullName: contact.name, isPrimary: contact.primary },
      create: {
        id: id(`contact/${contact.key}`),
        tenantId,
        companyId: companyIds[contact.company] as string,
        fullName: contact.name,
        designation: contact.designation,
        email: contact.email,
        phone: contact.phone,
        isPrimary: contact.primary,
        isActive: true,
        createdBy: creator,
      },
    });
    contactIds[contact.key] = row.id;
  }

  // ------------------------------------------------------------------ drives + positions
  const driveSpecs = [
    {
      key: 'nexora',
      code: 'PLA-2026-NEXORA',
      company: 'NEXORA',
      title: 'Nexora Technologies — Software Engineer Hiring',
      status: 'COMPLETED' as const,
      mode: 'ON_CAMPUS' as const,
      driveDate: '2026-09-20',
      deadline: '2026-09-14',
      venue: 'Main Campus — Seminar Hall A-202',
      coordinator: 'nexora-hr',
      rounds: [
        { type: 'APTITUDE_TEST' as const, title: 'Online aptitude test', at: '2026-09-20T09:00', status: 'COMPLETED' as const },
        { type: 'TECHNICAL_INTERVIEW' as const, title: 'Technical interview', at: '2026-09-20T13:00', status: 'COMPLETED' as const },
        { type: 'HR_INTERVIEW' as const, title: 'HR interview', at: '2026-09-21T10:00', status: 'COMPLETED' as const },
      ],
      positions: [
        { key: 'sde', title: 'Software Engineer (SDE-1)', type: 'FULL_TIME' as const, openings: 4, packageCents: 65_000_000, location: 'Bengaluru', minCgpa: 7.0, minPercentage: 70, maxBacklogs: 0 },
      ],
      applicationCount: 8,
    },
    {
      key: 'blueorbit',
      code: 'PLA-2026-BLUEORBIT',
      company: 'BLUEORBIT',
      title: 'BlueOrbit Analytics — Data Analyst Hiring',
      status: 'ONGOING' as const,
      mode: 'VIRTUAL' as const,
      driveDate: '2026-10-12',
      deadline: '2026-10-08',
      venue: 'Online — MS Teams',
      coordinator: 'blueorbit-hr',
      rounds: [
        { type: 'APTITUDE_TEST' as const, title: 'Aptitude + SQL screening', at: '2026-10-10T10:00', status: 'COMPLETED' as const },
        { type: 'TECHNICAL_INTERVIEW' as const, title: 'Technical interview', at: '2026-10-12T10:00', status: 'SCHEDULED' as const },
        { type: 'HR_INTERVIEW' as const, title: 'HR discussion', at: '2026-10-12T15:00', status: 'SCHEDULED' as const },
      ],
      positions: [
        { key: 'da', title: 'Data Analyst', type: 'FULL_TIME' as const, openings: 3, packageCents: 55_000_000, location: 'Pune', minCgpa: 6.5, minPercentage: 65, maxBacklogs: 1 },
      ],
      applicationCount: 6,
    },
    {
      key: 'zenith',
      code: 'PLA-2026-ZENITH',
      company: 'ZENITH',
      title: 'Zenith Consulting — Summer Internship 2027',
      status: 'SCHEDULED' as const,
      mode: 'OFF_CAMPUS' as const,
      driveDate: '2026-11-05',
      deadline: '2026-10-28',
      venue: 'Zenith Office, BKC Mumbai',
      coordinator: 'zenith-hr',
      rounds: [
        { type: 'CASE_STUDY' as const, title: 'Case study round', at: '2026-11-05T09:30', status: 'SCHEDULED' as const },
        { type: 'HR_INTERVIEW' as const, title: 'Partner interview', at: '2026-11-05T14:00', status: 'SCHEDULED' as const },
      ],
      positions: [
        { key: 'intern', title: 'Management Intern (2 months)', type: 'INTERNSHIP' as const, openings: 5, packageCents: 12_000_000, location: 'Mumbai', minCgpa: 6.0, minPercentage: 60, maxBacklogs: 2 },
      ],
      applicationCount: 0,
    },
  ];

  const finalYearStudents = people.students.filter((student) => student.cohortYear === '2023');
  const driveIds: Record<string, string> = {};
  const positionIds: Record<string, string> = {};
  const roundIds: Record<string, string[]> = {};
  let offersIssued = 0;
  let placed = 0;

  for (const drive of driveSpecs) {
    const row = await prisma.placementDrive.upsert({
      where: { tenantId_code: { tenantId, code: drive.code } },
      update: { status: drive.status, title: drive.title, updatedBy: creator },
      create: {
        id: id(`drive/${drive.key}`),
        tenantId,
        companyId: companyIds[drive.company] as string,
        code: drive.code,
        title: drive.title,
        description: `${drive.title} organised by the Training & Placement Cell.`,
        mode: drive.mode,
        status: drive.status,
        driveDate: demoDate(drive.driveDate),
        applicationDeadline: demoDate(drive.deadline),
        venue: drive.venue,
        coordinatorContactId: contactIds[drive.coordinator],
        eligibilityNotes: 'Eligibility evaluated from the latest registered academic record.',
        createdBy: creator,
      },
    });
    driveIds[drive.key] = row.id;

    roundIds[drive.key] = [];
    for (const [index, round] of drive.rounds.entries()) {
      const roundRow = await prisma.placementRound.upsert({
        where: { tenantId_driveId_sequence: { tenantId, driveId: row.id, sequence: index + 1 } },
        update: { status: round.status },
        create: {
          id: id(`round/${drive.key}/${index + 1}`),
          tenantId,
          driveId: row.id,
          sequence: index + 1,
          roundType: round.type,
          title: round.title,
          scheduledAt: demoDateTime(round.at),
          locationOrLink: round.type === 'APTITUDE_TEST' && drive.mode === 'VIRTUAL' ? 'https://meet.example.com/demo' : drive.venue,
          status: round.status,
          createdBy: creator,
        },
      });
      roundIds[drive.key]?.push(roundRow.id);
    }

    for (const position of drive.positions) {
      const positionRow = await prisma.placementPosition.upsert({
        where: { id: id(`position/${drive.key}/${position.key}`) },
        update: { openings: position.openings, packageCents: position.packageCents, isActive: true },
        create: {
          id: id(`position/${drive.key}/${position.key}`),
          tenantId,
          driveId: row.id,
          title: position.title,
          positionType: position.type,
          location: position.location,
          openings: position.openings,
          description: `${position.title} at ${drive.company}.`,
          minCgpa: position.minCgpa,
          minPercentage: position.minPercentage,
          maxBacklogs: position.maxBacklogs,
          packageCents: position.packageCents,
          packageNotes: `INR ${(position.packageCents / 100 / 100000).toFixed(1)} LPA (CTC)`,
          createdBy: creator,
        },
      });
      positionIds[`${drive.key}/${position.key}`] = positionRow.id;

      // Eligibility evaluation for every final-year student on each open drive.
      for (const [studentIndex, student] of finalYearStudents.entries()) {
        const eligible = studentIndex % 5 !== 4;
        await prisma.placementEligibility.upsert({
          where: {
            tenantId_driveId_positionId_studentId: {
              tenantId,
              driveId: row.id,
              positionId: positionRow.id,
              studentId: student.id,
            },
          },
          update: { status: drive.status === 'SCHEDULED' ? 'PENDING' : eligible ? 'ELIGIBLE' : 'NOT_ELIGIBLE' },
          create: {
            id: id(`eligibility/${drive.key}/${position.key}/${student.admissionNumber}`),
            tenantId,
            driveId: row.id,
            positionId: positionRow.id,
            studentId: student.id,
            status: drive.status === 'SCHEDULED' ? 'PENDING' : eligible ? 'ELIGIBLE' : 'NOT_ELIGIBLE',
            criteriaSnapshot: { minCgpa: position.minCgpa, minPercentage: position.minPercentage, maxBacklogs: position.maxBacklogs },
            studentSnapshot: {
              admissionNumber: student.admissionNumber,
              programme: student.programKey,
              cgpa: Math.round((6 + (studentIndex % 40) / 10) * 100) / 100,
            },
            evaluatedByUserId: placementOfficerUserId,
            evaluatedAt: demoDate(drive.deadline),
            createdBy: creator,
          },
        });
      }

      // Resumes for final-year students (one primary per student).
      for (const student of finalYearStudents) {
        await prisma.placementResume.upsert({
          where: { id: id(`resume/${student.admissionNumber}`) },
          update: { isPrimary: true },
          create: {
            id: id(`resume/${student.admissionNumber}`),
            tenantId,
            studentId: student.id,
            title: `${student.fullName} — Resume 2026`,
            fileKey: `demo/placements/resumes/${student.admissionNumber.toLowerCase()}.pdf`,
            contentType: 'application/pdf',
            sizeBytes: 180_000 + studentIndexSize(student),
            isPrimary: true,
            uploadedByUserId: student.userId,
            createdBy: creator,
          },
        });
      }
      void studentIndexSize;

      // Applications for the drive.
      const applicants: SeededStudent[] = finalYearStudents.slice(0, drive.applicationCount);
      const applications: Array<{ student: SeededStudent; applicationId: string; applicationIndex: number }> = [];
      for (const [applicationIndex, student] of applicants.entries()) {
        const status =
          drive.key === 'nexora'
            ? applicationIndex < 3
              ? 'SHORTLISTED'
              : applicationIndex === 3
                ? 'REJECTED'
                : 'APPLIED'
            : 'APPLIED';
        const applicationRow = await prisma.placementApplication.upsert({
          where: {
            tenantId_driveId_positionId_studentId: {
              tenantId,
              driveId: row.id,
              positionId: positionRow.id,
              studentId: student.id,
            },
          },
          update: { status: status as 'APPLIED' | 'SHORTLISTED' | 'REJECTED', shortlistedAt: status === 'SHORTLISTED' ? demoDate('2026-09-18') : null },
          create: {
            id: id(`application/${drive.key}/${student.admissionNumber}`),
            tenantId,
            driveId: row.id,
            positionId: positionRow.id,
            studentId: student.id,
            resumeId: id(`resume/${student.admissionNumber}`),
            status: status as 'APPLIED' | 'SHORTLISTED' | 'REJECTED',
            appliedAt: demoDate(drive.deadline),
            shortlistedAt: status === 'SHORTLISTED' ? demoDate('2026-09-18') : null,
            rejectedAt: status === 'REJECTED' ? demoDate('2026-09-19') : null,
            createdBy: creator,
          },
        });
        applications.push({ student, applicationId: applicationRow.id, applicationIndex });

        // Round results for completed rounds.
        for (const [roundIndex, roundId] of (roundIds[drive.key] ?? []).entries()) {
          const round = drive.rounds[roundIndex];
          const completed = round?.status === 'COMPLETED';
          const result = !completed
            ? 'PENDING'
            : status === 'REJECTED'
              ? 'REJECTED'
              : applicationIndex < 3
                ? 'SELECTED'
                : 'ON_HOLD';
          await prisma.placementRoundResult.upsert({
            where: {
              tenantId_roundId_applicationId: { tenantId, roundId, applicationId: applicationRow.id },
            },
            update: { result: result as 'PENDING' | 'SELECTED' | 'REJECTED' | 'ON_HOLD' },
            create: {
              id: id(`round-result/${drive.key}/${roundIndex + 1}/${student.admissionNumber}`),
              tenantId,
              roundId,
              applicationId: applicationRow.id,
              result: result as 'PENDING' | 'SELECTED' | 'REJECTED' | 'ON_HOLD',
              score: completed ? spread(applicationIndex + 1, roundIndex + 1, 55, 95) : null,
              feedback: completed ? 'Evaluated by the interview panel.' : null,
              assessedByUserId: placementOfficerUserId,
              assessedAt: completed ? demoDate('2026-09-21') : null,
              createdBy: creator,
            },
          });
        }
      }

      // Selections + offers for the completed drive.
      if (drive.key === 'nexora') {
        for (const application of applications.slice(0, 3)) {
          const selection = await prisma.placementSelection.upsert({
            where: { tenantId_applicationId: { tenantId, applicationId: application.applicationId } },
            update: {},
            create: {
              id: id(`selection/${application.student.admissionNumber}`),
              tenantId,
              driveId: row.id,
              positionId: positionRow.id,
              applicationId: application.applicationId,
              studentId: application.student.id,
              selectedByUserId: placementOfficerUserId,
              selectedAt: demoDate('2026-09-22'),
              notes: 'Selected after the HR round',
              createdBy: creator,
            },
          });

          const offerStatus = application.applicationIndex === 0 ? 'ACCEPTED' : application.applicationIndex === 1 ? 'ISSUED' : 'DECLINED';
          const offer = await prisma.placementOffer.upsert({
            where: { applicationId: application.applicationId },
            update: { status: offerStatus as 'ISSUED' | 'ACCEPTED' | 'DECLINED' },
            create: {
              id: id(`offer/${application.student.admissionNumber}`),
              tenantId,
              driveId: row.id,
              positionId: positionRow.id,
              applicationId: application.applicationId,
              selectionId: selection.id,
              studentId: application.student.id,
              offerLetterNumber: `PLO-2026-${String(offersIssued + 1).padStart(4, '0')}`,
              packageCents: position.packageCents,
              joiningLocation: position.location,
              status: offerStatus as 'ISSUED' | 'ACCEPTED' | 'DECLINED',
              issuedAt: demoDate('2026-09-25'),
              acceptedAt: offerStatus === 'ACCEPTED' ? demoDate('2026-09-28') : null,
              declinedAt: offerStatus === 'DECLINED' ? demoDate('2026-09-30') : null,
              expiryDate: demoDate('2026-10-05'),
              notes: `Offer for ${position.title}`,
              createdBy: creator,
            },
          });
          offersIssued += 1;

          if (offerStatus === 'ACCEPTED') {
            await prisma.placementJoining.upsert({
              where: { offerId: offer.id },
              update: { status: 'JOINED' },
              create: {
                id: id(`joining/${application.student.admissionNumber}`),
                tenantId,
                driveId: row.id,
                offerId: offer.id,
                expectedJoiningDate: demoDate('2027-07-01'),
                actualJoiningDate: demoDate('2027-07-01'),
                joiningLocation: position.location,
                status: 'JOINED',
                remarks: 'Joined after graduation',
                createdBy: creator,
              },
            });
          }
        }
      }
    }
  }

  // ------------------------------------------------------------------ outcomes roll-up (2026-27)
  for (const [studentIndex, student] of finalYearStudents.entries()) {
    const offerKeyMap: Record<number, { driveKey: string; positionKey: string; status: 'PLACED' | 'NOT_PLACED' | 'OPTED_OUT' | 'UNREGISTERED'; offer: boolean }> = {
      0: { driveKey: 'nexora', positionKey: 'sde', status: 'PLACED', offer: true },
      1: { driveKey: 'nexora', positionKey: 'sde', status: 'PLACED', offer: true },
      2: { driveKey: 'nexora', positionKey: 'sde', status: 'PLACED', offer: true },
      9: { driveKey: 'zenith', positionKey: 'intern', status: 'OPTED_OUT', offer: false },
      8: { driveKey: 'zenith', positionKey: 'intern', status: 'UNREGISTERED', offer: false },
    };
    const outcome = offerKeyMap[studentIndex] ?? { driveKey: 'blueorbit', positionKey: 'da', status: 'NOT_PLACED' as const, offer: false };
    const isPlaced = outcome.status === 'PLACED';
    await prisma.placementOutcome.upsert({
      where: {
        tenantId_academicYearId_studentId: {
          tenantId,
          academicYearId: org['yearCurrent'] as string,
          studentId: student.id,
        },
      },
      update: { outcomeStatus: outcome.status },
      create: {
        id: id(`outcome/${student.admissionNumber}`),
        tenantId,
        academicYearId: org['yearCurrent'] as string,
        studentId: student.id,
        driveId: outcome.status === 'UNREGISTERED' ? null : driveIds[outcome.driveKey],
        positionId: outcome.status === 'UNREGISTERED' ? null : positionIds[`${outcome.driveKey}/${outcome.positionKey}`],
        offerId: outcome.offer ? id(`offer/${student.admissionNumber}`) : null,
        outcomeStatus: outcome.status,
        finalPackageCents: isPlaced ? 65_000_000 : null,
        placedAt: isPlaced ? demoDate('2026-09-28') : null,
        declaredByUserId: placementOfficerUserId,
        remarks: isPlaced ? 'Offer accepted' : outcome.status === 'NOT_PLACED' ? 'Still participating in ongoing drives' : null,
        createdBy: creator,
      },
    });
    if (isPlaced) placed += 1;
  }

  logDemo('placement', {
    companies: PLACEMENT_COMPANIES.length,
    drives: driveSpecs.length,
    offers: offersIssued,
    placed,
  });

  return { drives: driveSpecs.length, offers: offersIssued, placed };
}

/** Small deterministic resume size helper (kept outside the loop for lint clarity). */
function studentIndexSize(student: { admissionNumber: string }): number {
  return Number(student.admissionNumber.slice(-2)) * 137;
}
