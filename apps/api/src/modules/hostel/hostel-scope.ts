/**
 * Hostel scope helpers. The hostel catalog (hostels / buildings / floors / rooms / beds /
 * wardens) is a shared tenant resource — like library catalog rows — visible to anyone with
 * hostel.view. Student-anchored rows (bookings, rent charges, complaints, visitors) ARE
 * permission-scoped exactly like the exams/library modules: a caller with a GLOBAL grant sees
 * everything, an OWN grant admits their own student row, and CAMPUS / DEPARTMENT / PROGRAM
 * grants admit the students in that scope.
 */
import type { Prisma } from '@college-erp/database';

type Grants = { scopeType: string; scopeId?: string }[];

const EMPTY_STUDENT: Prisma.StudentWhereInput = { id: { in: [] } };

/** Student where-clause implied by the caller's hostel.view grants. Returns undefined for
 * platform-admin/unrestricted callers (GLOBAL grant, or no grant argument supplied outright);
 * grants provided but with no actionable scope (or an empty list) collapse to an impossible
 * filter so the caller sees nothing rather than everything. */
export function hostelStudentWhereInput(grants: Grants | undefined, actorUserId?: string): Prisma.StudentWhereInput | undefined {
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

/** Bookings are always student-anchored (StudentHostelBooking.studentId is required). */
export function hostelBookingWhereInput(grants: Grants, actorUserId?: string): Prisma.StudentHostelBookingWhereInput | undefined {
  const studentClause = hostelStudentWhereInput(grants, actorUserId);
  if (!studentClause) return undefined;
  return { student: studentClause };
}

/** Complaints and visitors carry an OPTIONAL studentId; non-GLOBAL callers may still see
 * unlinked rows (a complaint about infrastructure, a guest that never mapped to a student) but
 * any student-linked row is scoped like bookings. */
export function hostelStudentAnchoredScope(
  grants: Grants,
  actorUserId?: string,
): Prisma.HostelComplaintWhereInput | Prisma.HostelVisitorWhereInput | undefined {
  const studentClause = hostelStudentWhereInput(grants, actorUserId);
  if (!studentClause) return undefined;
  return { OR: [{ studentId: null }, { student: studentClause }] };
}

/** Rent charges point at the booking that produced them, so they scope through the booking's
 * student (StudentFee has no student-scoped grant path of its own in this module). */
export function hostelChargeWhereInput(grants: Grants, actorUserId?: string): Prisma.StudentFeeWhereInput | undefined {
  const studentClause = hostelStudentWhereInput(grants, actorUserId);
  if (!studentClause) return undefined;
  return { hostelBooking: { student: studentClause } };
}