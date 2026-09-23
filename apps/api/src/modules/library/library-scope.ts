/**
 * Library scope helpers. The catalog itself (categories / publishers / authors / books / copies)
 * is a shared tenant resource — like buildings/sections — visible to anyone with library.view.
 * Member-anchored rows (members, loans, reservations, fines) ARE permission-scoped the same way
 * the exams module scopes students: a caller holding `library.view` with only e.g. a
 * DEPARTMENT grant sees that department's students' rows, a GLOBAL grant sees everything, and an
 * OWN grant additionally admits the caller's own member record (so a librarian can pull up their
 * own member card / a student can reach self-service rows).
 */
import type { Prisma } from '@college-erp/database';

type Grants = { scopeType: string; scopeId?: string }[];

const EMPTY_MEMBER: Prisma.LibraryMemberWhereInput = { id: { in: [] } };

export function libraryMemberWhereInput(grants: Grants, actorUserId?: string): Prisma.LibraryMemberWhereInput | undefined {
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

  const clauses: Prisma.LibraryMemberWhereInput[] = [];
  // Self-service: the acting user's own member record (a librarian's Faculty/Staff card).
  if (canAccessOwn && actorUserId) clauses.push({ user: { id: actorUserId } });

  let studentClause: Prisma.StudentWhereInput | undefined;
  if (canAccessOwn && actorUserId) studentClause = { userId: actorUserId };
  else if (programIds.length) studentClause = { programId: { in: programIds } };
  else if (departmentIds.length) studentClause = { program: { departmentId: { in: departmentIds } } };
  else if (campusIds.length) studentClause = { campusId: { in: campusIds } };
  if (studentClause) clauses.push({ student: studentClause });

  if (!clauses.length) return EMPTY_MEMBER;
  if (clauses.length === 1) return clauses[0];
  return { OR: clauses };
}

/** Loans issued from the library module are always member-anchored (memberId populated), so
 * scoping through the member row covers catalog loans; legacy student-360 quick loans without a
 * member stay reachable only under a GLOBAL grant or via the student-360 API. */
export function libraryLoanScopeFilter(grants: Grants, actorUserId?: string): Prisma.StudentLibraryLoanWhereInput | undefined {
  const memberClause = libraryMemberWhereInput(grants, actorUserId);
  if (!memberClause) return undefined;
  return { member: memberClause };
}

export function libraryReservationScopeFilter(grants: Grants, actorUserId?: string): Prisma.LibraryReservationWhereInput | undefined {
  const memberClause = libraryMemberWhereInput(grants, actorUserId);
  if (!memberClause) return undefined;
  return { member: memberClause };
}

export function libraryFineScopeFilter(grants: Grants, actorUserId?: string): Prisma.LibraryFineWhereInput | undefined {
  const memberClause = libraryMemberWhereInput(grants, actorUserId);
  if (!memberClause) return undefined;
  return { member: memberClause };
}