/**
 * Demo module 03 — people: staff/faculty users with role assignments and HR records, students
 * with their portal accounts, guardians (with parent accounts), enrollments, academic history,
 * documents, status history and activity trail.
 */
import type { PrismaClient } from '@prisma/client';
import {
  demoDate,
  demoDateTime,
  demoId,
  spread,
  stablePick,
  logDemo,
  type IdMap,
} from './core';
import {
  FACULTY_FIRST_NAMES,
  GUARDIAN_FIRST_NAMES,
  GUARDIAN_OCCUPATIONS,
  STREETS,
  STUDENT_FIRST_NAMES,
  STUDENT_LAST_NAMES,
} from './names';

export interface SeededStaff {
  key: string;
  userId: string;
  employeeId: string;
  email: string;
  fullName: string;
  isFaculty: boolean;
  departmentKey: string;
  campusId: string;
}

export interface SeededStudent {
  key: string;
  id: string;
  userId: string;
  email: string;
  fullName: string;
  admissionNumber: string;
  programKey: string;
  programId: string;
  batchKey: string;
  batchId: string;
  sectionId: string;
  campusId: string;
  gender: 'MALE' | 'FEMALE';
  phone: string;
  cohortYear: '2023' | '2025' | '2026';
  semester: number;
}

export interface SeededPeople {
  staff: Record<string, SeededStaff>;
  students: SeededStudent[];
  guardianUsers: number;
}

const ADMIN_EMAIL = 'admin@sunrise-demo.edu';

export interface PeopleInput {
  prisma: PrismaClient;
  tenantId: string;
  adminUserId: string;
  passwordHash: string;
  org: IdMap;
  rolesByCode: Map<string, string>;
}

interface StaffSpec {
  key: string;
  name: string;
  roleCode: string;
  designationCode: string;
  departmentKey: string;
  campusKey: 'campusMain' | 'campusCity';
  isFaculty?: boolean;
}

export async function seedPeople(input: PeopleInput): Promise<SeededPeople> {
  const { prisma, tenantId, adminUserId, passwordHash, org, rolesByCode } = input;
  const created = demoDateTime('2026-06-20T10:00');

  const roleId = (code: string): string => {
    const value = rolesByCode.get(code);
    if (!value) throw new Error(`Demo seed bug: role ${code} missing — run provisioning first.`);
    return value;
  };

  const upsertUser = async (email: string, fullName: string, phone: string) =>
    prisma.user.upsert({
      where: { tenantId_email: { tenantId, email } },
      update: { fullName, phone, passwordHash, status: 'ACTIVE', emailVerifiedAt: created, updatedBy: adminUserId },
      create: {
        id: demoId(`user/${email}`),
        tenantId,
        email,
        fullName,
        phone,
        passwordHash,
        status: 'ACTIVE',
        emailVerifiedAt: created,
        createdBy: adminUserId,
      },
    });

  const assignRole = async (userId: string, roleCode: string, scope?: { departmentId?: string; campusId?: string }) => {
    await prisma.userRole.upsert({
      where: { tenantId_userId_roleId: { tenantId, userId, roleId: roleId(roleCode) } },
      update: {
        scopeDepartmentId: scope?.departmentId ?? null,
        scopeCampusId: scope?.campusId ?? null,
      },
      create: {
        id: demoId(`user-role/${userId}/${roleCode}`),
        tenantId,
        userId,
        roleId: roleId(roleCode),
        scopeDepartmentId: scope?.departmentId ?? null,
        scopeCampusId: scope?.campusId ?? null,
        assignedByUserId: adminUserId,
      },
    });
  };

  // ------------------------------------------------------------------ staff + faculty users
  const facultyDepts: Array<{ key: 'deptCse' | 'deptEce' | 'deptMe' | 'deptBba' | 'deptMca'; code: string; name: string }> = [
    { key: 'deptCse', code: 'CSE', name: 'Computer Science & Engineering' },
    { key: 'deptEce', code: 'ECE', name: 'Electronics & Communication' },
    { key: 'deptMe', code: 'ME', name: 'Mechanical Engineering' },
    { key: 'deptBba', code: 'BBA', name: 'Business Administration' },
    { key: 'deptMca', code: 'MCA', name: 'Computer Applications' },
  ];

  const staffSpecs: StaffSpec[] = [
    { key: 'principal', name: 'Dr. Vasudha Ranade', roleCode: 'PRINCIPAL', designationCode: 'PROFESSOR', departmentKey: 'deptAdmin', campusKey: 'campusMain' },
    { key: 'registrar', name: 'Sanjay Deshpande', roleCode: 'REGISTRAR', designationCode: 'REGISTRAR', departmentKey: 'deptAdmin', campusKey: 'campusMain' },
    { key: 'accountant', name: 'Kavita Joshi', roleCode: 'ACCOUNTANT', designationCode: 'ACCOUNTANT', departmentKey: 'deptAdmin', campusKey: 'campusMain' },
    { key: 'librarian', name: 'Shalini Naik', roleCode: 'LIBRARIAN', designationCode: 'LIBRARIAN', departmentKey: 'deptAdmin', campusKey: 'campusMain' },
    { key: 'warden', name: 'Maj. Rakesh Pawar (Retd.)', roleCode: 'HOSTEL_WARDEN', designationCode: 'WARDEN', departmentKey: 'deptAdmin', campusKey: 'campusMain' },
    { key: 'wardenGirls', name: 'Sushma Jadhav', roleCode: 'HOSTEL_WARDEN', designationCode: 'WARDEN', departmentKey: 'deptAdmin', campusKey: 'campusMain' },
    { key: 'transportManager', name: 'Ganpat Shinde', roleCode: 'TRANSPORT_MANAGER', designationCode: 'TRANSPORT_MGR', departmentKey: 'deptAdmin', campusKey: 'campusMain' },
    { key: 'hrManager', name: 'Meera Kelkar', roleCode: 'HR', designationCode: 'HR_MGR', departmentKey: 'deptAdmin', campusKey: 'campusMain' },
    { key: 'placementOfficer', name: 'Nilesh Barve', roleCode: 'PLACEMENT_OFFICER', designationCode: 'PLACEMENT_OFF', departmentKey: 'deptAdmin', campusKey: 'campusMain' },
    { key: 'examController', name: 'Dr. Suhasini Kulkarni', roleCode: 'EXAM_CONTROLLER', designationCode: 'EXAM_CTRL', departmentKey: 'deptAdmin', campusKey: 'campusMain' },
    { key: 'campusAdmin', name: 'Prasad Kale', roleCode: 'CAMPUS_ADMIN', designationCode: 'ADMIN_OFFICER', departmentKey: 'deptAdmin', campusKey: 'campusMain' },
  ];

  // Two faculty per department; the first of each department is also the HOD.
  let facultyIndex = 0;
  for (const dept of facultyDepts) {
    for (let n = 1; n <= 2; n += 1) {
      staffSpecs.push({
        key: `fac-${dept.code.toLowerCase()}${n}`,
        name: `${stablePick(FACULTY_FIRST_NAMES, facultyIndex)} ${stablePick(STUDENT_LAST_NAMES, facultyIndex + n)}`,
        roleCode: 'FACULTY',
        designationCode: n === 1 ? 'PROFESSOR' : 'ASST_PROF',
        departmentKey: dept.key,
        campusKey: dept.key === 'deptBba' || dept.key === 'deptMca' ? 'campusCity' : 'campusMain',
        isFaculty: true,
      });
      facultyIndex += 1;
    }
  }

  const staff: Record<string, SeededStaff> = {};
  let employeeSequence = 1;

  for (const spec of staffSpecs) {
    const email = spec.isFaculty
      ? `fac.${spec.key.split('-')[1]}@sunrise-demo.edu`
      : spec.key.replace(/([A-Z])/g, '.$1').toLowerCase() + '@sunrise-demo.edu';
    const phone = `+9198${String(10_000_000 + employeeSequence * 7919).slice(0, 8)}`;
    const user = await upsertUser(email, spec.name, phone);
    await assignRole(user.id, spec.roleCode, {
      departmentId: spec.isFaculty ? (org[spec.departmentKey] as string) : undefined,
    });
    // First faculty of each department additionally holds HOD, scoped to the department.
    const isHod = spec.isFaculty && spec.key.endsWith('1');
    if (isHod) {
      await assignRole(user.id, 'HOD', { departmentId: org[spec.departmentKey] as string });
    }

    const campusId = org[spec.campusKey] as string;
    const joinYear = 2018 + (employeeSequence % 6);
    const employeeCode = `EMP-${String(employeeSequence).padStart(4, '0')}`;
    const [firstName, ...rest] = spec.name.replace(/^Dr\.\s+|^Prof\.\s+|^Maj\.\s+/, '').split(' ');
    const lastName = rest.join(' ') || firstName || 'Employee';

    const employee = await prisma.employee.upsert({
      where: { tenantId_employeeCode: { tenantId, employeeCode } },
      update: {
        userId: user.id,
        employeeType: spec.isFaculty ? 'FACULTY' : 'ADMIN',
        honorific: spec.name.startsWith('Dr.') ? 'Dr.' : spec.name.startsWith('Prof.') ? 'Prof.' : null,
        firstName: firstName ?? 'Employee',
        lastName: lastName,
        departmentId: org[spec.departmentKey] as string,
        designationId: demoId(`organisation/designation/${spec.designationCode}`),
        campusId,
        employmentType: 'FULL_TIME',
        employmentStatus: 'ACTIVE',
        joinDate: demoDate(`${joinYear}-06-15`),
        qualification: spec.isFaculty ? 'Ph.D.' : 'M.Com / MBA',
        specialization: spec.isFaculty
          ? `${facultyDepts.find((d) => d.key === spec.departmentKey)?.name ?? 'Academics'}`
          : 'Institutional administration',
      },
      create: {
        id: demoId(`employee/${employeeCode}`),
        tenantId,
        employeeCode,
        userId: user.id,
        employeeType: spec.isFaculty ? 'FACULTY' : 'ADMIN',
        honorific: spec.name.startsWith('Dr.') ? 'Dr.' : spec.name.startsWith('Prof.') ? 'Prof.' : null,
        firstName: firstName ?? 'Employee',
        lastName: lastName,
        phone,
        personalEmail: email,
        departmentId: org[spec.departmentKey] as string,
        designationId: demoId(`organisation/designation/${spec.designationCode}`),
        campusId,
        employmentType: 'FULL_TIME',
        employmentStatus: 'ACTIVE',
        joinDate: demoDate(`${joinYear}-06-15`),
        qualification: spec.isFaculty ? 'Ph.D.' : 'M.Com / MBA',
        specialization: spec.isFaculty
          ? `${facultyDepts.find((d) => d.key === spec.departmentKey)?.name ?? 'Academics'}`
          : 'Institutional administration',
        createdBy: adminUserId,
      },
    });

    await prisma.employeeJoining.upsert({
      where: { id: demoId(`employee-joining/${employeeCode}`) },
      update: { joiningStatus: 'CONFIRMED' },
      create: {
        id: demoId(`employee-joining/${employeeCode}`),
        tenantId,
        employeeId: employee.id,
        joiningStatus: 'CONFIRMED',
        offerDate: demoDate(`${joinYear}-05-01`),
        effectiveDate: demoDate(`${joinYear}-06-15`),
        probationMonths: 6,
        confirmationDate: demoDate(`${joinYear}-12-15`),
      },
    });

    await prisma.employeeDocument.upsert({
      where: { id: demoId(`employee-document/${employeeCode}`) },
      update: { isVerified: true },
      create: {
        id: demoId(`employee-document/${employeeCode}`),
        tenantId,
        employeeId: employee.id,
        documentType: 'ID_PROOF',
        title: 'Government photo ID',
        description: 'Verified at joining',
        isVerified: true,
        verifiedByUserId: adminUserId,
        verifiedAt: created,
        uploadedByUserId: user.id,
      },
    });

    if (spec.isFaculty) {
      const workloads = [
        { key: 'teaching', type: 'TEACHING' as const, title: `Course delivery — ${spec.departmentKey.replace('dept', '').toUpperCase()} (current term)`, hours: spread(employeeSequence, 3, 12, 18) },
        ...(isHod
          ? [{ key: 'admin', type: 'ADMINISTRATIVE' as const, title: 'Head of Department duties', hours: 6 }]
          : []),
        ...(employeeSequence % 3 === 0
          ? [{ key: 'exam', type: 'EXAM_DUTY' as const, title: 'University examination duty', hours: 4 }]
          : []),
      ];
      for (const workload of workloads) {
        await prisma.facultyWorkload.upsert({
          where: { id: demoId(`workload/${employeeCode}/${workload.key}`) },
          update: { title: workload.title, hoursPerWeek: workload.hours },
          create: {
            id: demoId(`workload/${employeeCode}/${workload.key}`),
            tenantId,
            employeeId: employee.id,
            termId: org['termOddCurrent'] as string,
            workloadType: workload.type,
            title: workload.title,
            hoursPerWeek: workload.hours,
            effectiveFrom: demoDate('2026-07-15'),
            effectiveTo: demoDate('2026-12-20'),
            createdBy: adminUserId,
          },
        });
      }
    }

    staff[spec.key] = {
      key: spec.key,
      userId: user.id,
      employeeId: employee.id,
      email,
      fullName: spec.name,
      isFaculty: Boolean(spec.isFaculty),
      departmentKey: spec.departmentKey,
      campusId,
    };
    employeeSequence += 1;
  }

  // ------------------------------------------------------------------ students
  const cohorts: Array<{
    cohortYear: '2023' | '2025' | '2026';
    programKey: string;
    programIdKey: string;
    batchKey: string;
    sectionKey: string;
    campusKey: 'campusMain' | 'campusCity';
    semester: number;
    count: number;
  }> = [
    { cohortYear: '2023', programKey: 'BTECH-CSE', programIdKey: 'btechCse', batchKey: 'batchCse2023', sectionKey: 'sectionCse2023A', campusKey: 'campusMain', semester: 7, count: 6 },
    { cohortYear: '2023', programKey: 'BBA', programIdKey: 'bba', batchKey: 'batchBba2023', sectionKey: 'sectionBba2023A', campusKey: 'campusCity', semester: 5, count: 4 },
    { cohortYear: '2025', programKey: 'BTECH-CSE', programIdKey: 'btechCse', batchKey: 'batchCse2025', sectionKey: 'sectionCse2025A', campusKey: 'campusMain', semester: 3, count: 7 },
    { cohortYear: '2025', programKey: 'BTECH-ECE', programIdKey: 'btechEce', batchKey: 'batchEce2025', sectionKey: 'sectionEce2025A', campusKey: 'campusMain', semester: 3, count: 5 },
    { cohortYear: '2025', programKey: 'BBA', programIdKey: 'bba', batchKey: 'batchBba2025', sectionKey: 'sectionBba2025A', campusKey: 'campusCity', semester: 3, count: 3 },
    { cohortYear: '2026', programKey: 'BTECH-CSE', programIdKey: 'btechCse', batchKey: 'batchCse2026', sectionKey: 'sectionCse2026A', campusKey: 'campusMain', semester: 1, count: 6 },
    { cohortYear: '2026', programKey: 'BTECH-ECE', programIdKey: 'btechEce', batchKey: 'batchEce2026', sectionKey: 'sectionEce2026A', campusKey: 'campusMain', semester: 1, count: 4 },
    { cohortYear: '2026', programKey: 'BTECH-ME', programIdKey: 'btechMe', batchKey: 'batchMe2026', sectionKey: 'sectionMe2026A', campusKey: 'campusMain', semester: 1, count: 3 },
    { cohortYear: '2026', programKey: 'BBA', programIdKey: 'bba', batchKey: 'batchBba2026', sectionKey: 'sectionBba2026A', campusKey: 'campusCity', semester: 1, count: 5 },
    { cohortYear: '2026', programKey: 'MCA', programIdKey: 'mca', batchKey: 'batchMca2026', sectionKey: 'sectionMca2026A', campusKey: 'campusCity', semester: 1, count: 3 },
  ];

  const students: SeededStudent[] = [];
  let studentIndex = 0;
  let admissionSequence = 1;
  let guardianUsers = 0;

  for (const cohort of cohorts) {
    for (let n = 1; n <= cohort.count; n += 1) {
      const first = stablePick(STUDENT_FIRST_NAMES, studentIndex * 3 + n);
      const last = stablePick(STUDENT_LAST_NAMES, studentIndex * 7 + n);
      const fullName = `${first} ${last}`;
      const admissionNumber = `SIT-${cohort.cohortYear}-${String(admissionSequence).padStart(4, '0')}`;
      const email = `student.${admissionNumber.toLowerCase()}@sunrise-demo.edu`;
      const phone = `+9197${String(20_000_000 + admissionSequence * 6983).slice(0, 8)}`;
      const gender: 'MALE' | 'FEMALE' = studentIndex % 2 === 0 ? 'MALE' : 'FEMALE';
      const city = stablePick(STREETS, studentIndex);
      const sectionId = org[cohort.sectionKey] as string;
      const batchId = org[cohort.batchKey] as string;
      const programId = org[cohort.programIdKey] as string;
      const campusId = org[cohort.campusKey] as string;

      const user = await upsertUser(email, fullName, phone);
      await assignRole(user.id, 'STUDENT');

      const student = await prisma.student.upsert({
        where: { tenantId_admissionNumber: { tenantId, admissionNumber } },
        update: {
          userId: user.id,
          firstName: first,
          lastName: last,
          fullName,
          gender,
          status: 'ACTIVE',
          programId,
          batchId,
          sectionId,
          campusId,
          academicYearId: org['yearCurrent'] as string,
          email,
          primaryPhone: phone,
          city,
          updatedBy: adminUserId,
        },
        create: {
          id: demoId(`student/${admissionNumber}`),
          tenantId,
          campusId,
          userId: user.id,
          admissionNumber,
          rollNumber: `${cohort.programKey.replace(/[^A-Z]/g, '').slice(0, 3)}${cohort.cohortYear.slice(2)}${String(n).padStart(3, '0')}`,
          registrationNumber: `REG-${cohort.cohortYear}-${String(admissionSequence).padStart(4, '0')}`,
          firstName: first,
          lastName: last,
          fullName,
          gender,
          bloodGroup: (['A_POSITIVE', 'B_POSITIVE', 'O_POSITIVE', 'AB_POSITIVE', 'O_NEGATIVE'] as const)[studentIndex % 5],
          dateOfBirth: demoDate(`${Number(cohort.cohortYear) - 18}-${String((studentIndex % 12) + 1).padStart(2, '0')}-${String((studentIndex % 27) + 1).padStart(2, '0')}`),
          nationality: 'Indian',
          category: studentIndex % 5 === 0 ? 'OBC' : studentIndex % 7 === 0 ? 'SC' : 'General',
          email,
          primaryPhone: phone,
          currentAddressLine1: `${spread(studentIndex, 1, 1, 120)}, ${city}`,
          city,
          state: 'Maharashtra',
          postalCode: `4110${String(spread(studentIndex, 2, 10, 99))}`,
          status: 'ACTIVE',
          programId,
          batchId,
          sectionId,
          academicYearId: org['yearCurrent'] as string,
          admittedOn: demoDate(`${cohort.cohortYear}-07-${String(spread(studentIndex, 3, 5, 25)).padStart(2, '0')}`),
          yearOfAdmission: Number(cohort.cohortYear),
          createdBy: adminUserId,
        },
      });

      students.push({
        key: `stu-${cohort.programKey}-${cohort.cohortYear}-${String(n).padStart(2, '0')}`,
        id: student.id,
        userId: user.id,
        email,
        fullName,
        admissionNumber,
        programKey: cohort.programKey,
        programId,
        batchKey: cohort.batchKey,
        batchId,
        sectionId,
        campusId,
        gender,
        phone,
        cohortYear: cohort.cohortYear,
        semester: cohort.semester,
      });

      // Guardians: father (primary, sometimes with a parent portal account) + mother.
      const fatherName = `${stablePick(GUARDIAN_FIRST_NAMES, studentIndex * 2)} ${last}`;
      const motherName = `${stablePick(GUARDIAN_FIRST_NAMES, studentIndex * 2 + 1)} ${last}`;
      const guardianUser = studentIndex % 3 !== 2
        ? await (async () => {
            const parentEmail = `parent.${admissionNumber.toLowerCase()}@sunrise-demo.edu`;
            const parentUser = await upsertUser(parentEmail, fatherName, `+9196${String(30_000_000 + admissionSequence * 991).slice(0, 8)}`);
            await assignRole(parentUser.id, 'PARENT');
            guardianUsers += 1;
            return parentUser;
          })()
        : null;

      await prisma.guardian.upsert({
        where: { id: demoId(`guardian/${admissionNumber}/father`) },
        update: { name: fatherName, userId: guardianUser?.id ?? null, phone, email: guardianUser?.email ?? null },
        create: {
          id: demoId(`guardian/${admissionNumber}/father`),
          tenantId,
          studentId: student.id,
          userId: guardianUser?.id ?? null,
          name: fatherName,
          kind: 'FATHER',
          role: 'PRIMARY',
          phone,
          email: guardianUser?.email ?? null,
          occupation: stablePick(GUARDIAN_OCCUPATIONS, studentIndex),
          monthlyIncomeCents: spread(studentIndex, 4, 4, 25) * 100_000,
          address: `${spread(studentIndex, 1, 1, 120)}, ${city}, Pune`,
          createdBy: adminUserId,
        },
      });

      await prisma.guardian.upsert({
        where: { id: demoId(`guardian/${admissionNumber}/mother`) },
        update: { name: motherName },
        create: {
          id: demoId(`guardian/${admissionNumber}/mother`),
          tenantId,
          studentId: student.id,
          name: motherName,
          kind: 'MOTHER',
          role: 'SECONDARY',
          phone: `+9195${String(40_000_000 + admissionSequence * 337).slice(0, 8)}`,
          occupation: 'Homemaker',
          createdBy: adminUserId,
        },
      });

      // Enrollment for the current academic year (+ previous-year history for senior cohorts).
      await prisma.studentEnrollment.upsert({
        where: {
          tenantId_studentId_academicYearId_programId: {
            tenantId,
            studentId: student.id,
            academicYearId: org['yearCurrent'] as string,
            programId,
          },
        },
        update: { status: 'ACTIVE', semester: cohort.semester, sectionId, batchId, termId: org['termOddCurrent'] as string },
        create: {
          id: demoId(`enrollment/${admissionNumber}/current`),
          tenantId,
          studentId: student.id,
          academicYearId: org['yearCurrent'] as string,
          termId: org['termOddCurrent'] as string,
          programId,
          sectionId,
          batchId,
          rollNumber: `${cohort.programKey.replace(/[^A-Z]/g, '').slice(0, 3)}${cohort.cohortYear.slice(2)}${String(n).padStart(3, '0')}`,
          semester: cohort.semester,
          status: 'ACTIVE',
          enrolledAt: demoDate(`${cohort.cohortYear}-07-20`),
          createdBy: adminUserId,
        },
      });

      if (cohort.cohortYear !== '2026') {
        await prisma.studentEnrollment.upsert({
          where: {
            tenantId_studentId_academicYearId_programId: {
              tenantId,
              studentId: student.id,
              academicYearId: org['yearPrevious'] as string,
              programId,
            },
          },
          update: { status: 'COMPLETED' },
          create: {
            id: demoId(`enrollment/${admissionNumber}/previous`),
            tenantId,
            studentId: student.id,
            academicYearId: org['yearPrevious'] as string,
            termId: org['termEvenPrevious'] as string,
            programId,
            sectionId,
            batchId,
            semester: cohort.semester - 1,
            status: 'COMPLETED',
            enrolledAt: demoDate('2025-07-20'),
            completedAt: demoDate('2026-06-10'),
            createdBy: adminUserId,
          },
        });
      }

      // Status history + academic history + documents + activity.
      const admittedOn = demoDate(`${cohort.cohortYear}-07-05`);
      await prisma.studentStatusHistory.upsert({
        where: { id: demoId(`status-history/${admissionNumber}/admitted`) },
        update: {},
        create: {
          id: demoId(`status-history/${admissionNumber}/admitted`),
          tenantId,
          studentId: student.id,
          fromStatus: 'APPLICANT',
          toStatus: 'ADMITTED',
          reason: 'Admission offer accepted and admission fee paid',
          changedByUserId: adminUserId,
          changedAt: admittedOn,
        },
      });
      await prisma.studentStatusHistory.upsert({
        where: { id: demoId(`status-history/${admissionNumber}/active`) },
        update: {},
        create: {
          id: demoId(`status-history/${admissionNumber}/active`),
          tenantId,
          studentId: student.id,
          fromStatus: 'ADMITTED',
          toStatus: 'ACTIVE',
          reason: 'Enrolled for the academic year',
          changedByUserId: adminUserId,
          changedAt: demoDate(`${cohort.cohortYear}-07-20`),
        },
      });

      await prisma.studentAcademicRecord.upsert({
        where: { id: demoId(`academic-record/${admissionNumber}/xii`) },
        update: {},
        create: {
          id: demoId(`academic-record/${admissionNumber}/xii`),
          tenantId,
          studentId: student.id,
          institution: stablePick(['St. Xavier\u2019s High School, Pune', 'Fergusson College Junior Wing', 'Modern English School', 'Kendriya Vidyalaya Southern Command'], studentIndex),
          board: 'CBSE',
          yearOfPassing: Number(cohort.cohortYear) - (cohort.programKey === 'MCA' ? 1 : 2),
          percentage: spread(studentIndex, 5, 62, 94),
          isHighestQualification: true,
          verificationStatus: 'VERIFIED',
          createdBy: adminUserId,
        },
      });

      await prisma.studentDocument.upsert({
        where: { id: demoId(`student-document/${admissionNumber}/id`) },
        update: { status: 'VERIFIED' },
        create: {
          id: demoId(`student-document/${admissionNumber}/id`),
          tenantId,
          studentId: student.id,
          category: 'IDENTITY',
          documentName: 'Aadhaar card copy',
          status: 'VERIFIED',
          verifiedAt: created,
          verifiedBy: adminUserId,
          uploadedBy: adminUserId,
        },
      });

      await prisma.studentActivity.upsert({
        where: { id: demoId(`student-activity/${admissionNumber}/enrolled`) },
        update: {},
        create: {
          id: demoId(`student-activity/${admissionNumber}/enrolled`),
          tenantId,
          studentId: student.id,
          eventType: 'ENROLLED',
          title: `Enrolled in ${cohort.programKey} (${cohort.cohortYear} batch)`,
          entityType: 'StudentEnrollment',
          actorUserId: adminUserId,
          occurredAt: demoDate(`${cohort.cohortYear}-07-20`),
        },
      });

      studentIndex += 1;
      admissionSequence += 1;
    }
  }

  // One active financial hold to demonstrate student holds end-to-end.
  const holdStudent = students[students.length - 1];
  if (holdStudent) {
    await prisma.studentHold.upsert({
      where: { id: demoId('student-hold/financial-01') },
      update: { status: 'ACTIVE' },
      create: {
        id: demoId('student-hold/financial-01'),
        tenantId,
        studentId: holdStudent.id,
        type: 'FINANCIAL',
        reason: 'Outstanding first-installment tuition fee',
        placedOn: demoDate('2026-09-25'),
        placedByUserId: staff['accountant']?.userId,
        status: 'ACTIVE',
        createdBy: adminUserId,
      },
    });
  }

  logDemo('people', {
    staff: Object.keys(staff).length,
    faculty: Object.values(staff).filter((s) => s.isFaculty).length,
    students: students.length,
    guardianUsers,
  });

  return { staff, students, guardianUsers };
}

export { ADMIN_EMAIL };
