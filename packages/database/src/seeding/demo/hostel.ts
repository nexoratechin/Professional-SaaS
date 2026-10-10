/**
 * Demo module 10 — hostel: boys' and girls' hostels with buildings/floors/rooms/beds, wardens,
 * checked-in bookings (beds marked occupied), complaints across statuses and visitor logs.
 */
import type { PrismaClient } from '@prisma/client';
import { demoDate, demoDateTime, demoId, logDemo, spread, type DemoContext, type IdMap } from './core';
import type { SeededPeople, SeededStudent } from './people';

export interface HostelInput {
  prisma: PrismaClient;
  ctx: DemoContext;
  org: IdMap;
  people: SeededPeople;
}

export async function seedHostel(input: HostelInput): Promise<{ hostels: number; beds: number; bookings: number }> {
  const { prisma, ctx, org, people } = input;
  const { tenantId, creator } = ctx;
  const id = (segment: string) => demoId(`hostel/${segment}`);
  const hostelFeeHeadId = demoId('fees/head/HOSTEL_RENT');

  const hostelSpecs = [
    {
      key: 'boys',
      code: 'BH-TAGORE',
      name: 'Tagore House — Boys Hostel',
      genderType: 'BOYS' as const,
      wardenKey: 'warden',
      roomsPerFloor: 4,
      roomRent: 450_000,
    },
    {
      key: 'girls',
      code: 'GH-KALPANA',
      name: 'Kalpana House — Girls Hostel',
      genderType: 'GIRLS' as const,
      wardenKey: 'wardenGirls',
      roomsPerFloor: 4,
      roomRent: 500_000,
    },
  ];

  const hostelIds: Record<string, string> = {};
  const bedIds: Record<string, { bedId: string; roomId: string; roomCode: string }[]> = {};
  let bedCount = 0;

  for (const hostelSpec of hostelSpecs) {
    const hostel = await prisma.hostel.upsert({
      where: { tenantId_campusId_code: { tenantId, campusId: org['campusMain'] as string, code: hostelSpec.code } },
      update: { name: hostelSpec.name, feeHeadId: hostelFeeHeadId, isActive: true, updatedBy: creator },
      create: {
        id: id(`hostel/${hostelSpec.key}`),
        tenantId,
        campusId: org['campusMain'] as string,
        code: hostelSpec.code,
        name: hostelSpec.name,
        genderType: hostelSpec.genderType,
        wardenUserId: people.staff[hostelSpec.wardenKey]?.userId,
        description: 'On-campus residence with mess, Wi-Fi and 24x7 security.',
        feeHeadId: hostelFeeHeadId,
        chargeRentOnCheckIn: true,
        createdBy: creator,
      },
    });
    hostelIds[hostelSpec.key] = hostel.id;

    await prisma.hostelWarden.upsert({
      where: {
        tenantId_hostelId_userId_role: {
          tenantId,
          hostelId: hostel.id,
          userId: people.staff[hostelSpec.wardenKey]?.userId as string,
          role: 'WARDEN',
        },
      },
      update: { isActive: true },
      create: {
        id: id(`warden/${hostelSpec.key}`),
        tenantId,
        hostelId: hostel.id,
        userId: people.staff[hostelSpec.key === 'boys' ? 'warden' : 'wardenGirls']?.userId as string,
        role: 'WARDEN',
        assignedBy: creator,
      },
    });

    const building = await prisma.hostelBuilding.upsert({
      where: { tenantId_hostelId_code: { tenantId, hostelId: hostel.id, code: `${hostelSpec.code}-BLK` } },
      update: { isActive: true },
      create: {
        id: id(`building/${hostelSpec.key}`),
        tenantId,
        hostelId: hostel.id,
        code: `${hostelSpec.code}-BLK`,
        name: `${hostelSpec.name} — Main Block`,
        createdBy: creator,
      },
    });

    bedIds[hostelSpec.key] = [];
    for (const floorNumber of [1, 2]) {
      const floor = await prisma.hostelFloor.upsert({
        where: { tenantId_buildingId_floorNumber: { tenantId, buildingId: building.id, floorNumber } },
        update: { isActive: true },
        create: {
          id: id(`floor/${hostelSpec.key}/${floorNumber}`),
          tenantId,
          buildingId: building.id,
          floorNumber,
          name: `Floor ${floorNumber}`,
          createdBy: creator,
        },
      });

      for (let roomNumber = 1; roomNumber <= hostelSpec.roomsPerFloor; roomNumber += 1) {
        const sharing = roomNumber % 3 === 1 ? 'DOUBLE' : roomNumber % 3 === 2 ? 'TRIPLE' : 'DOUBLE';
        const capacity = sharing === 'DOUBLE' ? 2 : 3;
        const roomCode = `${hostelSpec.code}-${floorNumber}${String(roomNumber).padStart(2, '0')}`;
        const room = await prisma.hostelRoom.upsert({
          where: { tenantId_floorId_code: { tenantId, floorId: floor.id, code: roomCode } },
          update: { sharing, bedCapacity: capacity, isActive: true },
          create: {
            id: id(`room/${roomCode}`),
            tenantId,
            floorId: floor.id,
            code: roomCode,
            name: `Room ${roomCode}`,
            sharing,
            bedCapacity: capacity,
            monthlyRentCents: hostelSpec.roomRent,
            hasAttachedBath: roomNumber % 2 === 0,
            createdBy: creator,
          },
        });

        for (let bedIndex = 0; bedIndex < capacity; bedIndex += 1) {
          const bedCode = `${roomCode}-${String.fromCharCode(65 + bedIndex)}`;
          const bed = await prisma.hostelBed.upsert({
            where: { tenantId_roomId_code: { tenantId, roomId: room.id, code: bedCode } },
            update: { isActive: true },
            create: {
              id: id(`bed/${bedCode}`),
              tenantId,
              roomId: room.id,
              code: bedCode,
              status: 'AVAILABLE',
              monthlyRentCents: hostelSpec.roomRent,
            },
          });
          bedIds[hostelSpec.key]?.push({ bedId: bed.id, roomId: room.id, roomCode: room.code });
          bedCount += 1;
        }
      }
    }
  }

  // ------------------------------------------------------------------ bookings
  const boysStudents = people.students.filter((student) => student.gender === 'MALE');
  const girlsStudents = people.students.filter((student) => student.gender === 'FEMALE');
  const bookingSpecs: Array<{ key: string; hostelKey: 'boys' | 'girls'; student: SeededStudent | undefined; bedIndex: number }> = [];
  for (let index = 0; index < 4; index += 1) {
    bookingSpecs.push({ key: `boys-${index + 1}`, hostelKey: 'boys', student: boysStudents[index], bedIndex: index });
    bookingSpecs.push({ key: `girls-${index + 1}`, hostelKey: 'girls', student: girlsStudents[index], bedIndex: index });
  }

  let bookingCount = 0;
  for (const spec of bookingSpecs) {
    const hostel = hostelSpecs.find((hostelSpec) => hostelSpec.key === spec.hostelKey);
    const bed = bedIds[spec.hostelKey]?.[spec.bedIndex];
    if (!spec.student || !bed || !hostel) continue;
    const booking = await prisma.studentHostelBooking.upsert({
      where: { id: id(`booking/${spec.key}`) },
      update: { status: 'CHECKED_IN', bedId: bed.bedId, roomId: bed.roomId },
      create: {
        id: id(`booking/${spec.key}`),
        tenantId,
        studentId: spec.student.id,
        hostelId: hostelIds[spec.hostelKey] as string,
        roomId: bed.roomId,
        bedId: bed.bedId,
        hostelName: hostel.name,
        roomNumber: bed.roomCode,
        bedNumber: bed.bedId.slice(-2),
        allocationDate: demoDate('2026-07-18'),
        checkInDate: demoDate('2026-07-20'),
        status: 'CHECKED_IN',
        monthlyRentCents: hostel.roomRent,
        remarks: 'Allotted during orientation week',
        createdBy: creator,
      },
    });
    void booking;
    await prisma.hostelBed.update({ where: { id: bed.bedId }, data: { status: 'OCCUPIED' } });
    bookingCount += 1;
  }

  // ------------------------------------------------------------------ complaints + visitors
  const boysHostelId = hostelIds['boys'] as string;
  const girlsHostelId = hostelIds['girls'] as string;
  const firstBookingStudent = bookingSpecs[0]?.student;

  const complaints = [
    {
      key: 'water-heater',
      hostelId: boysHostelId,
      student: firstBookingStudent,
      category: 'PLUMBING' as const,
      status: 'RESOLVED' as const,
      priority: 'MEDIUM' as const,
      subject: 'Water heater not working on Floor 2',
      description: 'The geyser in the common bathroom on Floor 2 has been cold since Monday.',
      resolvedAt: '2026-10-01',
      resolvedBy: 'warden',
    },
    {
      key: 'wifi-drop',
      hostelId: girlsHostelId,
      student: girlsStudents[1],
      category: 'INFRASTRUCTURE' as const,
      status: 'IN_PROGRESS' as const,
      priority: 'HIGH' as const,
      subject: 'Wi-Fi drops frequently in the evening',
      description: 'Wi-Fi connectivity becomes unstable after 8 PM in rooms GH-KALPANA-201 and 202.',
      resolvedAt: null,
      resolvedBy: null,
    },
    {
      key: 'mess-food',
      hostelId: boysHostelId,
      student: boysStudents[2],
      category: 'FOOD' as const,
      status: 'OPEN' as const,
      priority: 'LOW' as const,
      subject: 'Request to add a millet option in dinner',
      description: 'Several residents have requested healthier dinner options including millets.',
      resolvedAt: null,
      resolvedBy: null,
    },
  ];
  for (const complaint of complaints) {
    await prisma.hostelComplaint.upsert({
      where: { id: id(`complaint/${complaint.key}`) },
      update: { status: complaint.status },
      create: {
        id: id(`complaint/${complaint.key}`),
        tenantId,
        hostelId: complaint.hostelId,
        studentId: complaint.student?.id,
        category: complaint.category,
        priority: complaint.priority,
        status: complaint.status,
        subject: complaint.subject,
        description: complaint.description,
        assignedToUserId: people.staff['warden']?.userId,
        assignedAt: demoDate('2026-09-30'),
        resolvedByUserId: complaint.resolvedBy ? people.staff[complaint.resolvedBy]?.userId : null,
        resolvedAt: complaint.resolvedAt ? demoDate(complaint.resolvedAt) : null,
        resolutionNotes: complaint.status === 'RESOLVED' ? 'Heating element replaced by the campus electrician.' : null,
        createdBy: creator,
      },
    });
  }

  const visitors = [
    {
      key: 'visitor-1',
      hostelId: boysHostelId,
      student: boysStudents[0],
      name: 'Mr. Rajesh (father of resident)',
      checkIn: '2026-10-09T16:30',
      checkOut: '2026-10-09T18:00',
      status: 'EXITED' as const,
    },
    {
      key: 'visitor-2',
      hostelId: girlsHostelId,
      student: girlsStudents[0],
      name: 'Mrs. Kavita (mother of resident)',
      checkIn: '2026-10-10T11:15',
      checkOut: null,
      status: 'INSIDE' as const,
    },
  ];
  for (const visitor of visitors) {
    await prisma.hostelVisitor.upsert({
      where: { id: id(`visitor/${visitor.key}`) },
      update: { status: visitor.status, checkOutAt: visitor.checkOut ? demoDateTime(visitor.checkOut) : null },
      create: {
        id: id(`visitor/${visitor.key}`),
        tenantId,
        hostelId: visitor.hostelId,
        visitorName: visitor.name,
        phone: `+9193${String(80_000_000 + spread(bedCount, visitor.key.length, 1, 999)).slice(0, 8)}`,
        idProofType: 'Aadhaar',
        idProofNumber: `XXXX-XXXX-${String(1000 + bedCount)}`,
        purpose: 'Family visit',
        studentId: visitor.student?.id,
        visitorLabel: 'PARENT',
        checkInAt: demoDateTime(visitor.checkIn),
        checkOutAt: visitor.checkOut ? demoDateTime(visitor.checkOut) : null,
        status: visitor.status,
        recordedByUserId: people.staff['warden']?.userId,
      },
    });
  }

  logDemo('hostel', {
    hostels: hostelSpecs.length,
    beds: bedCount,
    bookings: bookingCount,
    complaints: complaints.length,
  });

  return { hostels: hostelSpecs.length, beds: bedCount, bookings: bookingCount };
}
