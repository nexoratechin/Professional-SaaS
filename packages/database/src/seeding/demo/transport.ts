/**
 * Demo module 11 — transport: routes with ordered stops, vehicles with statutory documents,
 * drivers with vehicle assignments, today's (and one completed) trip with stop timings, student
 * transport passes, maintenance records, GPS configuration and an active delay alert.
 */
import type { PrismaClient } from '@prisma/client';
import { demoDate, demoDateTime, demoId, logDemo, spread, type DemoContext, type IdMap } from './core';
import type { SeededPeople } from './people';

export interface TransportInput {
  prisma: PrismaClient;
  ctx: DemoContext;
  org: IdMap;
  people: SeededPeople;
}

export async function seedTransport(input: TransportInput): Promise<{ routes: number; vehicles: number; passes: number }> {
  const { prisma, ctx, org, people } = input;
  const { tenantId, creator } = ctx;
  const id = (segment: string) => demoId(`transport/${segment}`);
  const transportManagerUserId = people.staff['transportManager']?.userId;

  // ------------------------------------------------------------------ routes + stops
  const routeSpecs = [
    {
      key: 'r1',
      code: 'R1-KOTHRUD',
      name: 'Route 1 — Kothrud / Karve Nagar',
      distanceKm: 14.5,
      durationMin: 45,
      monthlyFeeCents: 250_000,
      stops: [
        { name: 'Kothrud Depot', time: '07:10', lat: 18.5074, lng: 73.8077 },
        { name: 'Karve Nagar Chowk', time: '07:22', lat: 18.4903, lng: 73.8212 },
        { name: 'Warje Bridge', time: '07:35', lat: 18.4839, lng: 73.7992 },
        { name: 'Main Campus Gate', time: '07:55', lat: 18.5591, lng: 73.7898 },
      ],
    },
    {
      key: 'r2',
      code: 'R2-WAKAD',
      name: 'Route 2 — Wakad / Hinjewadi',
      distanceKm: 21.0,
      durationMin: 60,
      monthlyFeeCents: 300_000,
      stops: [
        { name: 'Wakad Bridge', time: '06:55', lat: 18.5975, lng: 73.7625 },
        { name: 'Hinjewadi Phase 1', time: '07:08', lat: 18.5913, lng: 73.7389 },
        { name: 'Balewadi Stadium', time: '07:30', lat: 18.5745, lng: 73.7675 },
        { name: 'Main Campus Gate', time: '07:55', lat: 18.5591, lng: 73.7898 },
      ],
    },
    {
      key: 'r3',
      code: 'R3-CITY',
      name: 'Route 3 — Shivaji Nagar / City Campus',
      distanceKm: 6.5,
      durationMin: 25,
      monthlyFeeCents: 180_000,
      stops: [
        { name: 'Deccan Gymkhana', time: '08:00', lat: 18.5167, lng: 73.8417 },
        { name: 'FC Road', time: '08:10', lat: 18.5236, lng: 73.8446 },
        { name: 'City Campus Gate', time: '08:25', lat: 18.5308, lng: 73.8478 },
      ],
    },
  ];

  const routeIds: Record<string, string> = {};
  const stopIds: Record<string, string[]> = {};
  for (const route of routeSpecs) {
    const row = await prisma.transportRoute.upsert({
      where: { tenantId_code: { tenantId, code: route.code } },
      update: {
        name: route.name,
        distanceKm: route.distanceKm,
        estimatedDurationMin: route.durationMin,
        monthlyFeeCents: route.monthlyFeeCents,
        status: 'ACTIVE',
        isActive: true,
        updatedBy: creator,
      },
      create: {
        id: id(`route/${route.code}`),
        tenantId,
        campusId: route.key === 'r3' ? (org['campusCity'] as string) : (org['campusMain'] as string),
        code: route.code,
        name: route.name,
        status: 'ACTIVE',
        distanceKm: route.distanceKm,
        estimatedDurationMin: route.durationMin,
        monthlyFeeCents: route.monthlyFeeCents,
        description: 'Morning pickup and evening drop on all working days.',
        createdBy: creator,
      },
    });
    routeIds[route.key] = row.id;
    stopIds[route.key] = [];
    for (const [index, stop] of route.stops.entries()) {
      const stopRow = await prisma.transportStop.upsert({
        where: { tenantId_routeId_order: { tenantId, routeId: row.id, order: index + 1 } },
        update: { name: stop.name, pickupTime: stop.time },
        create: {
          id: id(`stop/${route.code}/${index + 1}`),
          tenantId,
          routeId: row.id,
          name: stop.name,
          order: index + 1,
          type: 'PICKUP_AND_DROP',
          address: `${stop.name}, Pune`,
          latitude: stop.lat,
          longitude: stop.lng,
          pickupTime: stop.time,
          dropTime: `17:${String(10 + index * 12).padStart(2, '0')}`,
          reachRadiusMeters: 50,
          createdBy: creator,
        },
      });
      stopIds[route.key]?.push(stopRow.id);
    }
  }

  // ------------------------------------------------------------------ vehicles + documents
  const vehicleSpecs = [
    { key: 'bus1', registration: 'MH12-PA-4501', type: 'BUS' as const, make: 'Tata', model: 'Starbus Ultra', year: 2022, capacity: 48, routeKey: 'r1' },
    { key: 'bus2', registration: 'MH12-PB-7788', type: 'BUS' as const, make: 'Ashok Leyland', model: 'Sunshine', year: 2021, capacity: 52, routeKey: 'r2' },
    { key: 'van1', registration: 'MH12-VC-2202', type: 'VAN' as const, make: 'Force', model: 'Urbania', year: 2023, capacity: 17, routeKey: 'r3' },
  ];
  const vehicleIds: Record<string, string> = {};
  for (const vehicle of vehicleSpecs) {
    const row = await prisma.transportVehicle.upsert({
      where: { tenantId_registrationNumber: { tenantId, registrationNumber: vehicle.registration } },
      update: { status: 'IN_SERVICE', updatedBy: creator },
      create: {
        id: id(`vehicle/${vehicle.registration}`),
        tenantId,
        campusId: org['campusMain'] as string,
        type: vehicle.type,
        registrationNumber: vehicle.registration,
        chassisNumber: `CHS-${vehicle.registration.replace(/[^A-Z0-9]/g, '')}`,
        engineNumber: `ENG-${vehicle.registration.replace(/[^A-Z0-9]/g, '')}`,
        make: vehicle.make,
        model: vehicle.model,
        yearOfManufacture: vehicle.year,
        fuelType: 'DIESEL',
        seatingCapacity: vehicle.capacity,
        gpsDeviceId: `GPS-${vehicle.registration.replace(/[^A-Z0-9]/g, '')}`,
        status: 'IN_SERVICE',
        createdBy: creator,
      },
    });
    vehicleIds[vehicle.key] = row.id;

    const documents = [
      { type: 'REGISTRATION' as const, number: `RC-${vehicle.registration}`, expiry: '2031-06-30', status: 'VALID' as const },
      { type: 'INSURANCE' as const, number: `INS-${vehicle.registration}-2026`, expiry: '2027-03-31', status: 'VALID' as const },
      { type: 'FITNESS' as const, number: `FIT-${vehicle.registration}-2026`, expiry: '2027-01-15', status: 'VALID' as const },
      { type: 'POLLUTION' as const, number: `PUC-${vehicle.registration}-2026`, expiry: '2026-12-31', status: 'EXPIRING_SOON' as const },
    ];
    for (const document of documents) {
      await prisma.transportVehicleDocument.upsert({
        where: { id: id(`vehicle-document/${vehicle.registration}/${document.type}`) },
        update: { status: document.status, expiryDate: demoDate(document.expiry) },
        create: {
          id: id(`vehicle-document/${vehicle.registration}/${document.type}`),
          tenantId,
          vehicleId: row.id,
          documentType: document.type,
          documentNumber: document.number,
          issueDate: demoDate('2026-04-01'),
          expiryDate: demoDate(document.expiry),
          issuer: 'RTO Pune',
          status: document.status,
          createdBy: creator,
        },
      });
    }
  }

  // ------------------------------------------------------------------ drivers + assignments
  const driverSpecs = [
    { key: 'd1', name: 'Ramesh Jadhav', phone: '+919812300011', license: 'MH12-2016-0012345', vehicleKey: 'bus1', routeKey: 'r1' },
    { key: 'd2', name: 'Santosh More', phone: '+919812300022', license: 'MH12-2014-0023456', vehicleKey: 'bus2', routeKey: 'r2' },
    { key: 'd3', name: 'Imran Shaikh', phone: '+919812300033', license: 'MH12-2019-0034567', vehicleKey: 'van1', routeKey: 'r3' },
  ];
  const driverIds: Record<string, string> = {};
  for (const driver of driverSpecs) {
    const row = await prisma.transportDriver.upsert({
      where: { tenantId_licenseNumber: { tenantId, licenseNumber: driver.license } },
      update: { status: 'ACTIVE', phone: driver.phone },
      create: {
        id: id(`driver/${driver.license}`),
        tenantId,
        name: driver.name,
        phone: driver.phone,
        licenseNumber: driver.license,
        licenseClass: 'HMV',
        licenseExpiry: demoDate('2029-08-31'),
        joinedAt: demoDate('2021-06-01'),
        status: 'ACTIVE',
        createdBy: creator,
      },
    });
    driverIds[driver.key] = row.id;

    await prisma.transportDriverAssignment.upsert({
      where: { id: id(`driver-assignment/${driver.key}`) },
      update: { isActive: true },
      create: {
        id: id(`driver-assignment/${driver.key}`),
        tenantId,
        driverId: row.id,
        vehicleId: vehicleIds[driver.vehicleKey] as string,
        isActive: true,
        assignedAt: demoDate('2026-07-01'),
        createdBy: creator,
      },
    });
  }

  // ------------------------------------------------------------------ trips (today + one completed yesterday)
  const tripSpecs = [
    { key: 'today-r1', routeKey: 'r1', driverKey: 'd1', date: '2026-10-10', status: 'ONGOING' as const, actualDeparture: '07:08', actualArrival: null },
    { key: 'today-r2', routeKey: 'r2', driverKey: 'd2', date: '2026-10-10', status: 'SCHEDULED' as const, actualDeparture: null, actualArrival: null },
    { key: 'today-r3', routeKey: 'r3', driverKey: 'd3', date: '2026-10-10', status: 'SCHEDULED' as const, actualDeparture: null, actualArrival: null },
    { key: 'yesterday-r1', routeKey: 'r1', driverKey: 'd1', date: '2026-10-09', status: 'COMPLETED' as const, actualDeparture: '07:10', actualArrival: '08:02' },
  ];
  for (const trip of tripSpecs) {
    const route = routeSpecs.find((candidate) => candidate.key === trip.routeKey);
    const vehicle = vehicleSpecs.find((candidate) => candidate.routeKey === trip.routeKey);
    if (!route || !vehicle) continue;
    const row = await prisma.transportTrip.upsert({
      where: { tenantId_routeId_date: { tenantId, routeId: routeIds[trip.routeKey] as string, date: demoDate(trip.date) } },
      update: { status: trip.status, actualDepartureAt: trip.actualDeparture ? demoDateTime(`${trip.date}T${trip.actualDeparture}`) : null },
      create: {
        id: id(`trip/${trip.key}`),
        tenantId,
        routeId: routeIds[trip.routeKey] as string,
        vehicleId: vehicleIds[vehicle.key] as string,
        driverId: driverIds[trip.driverKey] as string,
        date: demoDate(trip.date),
        status: trip.status,
        scheduledDeparture: demoDateTime(`${trip.date}T07:00`),
        scheduledArrival: demoDateTime(`${trip.date}T08:00`),
        actualDepartureAt: trip.actualDeparture ? demoDateTime(`${trip.date}T${trip.actualDeparture}`) : null,
        actualArrivalAt: trip.actualArrival ? demoDateTime(`${trip.date}T${trip.actualArrival}`) : null,
        distanceKm: route.distanceKm,
        createdBy: creator,
      },
    });

    for (const [index, stopId] of (stopIds[trip.routeKey] ?? []).entries()) {
      const stopSpec = route.stops[index];
      await prisma.transportTripStop.upsert({
        where: { id: id(`trip-stop/${trip.key}/${index + 1}`) },
        update: {},
        create: {
          id: id(`trip-stop/${trip.key}/${index + 1}`),
          tenantId,
          tripId: row.id,
          stopId,
          order: index + 1,
          scheduledTime: demoDateTime(`${trip.date}T${stopSpec?.time ?? '07:30'}`),
          actualArrivalAt: trip.status === 'COMPLETED' ? demoDateTime(`${trip.date}T${stopSpec?.time ?? '07:30'}`) : null,
          actualDepartureAt: trip.status === 'COMPLETED' ? demoDateTime(`${trip.date}T${stopSpec?.time ?? '07:30'}`) : null,
          studentsBoarded: trip.status === 'COMPLETED' ? spread(index, 4, 3, 12) : 0,
        },
      });
    }
  }

  // ------------------------------------------------------------------ passes
  const passStudents = people.students.slice(0, 6);
  let passCount = 0;
  for (const [index, student] of passStudents.entries()) {
    const route = routeSpecs[index % routeSpecs.length];
    if (!route) continue;
    const vehicle = vehicleSpecs.find((candidate) => candidate.routeKey === route.key);
    const driver = driverSpecs.find((candidate) => candidate.routeKey === route.key);
    const stopIndex = Math.min(index % (route.stops.length - 1), route.stops.length - 2);
    const pickupStop = route.stops[stopIndex];
    const dropStop = route.stops[route.stops.length - 1];
    if (!vehicle || !driver || !pickupStop || !dropStop) continue;
    await prisma.studentTransportPass.upsert({
      where: { id: id(`pass/${student.admissionNumber}`) },
      update: { status: 'ACTIVE' },
      create: {
        id: id(`pass/${student.admissionNumber}`),
        tenantId,
        studentId: student.id,
        routeId: routeIds[route.key] as string,
        stopId: stopIds[route.key]?.[stopIndex],
        dropStopId: stopIds[route.key]?.[route.stops.length - 1],
        vehicleId: vehicleIds[vehicle.key] as string,
        driverId: driverIds[driver.key] as string,
        routeCode: route.code,
        routeName: route.name,
        pickupPoint: pickupStop.name,
        dropPoint: dropStop.name,
        vehicleNumber: vehicle.registration,
        periodStart: demoDate('2026-07-15'),
        periodEnd: demoDate('2027-04-30'),
        status: 'ACTIVE',
        amountCents: route.monthlyFeeCents * 10,
        dailyPickupTime: pickupStop.time,
        dailyDropTime: dropStop.time,
        issuedOn: demoDate('2026-07-12'),
        issuedByUserId: transportManagerUserId,
        createdBy: creator,
      },
    });
    passCount += 1;
  }

  // ------------------------------------------------------------------ maintenance + gps + alerts
  const maintenanceRecords = [
    {
      key: 'service-bus1',
      vehicleKey: 'bus1',
      type: 'PREVENTIVE' as const,
      status: 'COMPLETED' as const,
      scheduled: '2026-09-20',
      completed: '2026-09-21',
      odometer: 48210,
      cost: 1_850_000,
      description: 'Periodic service — engine oil, filters, brake inspection',
    },
    {
      key: 'service-bus2',
      vehicleKey: 'bus2',
      type: 'CORRECTIVE' as const,
      status: 'SCHEDULED' as const,
      scheduled: '2026-10-18',
      completed: null,
      odometer: 51980,
      cost: null,
      description: 'Rear suspension noise — inspection and repair',
    },
  ];
  for (const record of maintenanceRecords) {
    await prisma.transportMaintenanceRecord.upsert({
      where: { id: id(`maintenance/${record.key}`) },
      update: { status: record.status },
      create: {
        id: id(`maintenance/${record.key}`),
        tenantId,
        vehicleId: vehicleIds[record.vehicleKey] as string,
        type: record.type,
        status: record.status,
        scheduledDate: demoDate(record.scheduled),
        startedAt: record.status === 'COMPLETED' ? demoDate(record.scheduled) : null,
        completedAt: record.completed ? demoDate(record.completed) : null,
        odometerKm: record.odometer,
        description: record.description,
        vendor: 'Shree Auto Works, Pune',
        costCents: record.cost,
        performedBy: 'Shree Auto Works',
        createdBy: creator,
      },
    });
  }

  await prisma.transportGpsConfig.upsert({
    where: { tenantId },
    update: {},
    create: {
      id: id('gps-config'),
      tenantId,
      provider: 'mock',
      enabled: false,
      pollEnabled: false,
      pollIntervalSeconds: 30,
      settings: { note: 'Enable with a real provider in production' },
      createdBy: creator,
    },
  });

  await prisma.transportAlert.upsert({
    where: { id: id('alert/delay-r1') },
    update: { resolvedAt: null },
    create: {
      id: id('alert/delay-r1'),
      tenantId,
      vehicleId: vehicleIds['bus1'] as string,
      tripId: demoId('transport/trip/today-r1'),
      type: 'DELAYED',
      severity: 'WARNING',
      title: 'Route 1 running ~12 minutes late',
      message: 'Heavy traffic at Karve Nagar Chowk — expected arrival 08:07 instead of 07:55.',
      latitude: 18.4903,
      longitude: 73.8212,
      meta: { routeCode: 'R1-KOTHRUD', delayMinutes: 12 },
      acknowledgedAt: demoDateTime('2026-10-10T07:40'),
      acknowledgedByUserId: transportManagerUserId,
    },
  });

  logDemo('transport', {
    routes: routeSpecs.length,
    stops: routeSpecs.reduce((sum, route) => sum + route.stops.length, 0),
    vehicles: vehicleSpecs.length,
    drivers: driverSpecs.length,
    trips: tripSpecs.length,
    passes: passCount,
  });

  return { routes: routeSpecs.length, vehicles: vehicleSpecs.length, passes: passCount };
}
