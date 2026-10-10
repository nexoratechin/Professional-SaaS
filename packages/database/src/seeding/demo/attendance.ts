/**
 * Demo module 06 — attendance: biometric device registry, closed class attendance sessions with
 * per-student marks (present/absent/late), one correction request awaiting approval, and a week
 * of faculty attendance.
 */
import type { PrismaClient } from '@prisma/client';
import { addDays, demoDate, demoDateTime, demoId, logDemo, spread, type DemoContext, type IdMap } from './core';
import type { SeededPeople } from './people';
import type { SeededAcademics } from './academics';

export interface AttendanceInput {
  prisma: PrismaClient;
  ctx: DemoContext;
  org: IdMap;
  people: SeededPeople;
  academics: SeededAcademics;
}

export async function seedAttendance(input: AttendanceInput): Promise<{ sessions: number; records: number }> {
  const { prisma, ctx, org, people, academics } = input;
  const { tenantId, creator } = ctx;
  const id = (segment: string) => demoId(`attendance/${segment}`);

  // ------------------------------------------------------------------ devices
  const devices = [
    {
      key: 'gate-face',
      code: 'DEV-MAIN-GATE-01',
      name: 'Main Gate Face Recognition Terminal',
      deviceType: 'FACE_RECOGNITION',
      vendor: 'ZKTeco',
      model: 'SpeedFace-V5L',
      protocol: 'HTTP_PUSH',
      location: 'Main Campus — Main Gate',
      roomKey: null,
    },
    {
      key: 'lab-rfid',
      code: 'DEV-LAB-RFID-01',
      name: 'CS Laboratory RFID Reader',
      deviceType: 'RFID',
      vendor: 'HID',
      model: 'iCLASS SE R40',
      protocol: 'HTTP_PUSH',
      location: 'Block A — CS Laboratory',
      roomKey: 'roomA201',
    },
  ];
  const deviceIds: Record<string, string> = {};
  for (const device of devices) {
    const row = await prisma.attendanceDevice.upsert({
      where: { tenantId_code: { tenantId, code: device.code } },
      update: { name: device.name, status: 'ACTIVE', location: device.location, updatedBy: creator },
      create: {
        id: id(`device/${device.code}`),
        tenantId,
        code: device.code,
        name: device.name,
        deviceType: device.deviceType,
        vendor: device.vendor,
        model: device.model,
        protocol: device.protocol,
        location: device.location,
        roomId: device.roomKey ? (org[device.roomKey] as string) : null,
        status: 'ACTIVE',
        lastSeenAt: demoDateTime('2026-10-10T08:55'),
        lastSyncAt: demoDateTime('2026-10-10T08:56'),
        lastSyncStatus: 'SUCCESS',
        createdBy: creator,
      },
    });
    deviceIds[device.key] = row.id;
  }

  // Map a few members to the RFID reader to demonstrate device mappings.
  const deviceStudents = people.students.slice(0, 3);
  for (const [index, student] of deviceStudents.entries()) {
    await prisma.attendanceDeviceUser.upsert({
      where: {
        tenantId_deviceId_externalPersonId: {
          tenantId,
          deviceId: deviceIds['lab-rfid'] as string,
          externalPersonId: `RFID-${student.admissionNumber}`,
        },
      },
      update: { isActive: true },
      create: {
        id: id(`device-user/${student.admissionNumber}`),
        tenantId,
        deviceId: deviceIds['lab-rfid'] as string,
        externalPersonId: `RFID-${student.admissionNumber}`,
        mappedType: 'STUDENT',
        studentId: student.id,
        label: student.fullName,
        createdBy: creator,
      },
    });
    void index;
  }
  for (const staffKey of ['fac-cse1', 'librarian']) {
    const member = people.staff[staffKey];
    if (!member) continue;
    await prisma.attendanceDeviceUser.upsert({
      where: {
        tenantId_deviceId_externalPersonId: {
          tenantId,
          deviceId: deviceIds['gate-face'] as string,
          externalPersonId: `EMP-${member.userId.slice(0, 8)}`,
        },
      },
      update: { isActive: true },
      create: {
        id: id(`device-user/${staffKey}`),
        tenantId,
        deviceId: deviceIds['gate-face'] as string,
        externalPersonId: `EMP-${member.userId.slice(0, 8)}`,
        mappedType: 'STAFF',
        userId: member.userId,
        label: member.fullName,
        createdBy: creator,
      },
    });
  }

  // ------------------------------------------------------------------ class sessions
  const classDates = ['2026-09-28', '2026-10-05', '2026-10-07'];
  let sessionCount = 0;
  let recordCount = 0;
  let firstAttendanceRecordId: string | null = null;
  let firstSessionId: string | null = null;

  for (const [offeringIndex, offering] of academics.offerings.entries()) {
    for (const [dateIndex, day] of classDates.entries()) {
      const sessionKey = `${offering.code}/${day}`;
      const session = await prisma.attendanceSession.upsert({
        where: { id: id(`session/${sessionKey}`) },
        update: { status: 'CLOSED', closedAt: demoDateTime(`${day}T10:05`), updatedBy: creator },
        create: {
          id: id(`session/${sessionKey}`),
          tenantId,
          termId: org['termOddCurrent'] as string,
          courseOfferingId: offering.id,
          sectionId: offering.sectionId,
          date: demoDate(day),
          startTime: '09:00',
          endTime: '10:00',
          attendanceType: 'CLASS',
          subjectCode: offering.courseCode,
          subjectName: offering.courseName,
          title: `${offering.courseCode} lecture`,
          status: 'CLOSED',
          markedByUserId: offering.facultyUserId,
          createdBy: creator,
          closedAt: demoDateTime(`${day}T10:05`),
        },
      });
      sessionCount += 1;
      firstSessionId ??= session.id;

      for (const [studentIndex, studentId] of offering.studentIds.entries()) {
        const roll = spread(studentIndex + 1, dateIndex + 1, 0, 10);
        const status = roll === 0 ? 'ABSENT' : roll === 1 ? 'LATE' : 'PRESENT';
        const record = await prisma.studentAttendance.upsert({
          where: {
            tenantId_sessionId_studentId: { tenantId, sessionId: session.id, studentId },
          },
          update: { status, attendanceType: 'CLASS' },
          create: {
            id: id(`record/${sessionKey}/${studentId}`),
            tenantId,
            studentId,
            sessionId: session.id,
            date: demoDate(day),
            attendanceType: 'CLASS',
            termId: org['termOddCurrent'] as string,
            subjectCode: offering.courseCode,
            subjectName: offering.courseName,
            status,
            markMethod: studentIndex < 3 && offeringIndex === 0 ? 'BIOMETRIC' : 'MANUAL',
            signInAt: status === 'PRESENT' ? demoDateTime(`${day}T08:5${studentIndex % 9}`) : status === 'LATE' ? demoDateTime(`${day}T09:12`) : null,
            markedByUserId: offering.facultyUserId,
          },
        });
        recordCount += 1;
        firstAttendanceRecordId ??= record.id;
      }
    }
  }

  // One pending correction request (absent marked, student contests it).
  const correctionStudent = people.students[0];
  if (correctionStudent && firstSessionId && firstAttendanceRecordId) {
    await prisma.attendanceCorrectionRequest.upsert({
      where: { id: id('correction/1') },
      update: { status: 'PENDING' },
      create: {
        id: id('correction/1'),
        tenantId,
        studentId: correctionStudent.id,
        sessionId: firstSessionId,
        attendanceRecordId: firstAttendanceRecordId,
        fromStatus: 'ABSENT',
        toStatus: 'PRESENT',
        reason: 'Was present in class; biometric missed my entry.',
        status: 'PENDING',
        requestedByUserId: correctionStudent.userId,
      },
    });
  }

  // ------------------------------------------------------------------ faculty attendance
  const facultyMembers = Object.values(people.staff).filter((member) => member.isFaculty);
  const facultyDates = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'];
  let facultyRecords = 0;
  for (const [memberIndex, member] of facultyMembers.entries()) {
    for (const [dateIndex, day] of facultyDates.entries()) {
      const status = memberIndex === 2 && dateIndex === 1 ? 'LEAVE' : 'PRESENT';
      await prisma.facultyAttendance.upsert({
        where: { tenantId_userId_date: { tenantId, userId: member.userId, date: demoDate(day) } },
        update: { status, markMethod: 'BIOMETRIC' },
        create: {
          id: id(`faculty/${member.key}/${day}`),
          tenantId,
          userId: member.userId,
          date: demoDate(day),
          checkInAt: status === 'PRESENT' ? demoDateTime(`${day}T08:4${memberIndex % 9}`) : null,
          checkOutAt: status === 'PRESENT' ? demoDateTime(`${day}T17:1${memberIndex % 9}`) : null,
          status,
          markMethod: 'BIOMETRIC',
          markedByUserId: creator,
        },
      });
      facultyRecords += 1;
    }
  }

  void addDays;
  logDemo('attendance', {
    devices: devices.length,
    sessions: sessionCount,
    studentRecords: recordCount,
    facultyRecords,
  });

  return { sessions: sessionCount, records: recordCount };
}
