import { ForbiddenException } from '@nestjs/common';
import type { ReportScopeGrant } from '@college-erp/reporting';
import type { ScopeGrant } from '../rbac/permissions.service';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';

interface ScopeNode {
  scopeType: 'CAMPUS' | 'DEPARTMENT' | 'PROGRAM';
  campusId?: string;
  departmentId?: string;
  programId?: string;
}

const VALID_SCOPE_TYPES = new Set(['GLOBAL', 'CAMPUS', 'DEPARTMENT', 'PROGRAM', 'OWN']);

export function asReportScopeGrants(grants: ScopeGrant[]): ReportScopeGrant[] {
  return grants
    .filter((grant) => VALID_SCOPE_TYPES.has(grant.scopeType))
    .map((grant) => ({
      scopeType: grant.scopeType,
      ...(grant.campusId ? { campusId: grant.campusId } : {}),
      ...(grant.departmentId ? { departmentId: grant.departmentId } : {}),
      ...(grant.programId ? { programId: grant.programId } : {}),
    })) as ReportScopeGrant[];
}

/**
 * Intersects the report-entry grant with the source-domain grant. Passing only one side would
 * accidentally broaden access (for example, a campus-scoped reports.view grant paired with a
 * global students.view grant). Unknown/missing hierarchy ids are treated as no match.
 */
export async function intersectReportScope(
  tenantPrisma: TenantScopedPrismaService,
  reportGrants: ReportScopeGrant[],
  sourceGrants: ReportScopeGrant[],
): Promise<ReportScopeGrant[]> {
  if (reportGrants.some((grant) => grant.scopeType === 'GLOBAL')) {
    return dedupe(sourceGrants);
  }
  if (sourceGrants.some((grant) => grant.scopeType === 'GLOBAL')) {
    return dedupe(reportGrants);
  }

  const reportOwn = reportGrants.some((grant) => grant.scopeType === 'OWN');
  const sourceOwn = sourceGrants.some((grant) => grant.scopeType === 'OWN');
  if (reportOwn || sourceOwn) {
    return reportOwn && sourceOwn ? ([{ scopeType: 'OWN' }] as unknown as ReportScopeGrant[]) : [];
  }

  const [reportNodes, sourceNodes] = await Promise.all([
    expandScopeNodes(tenantPrisma, reportGrants),
    expandScopeNodes(tenantPrisma, sourceGrants),
  ]);
  const intersections: ReportScopeGrant[] = [];

  for (const report of reportNodes) {
    for (const source of sourceNodes) {
      const intersection = intersectNodes(report, source);
      if (intersection) intersections.push(intersection as ReportScopeGrant);
    }
  }

  return dedupe(intersections);
}

export function scopeIsGlobal(grants: ReportScopeGrant[]): boolean {
  return grants.some((grant) => grant.scopeType === 'GLOBAL');
}

export async function scopeContainsRequestedNode(
  tenantPrisma: TenantScopedPrismaService,
  grants: ReportScopeGrant[],
  requested: { campusId?: string; departmentId?: string; programId?: string },
): Promise<boolean> {
  if (!requested.campusId && !requested.departmentId && !requested.programId) return true;
  if (scopeIsGlobal(grants)) return true;

  const nodes = await expandScopeNodes(
    tenantPrisma,
    grants.map((grant) => grant as unknown as ScopeGrant),
  );
  return nodes.some((node) => {
    if (requested.campusId && node.campusId !== requested.campusId) return false;
    if (requested.departmentId && node.departmentId !== requested.departmentId) return false;
    if (requested.programId && node.programId !== requested.programId) return false;
    return true;
  });
}

async function expandScopeNodes(
  tenantPrisma: TenantScopedPrismaService,
  grants: ReportScopeGrant[],
): Promise<ScopeNode[]> {
  const departmentIds = grants.flatMap((grant) => (grant.departmentId ? [grant.departmentId] : []));
  const programIds = grants.flatMap((grant) => (grant.programId ? [grant.programId] : []));

  const [departments, programs] = await Promise.all([
    departmentIds.length
      ? tenantPrisma.client.department.findMany({
          where: { id: { in: unique(departmentIds) } },
          select: { id: true, campusId: true },
        })
      : [],
    programIds.length
      ? tenantPrisma.client.program.findMany({
          where: { id: { in: unique(programIds) } },
          select: { id: true, departmentId: true, department: { select: { campusId: true } } },
        })
      : [],
  ]);
  const departmentById = new Map(departments.map((department) => [department.id, department]));
  const programById = new Map(programs.map((program) => [program.id, program]));

  const nodes: ScopeNode[] = [];
  for (const grant of grants) {
    if (grant.scopeType === 'CAMPUS' && grant.campusId) {
      nodes.push({ scopeType: 'CAMPUS', campusId: grant.campusId });
      continue;
    }
    if (grant.scopeType === 'DEPARTMENT' && grant.departmentId) {
      const department = departmentById.get(grant.departmentId);
      if (department) {
        nodes.push({
          scopeType: 'DEPARTMENT',
          campusId: department.campusId ?? undefined,
          departmentId: department.id,
        });
      }
      continue;
    }
    if (grant.scopeType === 'PROGRAM' && grant.programId) {
      const program = programById.get(grant.programId);
      if (program) {
        nodes.push({
          scopeType: 'PROGRAM',
          campusId: program.department?.campusId ?? undefined,
          departmentId: program.departmentId ?? undefined,
          programId: program.id,
        });
      }
    }
  }
  return nodes;
}

function intersectNodes(left: ScopeNode, right: ScopeNode): ScopeNode | null {
  if (left.scopeType === 'CAMPUS' && right.scopeType === 'CAMPUS') {
    return left.campusId === right.campusId ? left : null;
  }
  if (left.scopeType === 'DEPARTMENT' && right.scopeType === 'DEPARTMENT') {
    return left.departmentId === right.departmentId ? left : null;
  }
  if (left.scopeType === 'PROGRAM' && right.scopeType === 'PROGRAM') {
    return left.programId === right.programId ? left : null;
  }

  const leftProgram = left.scopeType === 'PROGRAM' ? left.programId : undefined;
  const rightProgram = right.scopeType === 'PROGRAM' ? right.programId : undefined;
  if (leftProgram && rightProgram) return leftProgram === rightProgram ? left : null;

  const leftDepartment = left.scopeType === 'PROGRAM' ? left.departmentId : left.departmentId;
  const rightDepartment = right.scopeType === 'PROGRAM' ? right.departmentId : right.departmentId;
  if (leftDepartment && rightDepartment) {
    if (leftDepartment !== rightDepartment) return null;
    return {
      scopeType: 'DEPARTMENT',
      campusId: left.campusId ?? right.campusId,
      departmentId: leftDepartment,
    };
  }

  if (left.campusId && right.campusId) {
    if (left.campusId !== right.campusId) return null;
    return { scopeType: 'CAMPUS', campusId: left.campusId };
  }

  return null;
}

function dedupe(grants: ReportScopeGrant[]): ReportScopeGrant[] {
  const seen = new Set<string>();
  const result: ReportScopeGrant[] = [];
  for (const grant of grants) {
    const key = JSON.stringify({
      scopeType: grant.scopeType,
      campusId: grant.campusId ?? null,
      departmentId: grant.departmentId ?? null,
      programId: grant.programId ?? null,
    });
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(grant);
  }
  return result;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function assertNonEmptyEffectiveScope(grants: ReportScopeGrant[]): void {
  if (grants.length === 0) {
    throw new ForbiddenException('Your report scope does not overlap the source data permission.');
  }
}
