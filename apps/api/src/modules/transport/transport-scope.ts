/**
 * Transport scope helpers. The transport catalog (vehicles / drivers / routes / stops / trips /
 * maintenance) is a shared tenant resource — like hostel catalog rows — visible to anyone with
 * transport.view. Student-anchored rows (passes and their ledger charges) ARE permission-scoped
 * like the hostel/exams modules: GLOBAL grant sees everything, OWN admits the caller's own student
 * row, and CAMPUS / DEPARTMENT / PROGRAM grants admit the students in that scope.
 */
import type { Prisma } from '@college-erp/database';

type Grants = { scopeType: string; scopeId?: string }[];

const EMPTY_STUDENT: Prisma.StudentWhereInput = { id: { in: [] } };

/** Student where-clause implied by the caller's transport.view grants — same semantics as the
 * hostel library scoper (see hostel-scope.ts). */
export function transportStudentWhereInput(
  grants: Grants | undefined,
  actorUserId?: string,
): Prisma.StudentWhereInput | undefined {
  if (!grants) return undefined;
  if (grants.some((g) => g.scopeType === 'GLOBAL')) return undefined;

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

  if (canAccessOwn && actorUserId) {
    return { userId: actorUserId };
  }
  if (programIds.length) return { programId: { in: programIds } };
  if (departmentIds.length) return { program: { departmentId: { in: departmentIds } } };
  if (campusIds.length) return { campusId: { in: campusIds } };
  return EMPTY_STUDENT;
}

/** Passes are always student-anchored (StudentTransportPass.studentId is required). */
export function transportPassWhereInput(
  grants: Grants,
  actorUserId?: string,
): Prisma.StudentTransportPassWhereInput | undefined {
  const studentClause = transportStudentWhereInput(grants, actorUserId);
  if (!studentClause) return undefined;
  return { student: studentClause };
}

/** Transport fee charges point at the pass that produced them, so they scope through the pass's
 * student (StudentFee has no student-scoped grant path of its own in this module). */
export function transportChargeWhereInput(
  grants: Grants,
  actorUserId?: string,
): Prisma.StudentFeeWhereInput | undefined {
  const studentClause = transportStudentWhereInput(grants, actorUserId);
  if (!studentClause) return undefined;
  return { transportPass: { student: studentClause } };
}