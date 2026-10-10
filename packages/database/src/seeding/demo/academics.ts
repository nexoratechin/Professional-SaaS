/**
 * Demo module 04 — academics: courses, curricula + versions + course mapping, course
 * prerequisites, current-term course offerings with faculty allocation and student
 * registrations.
 */
import type { PrismaClient } from '@prisma/client';
import { demoDate, demoId, logDemo, type DemoContext, type IdMap } from './core';
import type { SeededPeople } from './people';

export interface SeededOffering {
  key: string;
  id: string;
  code: string;
  courseId: string;
  courseCode: string;
  courseName: string;
  programId: string;
  batchId: string;
  sectionId: string | null;
  facultyUserId: string;
  studentIds: string[];
}

export interface SeededAcademics {
  courseIds: Record<string, string>;
  offerings: SeededOffering[];
  registrationCount: number;
}

export interface AcademicsInput {
  prisma: PrismaClient;
  ctx: DemoContext;
  org: IdMap;
  people: SeededPeople;
}

interface CourseSpec {
  code: string;
  name: string;
  departmentKey: string;
  creditHours: number;
  courseType: 'CORE' | 'ELECTIVE' | 'LABORATORY';
  semesters: number[];
  programKeys: string[];
}

export async function seedAcademics(input: AcademicsInput): Promise<SeededAcademics> {
  const { prisma, ctx, org, people } = input;
  const { tenantId, creator } = ctx;

  const courseSpecs: CourseSpec[] = [
    { code: 'CS101', name: 'Programming Fundamentals', departmentKey: 'deptCse', creditHours: 4, courseType: 'CORE', semesters: [1], programKeys: ['btechCse'] },
    { code: 'CS102', name: 'Programming Laboratory', departmentKey: 'deptCse', creditHours: 2, courseType: 'LABORATORY', semesters: [1], programKeys: ['btechCse'] },
    { code: 'CS201', name: 'Data Structures & Algorithms', departmentKey: 'deptCse', creditHours: 4, courseType: 'CORE', semesters: [3], programKeys: ['btechCse'] },
    { code: 'CS301', name: 'Database Management Systems', departmentKey: 'deptCse', creditHours: 4, courseType: 'CORE', semesters: [3], programKeys: ['btechCse'] },
    { code: 'CS401', name: 'Operating Systems', departmentKey: 'deptCse', creditHours: 4, courseType: 'CORE', semesters: [5], programKeys: ['btechCse'] },
    { code: 'CS501', name: 'Computer Networks', departmentKey: 'deptCse', creditHours: 4, courseType: 'CORE', semesters: [7], programKeys: ['btechCse'] },
    { code: 'CS601', name: 'Machine Learning', departmentKey: 'deptCse', creditHours: 4, courseType: 'ELECTIVE', semesters: [7], programKeys: ['btechCse'] },
    { code: 'EC101', name: 'Basic Electronics', departmentKey: 'deptEce', creditHours: 4, courseType: 'CORE', semesters: [1], programKeys: ['btechEce'] },
    { code: 'EC201', name: 'Signals & Systems', departmentKey: 'deptEce', creditHours: 4, courseType: 'CORE', semesters: [3], programKeys: ['btechEce'] },
    { code: 'EC301', name: 'Digital Electronics', departmentKey: 'deptEce', creditHours: 4, courseType: 'CORE', semesters: [3], programKeys: ['btechEce'] },
    { code: 'EC401', name: 'Communication Systems', departmentKey: 'deptEce', creditHours: 4, courseType: 'CORE', semesters: [5], programKeys: ['btechEce'] },
    { code: 'ME101', name: 'Engineering Mechanics', departmentKey: 'deptMe', creditHours: 4, courseType: 'CORE', semesters: [1], programKeys: ['btechMe'] },
    { code: 'ME201', name: 'Engineering Thermodynamics', departmentKey: 'deptMe', creditHours: 4, courseType: 'CORE', semesters: [3], programKeys: ['btechMe'] },
    { code: 'BB101', name: 'Principles of Management', departmentKey: 'deptBba', creditHours: 3, courseType: 'CORE', semesters: [1], programKeys: ['bba'] },
    { code: 'BB201', name: 'Financial Accounting', departmentKey: 'deptBba', creditHours: 3, courseType: 'CORE', semesters: [3], programKeys: ['bba'] },
    { code: 'BB301', name: 'Marketing Management', departmentKey: 'deptBba', creditHours: 3, courseType: 'CORE', semesters: [5], programKeys: ['bba'] },
    { code: 'MC101', name: 'Advanced Programming with Python', departmentKey: 'deptMca', creditHours: 4, courseType: 'CORE', semesters: [1], programKeys: ['mca'] },
    { code: 'MC201', name: 'Advanced Database Systems', departmentKey: 'deptMca', creditHours: 4, courseType: 'CORE', semesters: [1], programKeys: ['mca'] },
  ];

  const courseIds: Record<string, string> = {};
  for (const course of courseSpecs) {
    const row = await prisma.course.upsert({
      where: { tenantId_code: { tenantId, code: course.code } },
      update: {
        name: course.name,
        departmentId: org[course.departmentKey] as string,
        creditHours: course.creditHours,
        courseType: course.courseType,
        gradingBasis: 'PERCENTAGE',
        isActive: true,
        updatedBy: creator,
      },
      create: {
        id: demoId(`course/${course.code}`),
        tenantId,
        departmentId: org[course.departmentKey] as string,
        code: course.code,
        name: course.name,
        creditHours: course.creditHours,
        courseType: course.courseType,
        gradingBasis: 'PERCENTAGE',
        createdBy: creator,
      },
    });
    courseIds[course.code] = row.id;
  }

  // Prerequisites: the classic chain through the CSE curriculum.
  const prerequisites: Array<[string, string]> = [
    ['CS201', 'CS101'],
    ['CS301', 'CS201'],
    ['CS501', 'CS301'],
  ];
  for (const [course, required] of prerequisites) {
    await prisma.coursePrerequisite.upsert({
      where: {
        tenantId_courseId_requiredCourseId: {
          tenantId,
          courseId: courseIds[course] as string,
          requiredCourseId: courseIds[required] as string,
        },
      },
      update: {},
      create: {
        id: demoId(`prerequisite/${course}/${required}`),
        tenantId,
        courseId: courseIds[course] as string,
        requiredCourseId: courseIds[required] as string,
        minGrade: 'C',
        description: `${course} requires a pass in ${required}`,
        createdBy: creator,
      },
    });
  }

  // Curricula: one per program, one active version mapping its courses to semesters.
  const programCurriculum: Record<string, string[]> = {
    btechCse: ['CS101', 'CS102', 'CS201', 'CS301', 'CS401', 'CS501', 'CS601'],
    btechEce: ['EC101', 'EC201', 'EC301', 'EC401'],
    btechMe: ['ME101', 'ME201'],
    bba: ['BB101', 'BB201', 'BB301'],
    mca: ['MC101', 'MC201'],
  };
  for (const [programKey, courseCodes] of Object.entries(programCurriculum)) {
    const curriculum = await prisma.curriculum.upsert({
      where: { tenantId_code: { tenantId, code: `CUR-${programKey.toUpperCase()}` } },
      update: { programId: org[programKey] as string, isActive: true, updatedBy: creator },
      create: {
        id: demoId(`curriculum/${programKey}`),
        tenantId,
        programId: org[programKey] as string,
        code: `CUR-${programKey.toUpperCase()}`,
        name: `Curriculum — ${programKey.toUpperCase()}`,
        description: 'Outcome-based curriculum aligned to the national credit framework.',
        createdBy: creator,
      },
    });

    const version = await prisma.curriculumVersion.upsert({
      where: {
        tenantId_curriculumId_versionNumber: { tenantId, curriculumId: curriculum.id, versionNumber: 1 },
      },
      update: { status: 'ACTIVE', isCurrent: true, effectiveFrom: demoDate('2026-07-15') },
      create: {
        id: demoId(`curriculum-version/${programKey}/1`),
        tenantId,
        curriculumId: curriculum.id,
        versionNumber: 1,
        name: 'Version 1.0 (2026 regulations)',
        status: 'ACTIVE',
        effectiveFrom: demoDate('2026-07-15'),
        minTotalCredits: programKey === 'mca' ? 90 : programKey === 'bba' ? 120 : 160,
        isCurrent: true,
        createdBy: creator,
      },
    });

    let sequence = 0;
    for (const code of courseCodes) {
      const spec = courseSpecs.find((c) => c.code === code);
      if (!spec) continue;
      for (const semester of spec.semesters) {
        await prisma.curriculumCourse.upsert({
          where: {
            tenantId_curriculumVersionId_courseId: {
              tenantId,
              curriculumVersionId: version.id,
              courseId: courseIds[code] as string,
            },
          },
          update: { semester, sequence, category: spec.courseType === 'LABORATORY' ? 'LAB' : 'THEORY' },
          create: {
            id: demoId(`curriculum-course/${programKey}/${code}`),
            tenantId,
            curriculumVersionId: version.id,
            courseId: courseIds[code] as string,
            semester,
            category: spec.courseType === 'LABORATORY' ? 'LAB' : 'THEORY',
            isCompulsory: spec.courseType !== 'ELECTIVE',
            sequence,
            createdBy: creator,
          },
        });
        sequence += 1;
      }
    }
  }

  // ------------------------------------------------------------------ current-term offerings
  const offeringSpecs: Array<{
    key: string;
    course: string;
    programKey: string;
    batchKey: string;
    sectionKey: string;
    facultyKey: string;
    coTeacherKey?: string;
  }> = [
    { key: 'cse2026-cs101', course: 'CS101', programKey: 'btechCse', batchKey: 'batchCse2026', sectionKey: 'sectionCse2026A', facultyKey: 'fac-cse1', coTeacherKey: 'fac-cse2' },
    { key: 'cse2026-cs102', course: 'CS102', programKey: 'btechCse', batchKey: 'batchCse2026', sectionKey: 'sectionCse2026A', facultyKey: 'fac-cse2' },
    { key: 'ece2026-ec101', course: 'EC101', programKey: 'btechEce', batchKey: 'batchEce2026', sectionKey: 'sectionEce2026A', facultyKey: 'fac-ece1' },
    { key: 'me2026-me101', course: 'ME101', programKey: 'btechMe', batchKey: 'batchMe2026', sectionKey: 'sectionMe2026A', facultyKey: 'fac-me1' },
    { key: 'bba2026-bb101', course: 'BB101', programKey: 'bba', batchKey: 'batchBba2026', sectionKey: 'sectionBba2026A', facultyKey: 'fac-bba1' },
    { key: 'mca2026-mc101', course: 'MC101', programKey: 'mca', batchKey: 'batchMca2026', sectionKey: 'sectionMca2026A', facultyKey: 'fac-mca1' },
    { key: 'mca2026-mc201', course: 'MC201', programKey: 'mca', batchKey: 'batchMca2026', sectionKey: 'sectionMca2026A', facultyKey: 'fac-mca2' },
    { key: 'cse2025-cs201', course: 'CS201', programKey: 'btechCse', batchKey: 'batchCse2025', sectionKey: 'sectionCse2025A', facultyKey: 'fac-cse2' },
    { key: 'cse2025-cs301', course: 'CS301', programKey: 'btechCse', batchKey: 'batchCse2025', sectionKey: 'sectionCse2025A', facultyKey: 'fac-cse1' },
    { key: 'ece2025-ec201', course: 'EC201', programKey: 'btechEce', batchKey: 'batchEce2025', sectionKey: 'sectionEce2025A', facultyKey: 'fac-ece2' },
    { key: 'ece2025-ec301', course: 'EC301', programKey: 'btechEce', batchKey: 'batchEce2025', sectionKey: 'sectionEce2025A', facultyKey: 'fac-ece1' },
    { key: 'bba2025-bb201', course: 'BB201', programKey: 'bba', batchKey: 'batchBba2025', sectionKey: 'sectionBba2025A', facultyKey: 'fac-bba2' },
    { key: 'cse2023-cs501', course: 'CS501', programKey: 'btechCse', batchKey: 'batchCse2023', sectionKey: 'sectionCse2023A', facultyKey: 'fac-cse1' },
    { key: 'cse2023-cs601', course: 'CS601', programKey: 'btechCse', batchKey: 'batchCse2023', sectionKey: 'sectionCse2023A', facultyKey: 'fac-cse2' },
  ];

  const offerings: SeededOffering[] = [];
  let registrationCount = 0;

  for (const spec of offeringSpecs) {
    const courseSpec = courseSpecs.find((c) => c.code === spec.course);
    if (!courseSpec) throw new Error(`Demo seed bug: course ${spec.course} missing`);
    const programId = org[spec.programKey] as string;
    const batchId = org[spec.batchKey] as string;
    const sectionId = org[spec.sectionKey] as string;
    const facultyUserId = people.staff[spec.facultyKey]?.userId as string;
    if (!facultyUserId) throw new Error(`Demo seed bug: faculty ${spec.facultyKey} missing`);
    const code = `ODD2627-${spec.course}-${spec.batchKey.replace(/\D/g, '')}`;

    const offering = await prisma.courseOffering.upsert({
      where: { tenantId_code: { tenantId, code } },
      update: {
        status: 'ACTIVE',
        creditHours: courseSpec.creditHours,
        capacity: 60,
        enrollmentStartAt: demoDate('2026-07-10'),
        enrollmentEndAt: demoDate('2026-07-31'),
        updatedBy: creator,
      },
      create: {
        id: demoId(`offering/${code}`),
        tenantId,
        courseId: courseIds[spec.course] as string,
        termId: org['termOddCurrent'] as string,
        academicYearId: org['yearCurrent'] as string,
        programId,
        sectionId,
        batchId,
        campusId: org['campusMain'] as string,
        code,
        creditHours: courseSpec.creditHours,
        status: 'ACTIVE',
        mode: 'OFFLINE',
        capacity: 60,
        waitlistCapacity: 5,
        enrollmentStartAt: demoDate('2026-07-10'),
        enrollmentEndAt: demoDate('2026-07-31'),
        schedule: { days: ['MON', 'WED', 'FRI'], startTime: '09:00', endTime: '10:00' },
        createdBy: creator,
      },
    });

    await prisma.courseOfferingFaculty.upsert({
      where: {
        tenantId_courseOfferingId_userId: { tenantId, courseOfferingId: offering.id, userId: facultyUserId },
      },
      update: { role: 'PRIMARY', allocationPercent: 100, isActive: true },
      create: {
        id: demoId(`offering-faculty/${code}/primary`),
        tenantId,
        courseOfferingId: offering.id,
        userId: facultyUserId,
        role: 'PRIMARY',
        allocationPercent: 100,
        createdBy: creator,
      },
    });
    if (spec.coTeacherKey) {
      const coTeacherId = people.staff[spec.coTeacherKey]?.userId as string;
      await prisma.courseOfferingFaculty.upsert({
        where: {
          tenantId_courseOfferingId_userId: { tenantId, courseOfferingId: offering.id, userId: coTeacherId },
        },
        update: { role: 'CO_TEACHER', allocationPercent: 50, isActive: true },
        create: {
          id: demoId(`offering-faculty/${code}/co`),
          tenantId,
          courseOfferingId: offering.id,
          userId: coTeacherId,
          role: 'CO_TEACHER',
          allocationPercent: 50,
          createdBy: creator,
        },
      });
    }

    const cohortStudents = people.students.filter(
      (student) => student.programId === programId && student.batchId === batchId,
    );
    for (const student of cohortStudents) {
      await prisma.courseRegistration.upsert({
        where: {
          tenantId_studentId_courseOfferingId: {
            tenantId,
            studentId: student.id,
            courseOfferingId: offering.id,
          },
        },
        update: { status: 'CONFIRMED', termId: org['termOddCurrent'] as string },
        create: {
          id: demoId(`registration/${student.admissionNumber}/${code}`),
          tenantId,
          studentId: student.id,
          courseOfferingId: offering.id,
          termId: org['termOddCurrent'] as string,
          status: 'CONFIRMED',
          enrolledAt: demoDate('2026-07-25'),
          approvedByUserId: creator,
          createdBy: creator,
        },
      });
      registrationCount += 1;
    }

    offerings.push({
      key: spec.key,
      id: offering.id,
      code,
      courseId: courseIds[spec.course] as string,
      courseCode: spec.course,
      courseName: courseSpec.name,
      programId,
      batchId,
      sectionId,
      facultyUserId,
      studentIds: cohortStudents.map((student) => student.id),
    });
  }

  logDemo('academics', {
    courses: courseSpecs.length,
    curricula: Object.keys(programCurriculum).length,
    offerings: offerings.length,
    registrations: registrationCount,
  });

  return { courseIds, offerings, registrationCount };
}
