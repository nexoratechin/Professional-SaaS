/**
 * Certificates scope helpers. StudentCertificate rows are anchored exactly like result processes
 * (student anchor semantics from the exams module), so a certificates clerk with
 * `certificates.view` PROGRAM/DEPARTMENT/CAMPUS or OWN grants sees the same student population as
 * exams/results — certificates are per-student evidence, never session-scoped.
 */
import type { Prisma } from '@college-erp/database';
import { examStudentWhereInput } from '../exams/exams-scope';

type Grants = { scopeType: string; scopeId?: string }[];

const EMPTY_CERTIFICATE: Prisma.StudentCertificateWhereInput = { id: { in: [] } };

export function certificatesStudentScopeFilter(grants: Grants, actorUserId?: string): Prisma.StudentWhereInput | undefined {
  return examStudentWhereInput(grants, actorUserId);
}

/** StudentCertificate where-clause honoring the caller's scope grants. */
export function certificateScopeFilter(grants: Grants, actorUserId?: string): Prisma.StudentCertificateWhereInput | undefined {
  if (!grants?.length || grants.some((g) => g.scopeType === 'GLOBAL')) return undefined;
  const studentClause = certificatesStudentScopeFilter(grants, actorUserId);
  if (!studentClause) return EMPTY_CERTIFICATE;
  return { student: studentClause };
}