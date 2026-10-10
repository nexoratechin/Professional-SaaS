/**
 * Demo module 08 — examinations & results: grading scheme, a completed and fully published
 * end-term session (marks, component marks, hall tickets, seating, invigilation, result
 * calculations/processes/history and published StudentResults) plus in-flight sessions for the
 * current term (registrations + issued hall tickets still pending marks).
 */
import type { PrismaClient } from '@prisma/client';
import { demoDate, demoDateTime, demoId, logDemo, spread, type DemoContext, type IdMap } from './core';
import type { SeededPeople, SeededStudent } from './people';
import type { SeededAcademics } from './academics';

export interface ExamsInput {
  prisma: PrismaClient;
  ctx: DemoContext;
  org: IdMap;
  people: SeededPeople;
  academics: SeededAcademics;
}

const GRADE_BANDS: Array<{ grade: string; point: number; minPercent: number }> = [
  { grade: 'O', point: 10, minPercent: 90 },
  { grade: 'A+', point: 9, minPercent: 80 },
  { grade: 'A', point: 8, minPercent: 70 },
  { grade: 'B+', point: 7, minPercent: 60 },
  { grade: 'B', point: 6, minPercent: 50 },
  { grade: 'C', point: 5, minPercent: 40 },
  { grade: 'F', point: 0, minPercent: 0 },
];

function gradeFor(percentage: number): { grade: string; point: number; outcome: 'PASS' | 'FAIL' } {
  const band = GRADE_BANDS.find((candidate) => percentage >= candidate.minPercent) ?? GRADE_BANDS[GRADE_BANDS.length - 1];
  if (!band || band.grade === 'F') {
    return { grade: 'F', point: 0, outcome: 'FAIL' };
  }
  return { grade: band.grade, point: band.point, outcome: 'PASS' };
}

interface SubjectSpec {
  courseCode: string;
  examDate: string;
  startTime: string;
}

export async function seedExams(input: ExamsInput): Promise<{ publishedResults: number }> {
  const { prisma, ctx, org, people, academics } = input;
  const { tenantId, creator } = ctx;
  const id = (segment: string) => demoId(`exams/${segment}`);

  // ------------------------------------------------------------------ grading scheme
  const scheme = await prisma.gradingScheme.upsert({
    where: { tenantId_code: { tenantId, code: 'SCH-PCT-10' } },
    update: { isDefault: true, isActive: true, updatedBy: creator },
    create: {
      id: id('scheme/pct10'),
      tenantId,
      code: 'SCH-PCT-10',
      name: 'Percentage to 10-point scale',
      description: 'Standard 10-point grading for UG/PG programmes (O to F)',
      passMode: 'PERCENTAGE',
      minPassPercent: 40,
      weightingMode: 'CREDIT_WEIGHTED',
      gpaMax: 10,
      graceEnabled: true,
      maxGraceMarks: 5,
      graceToPassDiff: 5,
      roundingDecimals: 2,
      isDefault: true,
      createdBy: creator,
    },
  });
  for (const band of GRADE_BANDS) {
    const maxPercent = band.grade === 'O' ? 100 : GRADE_BANDS[GRADE_BANDS.indexOf(band) - 1]?.minPercent ?? 100;
    const minPercent = band.minPercent;
    await prisma.gradeScale.upsert({
      where: { tenantId_schemeId_grade: { tenantId, schemeId: scheme.id, grade: band.grade } },
      update: { minPercent, maxPercent, gradePoint: band.point },
      create: {
        id: id(`grade-scale/${band.grade}`),
        tenantId,
        schemeId: scheme.id,
        grade: band.grade,
        minPercent,
        maxPercent,
        gradePoint: band.point,
        gradeDescription:
          band.grade === 'O' ? 'Outstanding' : band.grade === 'F' ? 'Fail — must reappear' : undefined,
        createdBy: creator,
      },
    });
  }

  // ------------------------------------------------------------------ published session (Even 2025-26, CSE 2025 cohort)
  const cseStudents = people.students.filter((student) => student.programKey === 'BTECH-CSE' && student.cohortYear === '2025');
  const publishedSession = await prisma.examSession.upsert({
    where: { tenantId_code: { tenantId, code: 'ESE-2526-CSE' } },
    update: { status: 'COMPLETED' },
    create: {
      id: id('session/ese-2526-cse'),
      tenantId,
      name: 'Even Semester 2025-26 End-Term — B.Tech CSE',
      code: 'ESE-2526-CSE',
      programId: org['btechCse'] as string,
      academicYearId: org['yearPrevious'] as string,
      termId: org['termEvenPrevious'] as string,
      examType: 'END_TERM',
      status: 'COMPLETED',
      startDate: demoDate('2026-05-04'),
      endDate: demoDate('2026-05-21'),
      resultDeclarationDate: demoDate('2026-08-20'),
      eligibilityPolicy: 'MINIMUM_ATTENDANCE_75',
      gradingSchemeId: scheme.id,
      resultPublishedAt: demoDateTime('2026-08-20T11:00'),
      resultPublishedBy: people.staff['examController']?.userId,
      createdBy: creator,
    },
  });

  await prisma.examEligibilityRule.upsert({
    where: { tenantId_sessionId_ruleType: { tenantId, sessionId: publishedSession.id, ruleType: 'MINIMUM_ATTENDANCE' } },
    update: { enabled: true, minAttendancePercent: 75 },
    create: {
      id: id('eligibility/ese-2526-cse/attendance'),
      tenantId,
      sessionId: publishedSession.id,
      ruleType: 'MINIMUM_ATTENDANCE',
      enabled: true,
      minAttendancePercent: 75,
      createdBy: creator,
    },
  });

  const publishedSubjectSpecs: SubjectSpec[] = [
    { courseCode: 'CS101', examDate: '2026-05-05', startTime: '09:30' },
    { courseCode: 'CS201', examDate: '2026-05-08', startTime: '09:30' },
    { courseCode: 'CS301', examDate: '2026-05-12', startTime: '14:00' },
  ];

  const examControllerUserId = people.staff['examController']?.userId;
  const publishedSubjects: Array<{ id: string; courseCode: string; name: string; credits: number }> = [];
  for (const spec of publishedSubjectSpecs) {
    const courseId = academics.courseIds[spec.courseCode] as string;
    const subject = await prisma.examSubject.upsert({
      where: { tenantId_sessionId_courseId: { tenantId, sessionId: publishedSession.id, courseId } },
      update: { status: 'COMPLETED' },
      create: {
        id: id(`subject/ese-2526-cse/${spec.courseCode}`),
        tenantId,
        sessionId: publishedSession.id,
        courseId,
        roomId: org['roomA101'] as string,
        maxMarks: 100,
        passMarks: 40,
        durationMinutes: 180,
        pattern: 'Theory — 100 marks',
        examDate: demoDate(spec.examDate),
        startTime: spec.startTime,
        endTime: spec.startTime === '09:30' ? '12:30' : '17:00',
        status: 'COMPLETED',
        createdBy: creator,
      },
    });
    const courseName = { CS101: 'Programming Fundamentals', CS201: 'Data Structures & Algorithms', CS301: 'Database Management Systems' }[spec.courseCode] ?? spec.courseCode;
    const credits = { CS101: 4, CS201: 4, CS301: 4 }[spec.courseCode] ?? 3;
    publishedSubjects.push({ id: subject.id, courseCode: spec.courseCode, name: courseName, credits });
  }

  // Components: internal (30) + end-term theory (70) for each subject.
  const componentIds: Record<string, { internal: string; external: string }> = {};
  for (const subject of publishedSubjects) {
    const internal = await prisma.assessmentComponent.upsert({
      where: {
        tenantId_sessionId_subjectId_code: {
          tenantId,
          sessionId: publishedSession.id,
          subjectId: subject.id,
          code: 'INT',
        },
      },
      update: { weightage: 30, maxMarks: 30 },
      create: {
        id: id(`component/${subject.courseCode}/internal`),
        tenantId,
        sessionId: publishedSession.id,
        subjectId: subject.id,
        code: 'INT',
        name: 'Continuous Internal Assessment',
        kind: 'INTERNAL',
        weightage: 30,
        maxMarks: 30,
        sortOrder: 0,
        createdBy: creator,
      },
    });
    const external = await prisma.assessmentComponent.upsert({
      where: {
        tenantId_sessionId_subjectId_code: {
          tenantId,
          sessionId: publishedSession.id,
          subjectId: subject.id,
          code: 'EXT',
        },
      },
      update: { weightage: 70, maxMarks: 70 },
      create: {
        id: id(`component/${subject.courseCode}/external`),
        tenantId,
        sessionId: publishedSession.id,
        subjectId: subject.id,
        code: 'EXT',
        name: 'End-Term Theory Paper',
        kind: 'EXTERNAL',
        weightage: 70,
        maxMarks: 70,
        sortOrder: 1,
        createdBy: creator,
      },
    });
    componentIds[subject.courseCode] = { internal: internal.id, external: external.id };
  }

  // Registrations, hall tickets, seating and invigilation.
  const registrations: Array<{ student: SeededStudent; registrationId: string }> = [];
  let ticketSequence = 1;
  for (const [studentIndex, student] of cseStudents.entries()) {
    const registration = await prisma.examRegistration.upsert({
      where: { tenantId_sessionId_studentId: { tenantId, sessionId: publishedSession.id, studentId: student.id } },
      update: { status: 'CONFIRMED' },
      create: {
        id: id(`registration/ese-2526-cse/${student.admissionNumber}`),
        tenantId,
        sessionId: publishedSession.id,
        studentId: student.id,
        status: 'CONFIRMED',
        registeredAt: demoDate('2026-04-10'),
        createdBy: creator,
      },
    });
    registrations.push({ student, registrationId: registration.id });

    const hallTicket = await prisma.examHallTicket.upsert({
      where: { registrationId: registration.id },
      update: { status: 'ISSUED' },
      create: {
        id: id(`hall-ticket/ese-2526-cse/${student.admissionNumber}`),
        tenantId,
        registrationId: registration.id,
        sessionId: publishedSession.id,
        ticketNumber: `HT-2526-${String(ticketSequence).padStart(4, '0')}`,
        status: 'ISSUED',
        issuedAt: demoDate('2026-04-25'),
        issuedBy: examControllerUserId,
      },
    });
    ticketSequence += 1;

    for (const [subjectIndex, subject] of publishedSubjects.entries()) {
      await prisma.examHallTicketSubject.upsert({
        where: {
          tenantId_hallTicketId_subjectId: { tenantId, hallTicketId: hallTicket.id, subjectId: subject.id },
        },
        update: { seatNo: `A-${String(studentIndex * 3 + subjectIndex + 1).padStart(3, '0')}` },
        create: {
          id: id(`hall-ticket-subject/${student.admissionNumber}/${subject.courseCode}`),
          tenantId,
          hallTicketId: hallTicket.id,
          subjectId: subject.id,
          courseCode: subject.courseCode,
          courseName: subject.name,
          maxMarks: 100,
          passMarks: 40,
          examDate: demoDate(publishedSubjectSpecs[subjectIndex]?.examDate ?? '2026-05-05'),
          startTime: publishedSubjectSpecs[subjectIndex]?.startTime ?? '09:30',
          endTime: '12:30',
          roomName: 'A-101',
          seatNo: `A-${String(studentIndex * 3 + subjectIndex + 1).padStart(3, '0')}`,
        },
      });
    }
  }

  const seatingPlan = await prisma.examSeatingPlan.upsert({
    where: { id: id('seating/ese-2526-cse') },
    update: { capacity: 60 },
    create: {
      id: id('seating/ese-2526-cse'),
      tenantId,
      sessionId: publishedSession.id,
      roomId: org['roomA101'] as string,
      label: 'Room A-101 — CSE 2025 end-term',
      capacity: 60,
      createdBy: creator,
    },
  });
  for (const [index, registration] of registrations.entries()) {
    await prisma.examSeatAllocation.upsert({
      where: {
        tenantId_planId_registrationId: {
          tenantId,
          planId: seatingPlan.id,
          registrationId: registration.registrationId,
        },
      },
      update: { status: 'PRESENT' },
      create: {
        id: id(`seat/${registration.student.admissionNumber}`),
        tenantId,
        planId: seatingPlan.id,
        registrationId: registration.registrationId,
        studentId: registration.student.id,
        seatNo: `C-${String(index + 1).padStart(2, '0')}`,
        status: 'PRESENT',
        createdBy: creator,
      },
    });
  }

  const invigilators = [
    { facultyKey: 'fac-cse1', role: 'CHIEF_INVIGILATOR' as const },
    { facultyKey: 'fac-cse2', role: 'INVIGILATOR' as const },
    { facultyKey: 'fac-ece1', role: 'INVIGILATOR' as const },
  ];
  for (const subject of publishedSubjects) {
    for (const invigilator of invigilators) {
      const userId = people.staff[invigilator.facultyKey]?.userId as string;
      await prisma.examInvigilatorAssignment.upsert({
        where: { tenantId_subjectId_userId: { tenantId, subjectId: subject.id, userId } },
        update: { role: invigilator.role },
        create: {
          id: id(`invigilator/${subject.courseCode}/${invigilator.facultyKey}`),
          tenantId,
          subjectId: subject.id,
          userId,
          role: invigilator.role,
          roomId: org['roomA101'] as string,
          assignedAt: demoDate('2026-04-28'),
          createdBy: creator,
        },
      });
    }
  }

  // ------------------------------------------------------------------ marks + results
  let publishedResults = 0;
  let failedStudentRegistration: { registrationId: string; subjectId: string; studentId: string } | null = null;

  for (const [studentIndex, registration] of registrations.entries()) {
    const subjectRows: Array<{
      subjectId: string;
      courseCode: string;
      percentage: number;
      grade: string;
      point: number;
      outcome: 'PASS' | 'FAIL';
      marks: number;
      credits: number;
    }> = [];
    const failEverything = studentIndex === cseStudents.length - 1; // final student fails one subject

    for (const [subjectIndex, subject] of publishedSubjects.entries()) {
      const maxMarks = 100;
      const marks = failEverything && subjectIndex === 1
        ? 32
        : Math.min(97, Math.max(41, spread(studentIndex + 7, subjectIndex + 3, 38, 95)));
      const percentage = Math.round((marks / maxMarks) * 10000) / 100;
      const { grade, point, outcome } = gradeFor(percentage);

      // Internal component marks (out of 30) — roughly 60% of the total scaled to 30.
      const internalMarks = Math.min(30, Math.round((marks * 0.3 * 0.95 + 2) * 10) / 10);
      const internalComponent = componentIds[subject.courseCode]?.internal as string;
      await prisma.examComponentMark.upsert({
        where: {
          tenantId_registrationId_subjectId_componentId: {
            tenantId,
            registrationId: registration.registrationId,
            subjectId: subject.id,
            componentId: internalComponent,
          },
        },
        update: { marksObtained: internalMarks },
        create: {
          id: id(`component-mark/${registration.student.admissionNumber}/${subject.courseCode}`),
          tenantId,
          registrationId: registration.registrationId,
          subjectId: subject.id,
          componentId: internalComponent,
          studentId: registration.student.id,
          marksObtained: internalMarks,
          createdBy: creator,
        },
      });

      const marksEntry = await prisma.examMarksEntry.upsert({
        where: {
          tenantId_registrationId_subjectId: {
            tenantId,
            registrationId: registration.registrationId,
            subjectId: subject.id,
          },
        },
        update: { marksObtained: marks, status: 'APPROVED' },
        create: {
          id: id(`marks/${registration.student.admissionNumber}/${subject.courseCode}`),
          tenantId,
          registrationId: registration.registrationId,
          subjectId: subject.id,
          studentId: registration.student.id,
          marksObtained: marks,
          attendanceStatus: 'PRESENT',
          status: 'APPROVED',
          moderatedBy: people.staff['fac-cse1']?.userId,
          moderatedAt: demoDateTime('2026-05-30T15:00'),
          approvedBy: examControllerUserId,
          approvedAt: demoDateTime('2026-06-05T11:00'),
          createdBy: creator,
        },
      });

      await prisma.resultCalculation.upsert({
        where: {
          tenantId_sessionId_studentId_subjectId: {
            tenantId,
            sessionId: publishedSession.id,
            studentId: registration.student.id,
            subjectId: subject.id,
          },
        },
        update: {
          rawMarks: marks,
          effectiveMarks: marks,
          percentage,
          grade,
          gradePoint: point,
          outcome,
          calculatedAt: demoDateTime('2026-08-15T10:00'),
        },
        create: {
          id: id(`calculation/${registration.student.admissionNumber}/${subject.courseCode}`),
          tenantId,
          sessionId: publishedSession.id,
          studentId: registration.student.id,
          registrationId: registration.registrationId,
          subjectId: subject.id,
          marksEntryId: marksEntry.id,
          rawMarks: marks,
          graceApplied: 0,
          effectiveMarks: marks,
          maxMarks,
          passMarks: 40,
          percentage,
          grade,
          gradePoint: point,
          outcome,
          componentJson: { internal: internalMarks, external: Math.max(0, marks - internalMarks) },
          calculatedAt: demoDateTime('2026-08-15T10:00'),
          calculatedBy: examControllerUserId,
          createdBy: creator,
        },
      });

      subjectRows.push({
        subjectId: subject.id,
        courseCode: subject.courseCode,
        percentage,
        grade,
        point,
        outcome,
        marks,
        credits: subject.credits,
      });

      if (outcome === 'FAIL' && !failedStudentRegistration) {
        failedStudentRegistration = {
          registrationId: registration.registrationId,
          subjectId: subject.id,
          studentId: registration.student.id,
        };
      }
    }

    const totalMaxMarks = subjectRows.length * 100;
    const totalMarks = subjectRows.reduce((sum, row) => sum + row.marks, 0);
    const aggregatePercent = Math.round((totalMarks / totalMaxMarks) * 10000) / 100;
    const creditsAttempted = subjectRows.reduce((sum, row) => sum + row.credits, 0);
    const creditsEarned = subjectRows.reduce(
      (sum, row) => sum + (row.outcome === 'PASS' ? row.credits : 0),
      0,
    );
    const passedCount = subjectRows.filter((row) => row.outcome === 'PASS').length;
    const failedCount = subjectRows.length - passedCount;
    const gpa = Math.round((subjectRows.reduce((sum, row) => sum + row.point, 0) / subjectRows.length) * 100) / 100;
    const standing = failedCount === 0 ? 'PASSED' : 'SUPPLEMENTARY';

    const process = await prisma.resultProcess.upsert({
      where: {
        tenantId_sessionId_studentId: { tenantId, sessionId: publishedSession.id, studentId: registration.student.id },
      },
      update: {
        state: 'PUBLISHED',
        standing,
        gpa,
        aggregatePercent,
        publishedAt: demoDateTime('2026-08-20T11:00'),
      },
      create: {
        id: id(`process/${registration.student.admissionNumber}`),
        tenantId,
        sessionId: publishedSession.id,
        studentId: registration.student.id,
        state: 'PUBLISHED',
        standing,
        subjectCount: subjectRows.length,
        passedCount,
        failedCount,
        totalRawMarks: totalMarks,
        totalGraceMarks: 0,
        totalEffectiveMarks: totalMarks,
        totalMaxMarks,
        aggregatePercent,
        creditsAttempted,
        creditsEarned,
        gpa,
        cgpa: gpa,
        calculationVersion: 1,
        calculatedAt: demoDateTime('2026-08-15T10:00'),
        calculatedBy: examControllerUserId,
        approvedAt: demoDateTime('2026-08-18T09:30'),
        approvedBy: people.staff['principal']?.userId,
        publishedAt: demoDateTime('2026-08-20T11:00'),
        publishedBy: examControllerUserId,
        createdBy: creator,
      },
    });

    // Re-point calculations at this process.
    await prisma.resultCalculation.updateMany({
      where: { tenantId, sessionId: publishedSession.id, studentId: registration.student.id },
      data: { processId: process.id },
    });

    const historyEvents = [
      { key: 'calculated', event: 'CALCULATED', toState: 'CALCULATED' as const, at: '2026-08-15T10:00' },
      { key: 'approved', event: 'APPROVED', toState: 'APPROVED' as const, at: '2026-08-18T09:30' },
      { key: 'published', event: 'PUBLISHED', toState: 'PUBLISHED' as const, at: '2026-08-20T11:00' },
    ];
    for (const history of historyEvents) {
      await prisma.resultHistory.upsert({
        where: { id: id(`result-history/${registration.student.admissionNumber}/${history.key}`) },
        update: { toState: history.toState },
        create: {
          id: id(`result-history/${registration.student.admissionNumber}/${history.key}`),
          tenantId,
          sessionId: publishedSession.id,
          processId: process.id,
          studentId: registration.student.id,
          event: history.event,
          toState: history.toState,
          actorUserId: examControllerUserId,
          details: { note: `${history.event} by demo seed` },
        },
      });
    }

    const studentExam = await prisma.studentExam.upsert({
      where: {
        tenantId_studentId_sessionId: {
          tenantId,
          studentId: registration.student.id,
          sessionId: publishedSession.id,
        },
      },
      update: { status: 'COMPLETED' },
      create: {
        id: id(`student-exam/${registration.student.admissionNumber}`),
        tenantId,
        studentId: registration.student.id,
        name: 'Even Semester 2025-26 End-Term',
        examType: 'END_TERM',
        termId: org['termEvenPrevious'] as string,
        programId: org['btechCse'] as string,
        sectionId: registration.student.sectionId,
        startDate: demoDate('2026-05-04'),
        endDate: demoDate('2026-05-21'),
        status: 'COMPLETED',
        sessionId: publishedSession.id,
        createdBy: creator,
      },
    });

    for (const [subjectIndex, subject] of publishedSubjects.entries()) {
      const row = subjectRows[subjectIndex];
      if (!row) continue;
      const calculationId = id(`calculation/${registration.student.admissionNumber}/${subject.courseCode}`);
      await prisma.studentResult.upsert({
        where: { id: id(`result/${registration.student.admissionNumber}/${subject.courseCode}`) },
        update: {
          obtainedMarks: row.marks,
          grade: row.grade,
          gradePoint: row.point,
          percentage: row.percentage,
          outcome: row.outcome,
          publishedAt: demoDateTime('2026-08-20T11:00'),
          resultCalculationId: calculationId,
        },
        create: {
          id: id(`result/${registration.student.admissionNumber}/${subject.courseCode}`),
          tenantId,
          studentId: registration.student.id,
          examId: studentExam.id,
          subjectCode: row.courseCode,
          subjectName: subject.name,
          maxMarks: 100,
          obtainedMarks: row.marks,
          grade: row.grade,
          gradePoint: row.point,
          percentage: row.percentage,
          graceApplied: 0,
          outcome: row.outcome,
          publishedAt: demoDateTime('2026-08-20T11:00'),
          publishedBy: examControllerUserId,
          createdBy: creator,
          resultCalculationId: calculationId,
        },
      });
      publishedResults += 1;
    }
  }

  // One resolved revaluation request against the failed paper.
  if (failedStudentRegistration) {
    await prisma.examRevaluationRequest.upsert({
      where: {
        tenantId_registrationId_subjectId: {
          tenantId,
          registrationId: failedStudentRegistration.registrationId,
          subjectId: failedStudentRegistration.subjectId,
        },
      },
      update: { status: 'REJECTED' },
      create: {
        id: id('revaluation/1'),
        tenantId,
        registrationId: failedStudentRegistration.registrationId,
        subjectId: failedStudentRegistration.subjectId,
        marksEntryId: id(
          `marks/${cseStudents[cseStudents.length - 1]?.admissionNumber}/${publishedSubjects[1]?.courseCode}`,
        ),
        reason: 'Candidate believes the practical section was under-marked',
        requestedBy: failedStudentRegistration.studentId,
        status: 'REJECTED',
        resolvedBy: examControllerUserId,
        resolvedAt: demoDateTime('2026-09-02T12:00'),
        remark: 'Revaluation complete — marks unchanged',
        createdBy: creator,
      },
    });
  }

  // ------------------------------------------------------------------ in-flight sessions (Odd 2026-27)
  const currentSessions: Array<{
    code: string;
    name: string;
    programKey: string;
    studentProgramKey: string;
    cohortYear: '2023' | '2025';
    subjects: SubjectSpec[];
    issueTickets: boolean;
  }> = [
    {
      code: 'ESE-2627-CSE-S3',
      name: 'Odd Semester 2026-27 End-Term — B.Tech CSE (Sem 3)',
      programKey: 'btechCse',
      studentProgramKey: 'BTECH-CSE',
      cohortYear: '2025',
      subjects: [
        { courseCode: 'CS201', examDate: '2026-12-02', startTime: '09:30' },
        { courseCode: 'CS301', examDate: '2026-12-05', startTime: '09:30' },
      ],
      issueTickets: true,
    },
    {
      code: 'ESE-2627-CSE-S7',
      name: 'Odd Semester 2026-27 End-Term — B.Tech CSE (Sem 7)',
      programKey: 'btechCse',
      studentProgramKey: 'BTECH-CSE',
      cohortYear: '2023',
      subjects: [
        { courseCode: 'CS501', examDate: '2026-12-07', startTime: '09:30' },
        { courseCode: 'CS601', examDate: '2026-12-10', startTime: '14:00' },
      ],
      issueTickets: false,
    },
    {
      code: 'ESE-2627-ECE-S3',
      name: 'Odd Semester 2026-27 End-Term — B.Tech ECE (Sem 3)',
      programKey: 'btechEce',
      studentProgramKey: 'BTECH-ECE',
      cohortYear: '2025',
      subjects: [
        { courseCode: 'EC201', examDate: '2026-12-02', startTime: '14:00' },
        { courseCode: 'EC301', examDate: '2026-12-05', startTime: '14:00' },
      ],
      issueTickets: true,
    },
  ];

  for (const spec of currentSessions) {
    const session = await prisma.examSession.upsert({
      where: { tenantId_code: { tenantId, code: spec.code } },
      update: { status: 'SCHEDULED' },
      create: {
        id: id(`session/${spec.code}`),
        tenantId,
        name: spec.name,
        code: spec.code,
        programId: org[spec.programKey] as string,
        academicYearId: org['yearCurrent'] as string,
        termId: org['termOddCurrent'] as string,
        examType: 'END_TERM',
        status: 'SCHEDULED',
        startDate: demoDate('2026-12-01'),
        endDate: demoDate('2026-12-16'),
        resultDeclarationDate: demoDate('2027-01-05'),
        eligibilityPolicy: 'MINIMUM_ATTENDANCE_75',
        gradingSchemeId: scheme.id,
        createdBy: creator,
      },
    });

    const subjects: Array<{ id: string; courseCode: string; name: string }> = [];
    for (const subjectSpec of spec.subjects) {
      const subject = await prisma.examSubject.upsert({
        where: {
          tenantId_sessionId_courseId: {
            tenantId,
            sessionId: session.id,
            courseId: academics.courseIds[subjectSpec.courseCode] as string,
          },
        },
        update: { status: 'PUBLISHED' },
        create: {
          id: id(`subject/${spec.code}/${subjectSpec.courseCode}`),
          tenantId,
          sessionId: session.id,
          courseId: academics.courseIds[subjectSpec.courseCode] as string,
          roomId: org['roomA101'] as string,
          maxMarks: 100,
          passMarks: 40,
          durationMinutes: 180,
          pattern: 'Theory — 100 marks',
          examDate: demoDate(subjectSpec.examDate),
          startTime: subjectSpec.startTime,
          endTime: subjectSpec.startTime === '09:30' ? '12:30' : '17:00',
          status: 'PUBLISHED',
          createdBy: creator,
        },
      });
      subjects.push({
        id: subject.id,
        courseCode: subjectSpec.courseCode,
        name: academics.offerings.find((offering) => offering.courseCode === subjectSpec.courseCode)?.courseName ?? subjectSpec.courseCode,
      });
    }

    const cohortStudents = people.students.filter(
      (student) => student.programKey === spec.studentProgramKey && student.cohortYear === spec.cohortYear,
    );
    let ticketSeq = 1;
    for (const [studentIndex, student] of cohortStudents.entries()) {
      const registration = await prisma.examRegistration.upsert({
        where: { tenantId_sessionId_studentId: { tenantId, sessionId: session.id, studentId: student.id } },
        update: { status: 'REGISTERED' },
        create: {
          id: id(`registration/${spec.code}/${student.admissionNumber}`),
          tenantId,
          sessionId: session.id,
          studentId: student.id,
          status: 'REGISTERED',
          registeredAt: demoDate('2026-10-05'),
          createdBy: creator,
        },
      });

      if (spec.issueTickets) {
        const hallTicket = await prisma.examHallTicket.upsert({
          where: { registrationId: registration.id },
          update: { status: 'ISSUED' },
          create: {
            id: id(`hall-ticket/${spec.code}/${student.admissionNumber}`),
            tenantId,
            registrationId: registration.id,
            sessionId: session.id,
            ticketNumber: `HT-2627-${spec.code.replace('ESE-2627-', '')}-${String(ticketSeq).padStart(3, '0')}`,
            status: 'ISSUED',
            issuedAt: demoDate('2026-11-20'),
            issuedBy: examControllerUserId,
          },
        });
        for (const [subjectIndex, subject] of subjects.entries()) {
          await prisma.examHallTicketSubject.upsert({
            where: {
              tenantId_hallTicketId_subjectId: { tenantId, hallTicketId: hallTicket.id, subjectId: subject.id },
            },
            update: {},
            create: {
              id: id(`hall-ticket-subject/${spec.code}/${student.admissionNumber}/${subject.courseCode}`),
              tenantId,
              hallTicketId: hallTicket.id,
              subjectId: subject.id,
              courseCode: subject.courseCode,
              courseName: subject.name,
              maxMarks: 100,
              passMarks: 40,
              examDate: demoDate(spec.subjects[subjectIndex]?.examDate ?? '2026-12-02'),
              startTime: spec.subjects[subjectIndex]?.startTime ?? '09:30',
              endTime: '12:30',
              roomName: 'A-101',
              seatNo: `A-${String(studentIndex * 2 + subjectIndex + 1).padStart(3, '0')}`,
            },
          });
        }
        ticketSeq += 1;
      }
    }
  }

  logDemo('exams+results', {
    publishedSessions: 1,
    publishedResults,
    currentSessions: currentSessions.length,
    subjects: publishedSubjects.length + currentSessions.reduce((sum, session) => sum + session.subjects.length, 0),
  });

  return { publishedResults };
}
