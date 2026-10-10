/**
 * Demo module 14 — helpdesk: support departments, ticket categories, SLA policies and a spread of
 * tickets across statuses with comments, history, escalation and satisfaction feedback.
 */
import type { PrismaClient } from '@prisma/client';
import { demoDateTime, demoId, logDemo, spread, type DemoContext, type IdMap } from './core';
import type { SeededPeople } from './people';

export interface HelpdeskInput {
  prisma: PrismaClient;
  ctx: DemoContext;
  org: IdMap;
  people: SeededPeople;
}

export async function seedHelpdesk(input: HelpdeskInput): Promise<{ tickets: number; resolved: number }> {
  const { prisma, ctx, org, people } = input;
  const { tenantId, creator } = ctx;
  const id = (segment: string) => demoId(`helpdesk/${segment}`);
  const itStaff = people.staff['campusAdmin']?.userId;
  const accountantUserId = people.staff['accountant']?.userId;

  await prisma.helpdeskSequence.upsert({
    where: { tenantId_kind: { tenantId, kind: 'TICKET' } },
    update: { nextValue: 20 },
    create: {
      id: id('sequence/ticket'),
      tenantId,
      kind: 'TICKET',
      prefix: 'HD-2026',
      nextValue: 20,
    },
  });

  const departmentSpecs = [
    { key: 'deptIt', code: 'IT_SUPPORT', name: 'IT Support', email: 'it.support@sunrise-demo.edu' },
    { key: 'deptMaint', code: 'MAINTENANCE', name: 'Campus Maintenance', email: 'maintenance@sunrise-demo.edu' },
    { key: 'deptAccounts', code: 'ACCOUNTS', name: 'Accounts & Fees', email: 'accounts@sunrise-demo.edu' },
    { key: 'deptAcademic', code: 'ACADEMIC', name: 'Academic Office', email: 'academics@sunrise-demo.edu' },
  ];
  const departmentIds: Record<string, string> = {};
  for (const department of departmentSpecs) {
    const row = await prisma.helpdeskDepartment.upsert({
      where: { tenantId_code: { tenantId, code: department.code } },
      update: { name: department.name, email: department.email, isActive: true },
      create: {
        id: id(`department/${department.code}`),
        tenantId,
        code: department.code,
        name: department.name,
        email: department.email,
        campusId: org['campusMain'] as string,
        createdBy: creator,
      },
    });
    departmentIds[department.key] = row.id;
  }

  const slaSpecs = [
    {
      key: 'slaIt',
      code: 'SLA-IT',
      name: 'IT Support SLA',
      department: 'deptIt',
      responseMinutes: 60,
      resolutionMinutes: 480,
      atRiskMinutes: 360,
      escalateAfterMinutes: 480,
      isDefault: false,
    },
    {
      key: 'slaGeneral',
      code: 'SLA-GENERAL',
      name: 'General Campus SLA',
      department: null,
      responseMinutes: 240,
      resolutionMinutes: 1440,
      atRiskMinutes: 1080,
      escalateAfterMinutes: 1440,
      isDefault: true,
    },
    {
      key: 'slaFinance',
      code: 'SLA-FINANCE',
      name: 'Fees & Accounts SLA',
      department: 'deptAccounts',
      responseMinutes: 120,
      resolutionMinutes: 720,
      atRiskMinutes: 540,
      escalateAfterMinutes: 720,
      isDefault: false,
    },
  ] as const;
  const slaIds: Record<string, string> = {};
  for (const sla of slaSpecs) {
    const row = await prisma.helpdeskSlaPolicy.upsert({
      where: { tenantId_code: { tenantId, code: sla.code } },
      update: { name: sla.name, isActive: true },
      create: {
        id: id(`sla/${sla.code}`),
        tenantId,
        code: sla.code,
        name: sla.name,
        description: 'Response and resolution targets for this support queue',
        priority: sla.key === 'slaIt' ? 'HIGH' : null,
        departmentId: sla.department ? (departmentIds[sla.department] as string) : null,
        responseMinutes: sla.responseMinutes,
        resolutionMinutes: sla.resolutionMinutes,
        atRiskMinutes: sla.atRiskMinutes,
        escalateToRoleCode: 'TENANT_ADMIN',
        escalateAfterMinutes: sla.escalateAfterMinutes,
        isDefault: sla.isDefault,
        createdBy: creator,
      },
    });
    slaIds[sla.key] = row.id;
  }

  const categorySpecs = [
    { key: 'catNetwork', code: 'IT-NETWORK', name: 'Network / Wi-Fi', priority: 'HIGH' as const, department: 'deptIt', sla: 'slaIt', requiresApproval: false },
    { key: 'catProjector', code: 'IT-AV', name: 'Classroom Projector / AV', priority: 'MEDIUM' as const, department: 'deptIt', sla: 'slaIt', requiresApproval: false },
    { key: 'catFeeQuery', code: 'FEE-QUERY', name: 'Fee query or receipt issue', priority: 'MEDIUM' as const, department: 'deptAccounts', sla: 'slaFinance', requiresApproval: false },
    { key: 'catFeeRefund', code: 'FEE-REFUND', name: 'Refund request', priority: 'HIGH' as const, department: 'deptAccounts', sla: 'slaFinance', requiresApproval: true },
    { key: 'catHostelFacility', code: 'HOSTEL-FACILITY', name: 'Hostel facility complaint', priority: 'MEDIUM' as const, department: 'deptMaint', sla: 'slaGeneral', requiresApproval: false },
    { key: 'catLibraryBook', code: 'LIB-BOOK', name: 'Library book request', priority: 'LOW' as const, department: 'deptAcademic', sla: 'slaGeneral', requiresApproval: false },
  ];
  const categoryIds: Record<string, string> = {};
  for (const category of categorySpecs) {
    const row = await prisma.helpdeskCategory.upsert({
      where: { tenantId_code: { tenantId, code: category.code } },
      update: { name: category.name, isActive: true },
      create: {
        id: id(`category/${category.code}`),
        tenantId,
        code: category.code,
        name: category.name,
        defaultPriority: category.priority,
        defaultDepartmentId: departmentIds[category.department] as string,
        slaPolicyId: slaIds[category.sla] as string,
        requiresApproval: category.requiresApproval,
        sequenceOrder: categorySpecs.indexOf(category),
        createdBy: creator,
      },
    });
    categoryIds[category.key] = row.id;
  }

  interface TicketSpec {
    key: string;
    number: number;
    subject: string;
    description: string;
    category: string;
    priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' | 'CRITICAL';
    status: 'NEW' | 'OPEN' | 'IN_PROGRESS' | 'PENDING' | 'RESOLVED' | 'CLOSED' | 'REOPENED';
    source: 'WEB' | 'EMAIL' | 'PHONE' | 'WALK_IN';
    requester: { kind: 'student'; index: number } | { kind: 'staff'; key: string };
    assignedTo: 'it' | 'accounts' | 'maint' | 'academic' | null;
    createdAt: string;
    firstResponseAt: string | null;
    resolvedAt: string | null;
    closedAt: string | null;
    satisfaction?: { score: number; comment: string };
  }

  const yesterday = '2026-10-09';
  const ticketSpecs: TicketSpec[] = [
    {
      key: 't1', number: 1, subject: 'Wi-Fi keeps disconnecting in Block A classrooms',
      description: 'Sessions drop every few minutes on the first floor of Block A. Affects online quizzes during lecture hours.',
      category: 'catNetwork', priority: 'HIGH', status: 'IN_PROGRESS', source: 'WEB',
      requester: { kind: 'student', index: 0 }, assignedTo: 'it', createdAt: '2026-10-07', firstResponseAt: '2026-10-07', resolvedAt: null, closedAt: null,
    },
    {
      key: 't2', number: 2, subject: 'Projector in A-202 does not power on',
      description: 'The projector remote is unresponsive and the standby light does not glow before the morning lecture.',
      category: 'catProjector', priority: 'HIGH', status: 'RESOLVED', source: 'PHONE',
      requester: { kind: 'staff', key: 'fac-ece1' }, assignedTo: 'it', createdAt: '2026-10-02', firstResponseAt: '2026-10-02', resolvedAt: '2026-10-03', closedAt: null,
      satisfaction: { score: 5, comment: 'Fixed before the next lecture — excellent response.' },
    },
    {
      key: 't3', number: 3, subject: 'Duplicate transport fee charged for September',
      description: 'Two transport fee entries appear on my September demand. Requesting adjustment and updated receipt.',
      category: 'catFeeQuery', priority: 'MEDIUM', status: 'RESOLVED', source: 'WEB',
      requester: { kind: 'student', index: 2 }, assignedTo: 'accounts', createdAt: '2026-09-28', firstResponseAt: '2026-09-28', resolvedAt: '2026-09-30', closedAt: '2026-10-01',
      satisfaction: { score: 4, comment: 'Corrected quickly; a small delay in the revised receipt.' },
    },
    {
      key: 't4', number: 4, subject: 'Refund request — cancelled hostel allotment',
      description: 'Hostel allotment was cancelled on 20 September; requesting refund of the September rent already paid.',
      category: 'catFeeRefund', priority: 'HIGH', status: 'PENDING', source: 'EMAIL',
      requester: { kind: 'student', index: 3 }, assignedTo: 'accounts', createdAt: '2026-09-25', firstResponseAt: '2026-09-26', resolvedAt: null, closedAt: null,
    },
    {
      key: 't5', number: 5, subject: 'Hot water not available in hostel bathrooms',
      description: 'Geysers on the second floor of Tagore House remain cold since Monday.',
      category: 'catHostelFacility', priority: 'URGENT', status: 'CLOSED', source: 'WALK_IN',
      requester: { kind: 'student', index: 4 }, assignedTo: 'maint', createdAt: '2026-09-26', firstResponseAt: '2026-09-26', resolvedAt: '2026-09-28', closedAt: '2026-09-29',
      satisfaction: { score: 3, comment: 'Resolved, but took two follow-ups.' },
    },
    {
      key: 't6', number: 6, subject: 'Request to add advanced algorithms textbook to the library',
      description: 'Suggesting the purchase of two more copies of Advanced Algorithms for the 5th semester elective.',
      category: 'catLibraryBook', priority: 'LOW', status: 'OPEN', source: 'WEB',
      requester: { kind: 'student', index: 5 }, assignedTo: 'academic', createdAt: '2026-10-06', firstResponseAt: null, resolvedAt: null, closedAt: null,
    },
    {
      key: 't7', number: 7, subject: 'Lab printer not reachable from student VLAN',
      description: 'Print jobs from the CSE laboratory VLAN queue but never print. Works from staff machines.',
      category: 'catNetwork', priority: 'MEDIUM', status: 'NEW', source: 'EMAIL',
      requester: { kind: 'staff', key: 'fac-cse2' }, assignedTo: null, createdAt: yesterday, firstResponseAt: null, resolvedAt: null, closedAt: null,
    },
    {
      key: 't8', number: 8, subject: 'ID card reissue after loss',
      description: 'Lost my student ID card near the sports complex. Applying for a reissue with FIR copy attached.',
      category: 'catFeeQuery', priority: 'LOW', status: 'OPEN', source: 'WALK_IN',
      requester: { kind: 'student', index: 6 }, assignedTo: 'accounts', createdAt: '2026-10-08', firstResponseAt: '2026-10-08', resolvedAt: null, closedAt: null,
    },
    {
      key: 't9', number: 9, subject: 'Same projector issue returned in A-202',
      description: 'Projector shut down mid-lecture again after the earlier repair.',
      category: 'catProjector', priority: 'HIGH', status: 'REOPENED', source: 'PHONE',
      requester: { kind: 'staff', key: 'fac-ece1' }, assignedTo: 'it', createdAt: '2026-10-05', firstResponseAt: '2026-10-05', resolvedAt: null, closedAt: null,
    },
    {
      key: 't10', number: 10, subject: 'Fee receipt not received for UPI payment',
      description: 'Paid the first installment through UPI; the receipt has not appeared in the portal.',
      category: 'catFeeQuery', priority: 'URGENT', status: 'NEW', source: 'WEB',
      requester: { kind: 'student', index: 7 }, assignedTo: null, createdAt: yesterday, firstResponseAt: null, resolvedAt: null, closedAt: null,
    },
  ];

  const assigneeUserIds: Record<string, string | undefined> = {
    it: itStaff,
    accounts: accountantUserId,
    maint: people.staff['warden']?.userId,
    academic: people.staff['registrar']?.userId,
  };

  let resolvedCount = 0;
  for (const [index, spec] of ticketSpecs.entries()) {
    const student = spec.requester.kind === 'student' ? people.students[spec.requester.index] : undefined;
    const staffMember = spec.requester.kind === 'staff' ? people.staff[spec.requester.key] : undefined;
    const requesterUserId = student?.userId ?? staffMember?.userId;
    const requesterName = student?.fullName ?? staffMember?.fullName ?? 'Requester';
    const assignment = spec.assignedTo ? assigneeUserIds[spec.assignedTo] : undefined;
    const createdAt = demoDateTime(`${spec.createdAt}T${String(9 + (index % 8)).padStart(2, '0')}:${String(10 + index).padStart(2, '0')}`);

    const ticket = await prisma.helpdeskTicket.upsert({
      where: { tenantId_ticketNumber: { tenantId, ticketNumber: `HD-2026-${String(spec.number).padStart(6, '0')}` } },
      update: {
        status: spec.status,
        assignedToUserId: assignment ?? null,
        resolutionSummary: spec.resolvedAt ? 'Issue resolved and confirmed with the requester.' : null,
      },
      create: {
        id: id(`ticket/${spec.key}`),
        tenantId,
        ticketNumber: `HD-2026-${String(spec.number).padStart(6, '0')}`,
        subject: spec.subject,
        description: spec.description,
        status: spec.status,
        priority: spec.priority,
        source: spec.source,
        categoryId: categoryIds[spec.category] as string,
        departmentId: departmentIds[
          { catNetwork: 'deptIt', catProjector: 'deptIt', catFeeQuery: 'deptAccounts', catFeeRefund: 'deptAccounts', catHostelFacility: 'deptMaint', catLibraryBook: 'deptAcademic' }[spec.category] as string
        ] as string,
        slaPolicyId: slaIds[
          { catNetwork: 'slaIt', catProjector: 'slaIt', catFeeQuery: 'slaFinance', catFeeRefund: 'slaFinance', catHostelFacility: 'slaGeneral', catLibraryBook: 'slaGeneral' }[spec.category] as string
        ] as string,
        requesterUserId: requesterUserId ?? null,
        requesterName,
        requesterEmail: student?.email ?? staffMember?.email ?? null,
        assignedToUserId: assignment ?? null,
        responseDueAt: demoDateTime(`${spec.createdAt}T23:59`),
        resolutionDueAt: demoDateTime(`${spec.createdAt}T23:59`),
        firstRespondedAt: spec.firstResponseAt ? demoDateTime(`${spec.firstResponseAt}T10:30`) : null,
        resolvedAt: spec.resolvedAt ? demoDateTime(`${spec.resolvedAt}T15:00`) : null,
        closedAt: spec.closedAt ? demoDateTime(`${spec.closedAt}T10:00`) : null,
        resolutionSummary: spec.resolvedAt ? 'Issue resolved and confirmed with the requester.' : null,
        tags: [spec.category, spec.source.toLowerCase()],
        satisfactionScore: spec.satisfaction?.score ?? null,
        satisfactionComment: spec.satisfaction?.comment ?? null,
        satisfactionSubmittedAt: spec.satisfaction ? demoDateTime(`${spec.resolvedAt ?? spec.createdAt}T18:00`) : null,
        createdBy: requesterUserId ?? creator,
        createdAt,
      },
    });
    if (spec.status === 'RESOLVED' || spec.status === 'CLOSED') resolvedCount += 1;

    // Conversation: requester's opening note + one agent reply on answered tickets.
    await prisma.helpdeskTicketComment.upsert({
      where: { id: id(`ticket/${spec.key}/comment-1`) },
      update: {},
      create: {
        id: id(`ticket/${spec.key}/comment-1`),
        tenantId,
        ticketId: ticket.id,
        authorUserId: requesterUserId ?? null,
        visibility: 'PUBLIC',
        body: spec.description,
        createdBy: requesterUserId ?? creator,
      },
    });
    if (spec.firstResponseAt) {
      await prisma.helpdeskTicketComment.upsert({
        where: { id: id(`ticket/${spec.key}/comment-2`) },
        update: {},
        create: {
          id: id(`ticket/${spec.key}/comment-2`),
          tenantId,
          ticketId: ticket.id,
          authorUserId: assignment ?? creator,
          visibility: 'PUBLIC',
          body: 'Thank you for reporting this. Our team is looking into it and will update you shortly.',
          createdBy: assignment ?? creator,
        },
      });
    }

    const historyEvents: Array<{ key: string; event: 'CREATED' | 'ASSIGNED' | 'RESOLVED' | 'CLOSED' | 'REOPENED'; toValue?: string; note?: string; at: string }> = [
      { key: 'created', event: 'CREATED', at: spec.createdAt },
    ];
    if (assignment) {
      historyEvents.push({ key: 'assigned', event: 'ASSIGNED', toValue: assignment, note: 'Routed to the responsible team', at: spec.createdAt });
    }
    if (spec.resolvedAt) {
      historyEvents.push({ key: 'resolved', event: 'RESOLVED', at: spec.resolvedAt });
    }
    if (spec.closedAt) {
      historyEvents.push({ key: 'closed', event: 'CLOSED', at: spec.closedAt });
    }
    if (spec.status === 'REOPENED') {
      historyEvents.push({ key: 'reopened', event: 'REOPENED', note: 'Requester reopened: problem recurred', at: '2026-10-09' });
    }
    for (const history of historyEvents) {
      await prisma.helpdeskTicketHistory.upsert({
        where: { id: id(`ticket/${spec.key}/history/${history.key}`) },
        update: {},
        create: {
          id: id(`ticket/${spec.key}/history/${history.key}`),
          tenantId,
          ticketId: ticket.id,
          event: history.event,
          actorUserId: history.event === 'CREATED' ? (requesterUserId ?? creator) : (assignment ?? creator),
          actorType: 'USER',
          toValue: history.toValue,
          note: history.note,
        },
      });
    }

    if (spec.satisfaction) {
      await prisma.helpdeskFeedback.upsert({
        where: { tenantId_ticketId: { tenantId, ticketId: ticket.id } },
        update: { score: spec.satisfaction.score, comment: spec.satisfaction.comment },
        create: {
          id: id(`ticket/${spec.key}/feedback`),
          tenantId,
          ticketId: ticket.id,
          score: spec.satisfaction.score,
          comment: spec.satisfaction.comment,
          submittedByUserId: requesterUserId,
        },
      });
    }
    void spread;
  }

  // One escalated ticket (resolution SLA breached while the network issue dragged on).
  await prisma.helpdeskEscalation.upsert({
    where: { id: id('escalation/1') },
    update: {},
    create: {
      id: id('escalation/1'),
      tenantId,
      ticketId: id('ticket/t1'),
      reason: 'RESOLUTION_BREACH',
      level: 1,
      toRoleCode: 'TENANT_ADMIN',
      note: 'Resolution SLA breached by 6 hours — escalated to the campus admin.',
      escalatedByUserId: itStaff,
    },
  });

  logDemo('helpdesk', {
    tickets: ticketSpecs.length,
    resolved: resolvedCount,
    departments: departmentSpecs.length,
  });

  return { tickets: ticketSpecs.length, resolved: resolvedCount };
}
