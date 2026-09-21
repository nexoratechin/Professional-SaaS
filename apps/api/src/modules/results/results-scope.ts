/**
 * Results scope helpers. Sessions are anchored exactly like exam sessions (program scope drives
 * visibility; grants on campus → department → program), and student-level rows reuse the exams
 * student anchor semantics, so a results manager with `results.view` PROGRAM/DEPARTMENT/CAMPUS or
 * OWN grants sees the same population as the exams module.
 */
import type { Prisma } from '@college-erp/database';
import {
  examRegistrationScopeFilter,
  examSessionScopeFilter,
  examStudentWhereInput,
} from '../exams/exams-scope';

type Grants = { scopeType: string; scopeId?: string }[];

const EMPTY_PROCESS: Prisma.ResultProcessWhereInput = { id: { in: [] } };

export function resultsSessionScopeFilter(grants: Grants, actorUserId?: string): Prisma.ExamSessionWhereInput | undefined {
  return examSessionScopeFilter(grants, actorUserId);
}

export function resultsProcessScopeFilter(grants: Grants, actorUserId?: string): Prisma.ResultProcessWhereInput | undefined {
  if (!grants?.length || grants.some((g) => g.scopeType === 'GLOBAL')) return undefined;

  const sessionClause = examSessionScopeFilter(grants, actorUserId);
  const studentClause = examStudentWhereInput(grants, actorUserId);

  const clauses: Prisma.ResultProcessWhereInput[] = [];
  if (sessionClause) clauses.push({ session: sessionClause });
  if (studentClause) clauses.push({ student: studentClause });

  if (!clauses.length) return EMPTY_PROCESS;
  if (clauses.length === 1) return clauses[0];
  return { OR: clauses };
}

/** Registrations exposed to a `results.view` caller (session-anchor OR student-anchor). */
export function resultsRegistrationScopeFilter(grants: Grants, actorUserId?: string): Prisma.ExamRegistrationWhereInput | undefined {
  return examRegistrationScopeFilter(grants, actorUserId);
}