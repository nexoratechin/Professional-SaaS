/**
 * Exams scope helpers. Anchors:
 *  - 'session'  → ExamSession (program scope drives visibility; grants on campus → program),
 *  - 'student'  → models with a `student` relation (registrations, hall tickets, marks, revaluations),
 *  - registrations → OR of the session anchor (on the `session` relation) and student anchor.
 */
import type { Prisma } from '@college-erp/database';

type Grants = { scopeType: string; scopeId?: string }[];

type WhereClause = Prisma.ExamSessionWhereInput;

const EMPTY_SESSION: WhereClause = { id: { in: [] } };
const EMPTY_REGISTRATION: Prisma.ExamRegistrationWhereInput = { id: { in: [] } };

export function examSessionScopeFilter(grants: Grants, _actorUserId?: string): WhereClause | undefined {
  if (!grants?.length || grants.some((g) => g.scopeType === 'GLOBAL')) return undefined;

  const programIds: string[] = [];
  const departmentIds: string[] = [];
  const campusIds: string[] = [];

  for (const grant of grants) {
    if (grant.scopeType === 'CAMPUS' && grant.scopeId) campusIds.push(grant.scopeId);
    if (grant.scopeType === 'DEPARTMENT' && grant.scopeId) departmentIds.push(grant.scopeId);
    if (grant.scopeType === 'PROGRAM' && grant.scopeId) programIds.push(grant.scopeId);
  }

  // A student-role has no session-level grants; sessions must be invisible to them.
  if (!programIds.length && !departmentIds.length && !campusIds.length) return EMPTY_SESSION;

  if (programIds.length) return { programId: { in: programIds } };
  if (departmentIds.length) return { program: { departmentId: { in: departmentIds } } };
  return { program: { department: { campusId: { in: campusIds } } } };
}

export function examStudentScopeFilter(grants: Grants, actorUserId?: string): Prisma.ExamRegistrationWhereInput | undefined {
  if (!grants?.length || grants.some((g) => g.scopeType === 'GLOBAL')) return undefined;

  const programIds: string[] = [];
  const departmentIds: string[] = [];
  const campusIds: string[] = [];
  let canAccessOwn = false;

  for (const grant of grants) {
    if (grant.scopeType === 'OWN') canAccessOwn = true;
    if (grant.scopeType === 'CAMPUS' && grant.scopeId) campusIds.push(grant.scopeId);
    if (grant.scopeType === 'DEPARTMENT' && grant.scopeId) departmentIds.push(grant.scopeId);
    if (grant.scopeType === 'PROGRAM' && grant.scopeId) programIds.push(grant.scopeId);
  }

  if (canAccessOwn && actorUserId) return { student: { userId: actorUserId } };
  if (programIds.length) return { student: { programId: { in: programIds } } };
  if (departmentIds.length) return { student: { program: { departmentId: { in: departmentIds } } } };
  if (campusIds.length) return { student: { campusId: { in: campusIds } } };
  return EMPTY_REGISTRATION;
}

export function examRegistrationScopeFilter(grants: Grants, actorUserId?: string): Prisma.ExamRegistrationWhereInput | undefined {
  const sessionClause = examSessionScopeFilter(grants, actorUserId);
  const studentClause = examStudentScopeFilter(grants, actorUserId);

  const clauses: Prisma.ExamRegistrationWhereInput[] = [];
  if (sessionClause) clauses.push({ session: sessionClause });
  if (studentClause) clauses.push(studentClause);

  if (!clauses.length) return undefined;
  if (clauses.length === 1) return clauses[0];
  return { OR: clauses };
}

export function examMarksScopeFilter(grants: Grants, actorUserId?: string): Prisma.ExamMarksEntryWhereInput | undefined {
  const registrationClause = examRegistrationScopeFilter(grants, actorUserId);
  if (!registrationClause) return undefined;
  return { registration: registrationClause };
}

export function examSubjectScopeFilter(grants: Grants, actorUserId?: string): Prisma.ExamSubjectWhereInput | undefined {
  const sessionClause = examSessionScopeFilter(grants, actorUserId);
  if (!sessionClause) return undefined;
  return { session: sessionClause };
}

export function examSeatingPlanScopeFilter(grants: Grants, actorUserId?: string): Prisma.ExamSeatingPlanWhereInput | undefined {
  const sessionClause = examSessionScopeFilter(grants, actorUserId);
  if (!sessionClause) return undefined;
  return { session: sessionClause };
}

export function examHallTicketScopeFilter(grants: Grants, actorUserId?: string): Prisma.ExamHallTicketWhereInput | undefined {
  const registrationClause = examRegistrationScopeFilter(grants, actorUserId);
  if (!registrationClause) return undefined;
  return { registration: registrationClause };
}