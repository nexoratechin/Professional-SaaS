import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { ACTIONS_IMPLIED_BY_MANAGE, PERMISSION_ACTIONS } from '@college-erp/auth';
import { createTenantScopedClient, type TenantScopedPrismaClient } from '@college-erp/database';
import {
  executeReport,
  renderReport,
  type ReportFilters,
  type ReportPrisma,
  type ReportScopeGrant,
  type ReportTemplateDefinition,
} from '@college-erp/reporting';
import type { ReportExportJobData } from '@college-erp/types';
import { QUEUE_NAMES } from '@college-erp/types';
import { WorkerStorageService } from '../../common/storage/worker-storage.service';

interface ScopeSnapshot {
  sourcePermission?: string;
  effectiveGrants?: ReportScopeGrant[];
  actorUserId?: string;
}

@Processor(QUEUE_NAMES.REPORT_EXPORTS)
export class ReportExportProcessor extends WorkerHost {
  private readonly logger = new Logger(ReportExportProcessor.name);

  constructor(private readonly storage: WorkerStorageService) {
    super();
  }

  async process(job: Job<ReportExportJobData>): Promise<void> {
    const { tenantId, runId } = job.data;
    const db = createTenantScopedClient(tenantId);
    const run = await db.reportRun.findFirst({ where: { id: runId } });
    if (!run) {
      this.logger.warn(`Report run ${runId} not found for tenant ${tenantId}; dropping job.`);
      return;
    }
    if (run.status === 'COMPLETED') return;
    if (run.status === 'FAILED') {
      this.logger.warn(`Report run ${runId} is already FAILED; dropping retry.`);
      return;
    }

    await db.reportRun.updateMany({ where: { id: runId }, data: { status: 'RUNNING', startedAt: new Date(), errorMessage: null } });

    try {
      const snapshot = (run.scopeSnapshot as ScopeSnapshot | null) ?? {};
      const actorUserId = run.requestedById ?? snapshot.actorUserId;
      const grants = await this.revalidateGrants(db, actorUserId ?? null, snapshot);
      if (!grants.length) throw new Error('The report owner no longer has access to this report.');

      const filters = (run.filters as ReportFilters | null) ?? {};
      const template = (run.templateSnapshot as ReportTemplateDefinition | null) ?? null;
      const result = await executeReport(db as unknown as ReportPrisma, run.reportType, filters, grants, {
        mode: 'export',
        template,
        actorUserId: actorUserId ?? undefined,
      });
      const rendered = renderReport(run.format, result, { title: template?.title ?? undefined, subtitle: template?.subtitle });
      const objectKey = `tenants/${tenantId}/reports/${runId}/${rendered.fileName}`;
      await this.storage.uploadBuffer(tenantId, objectKey, rendered.buffer, rendered.contentType);
      await db.reportRun.updateMany({
        where: { id: runId },
        data: { status: 'COMPLETED', rowCount: result.rowCount, fileName: rendered.fileName, objectKey, completedAt: new Date() },
      });
      this.logger.log(`Report run ${runId} completed with ${result.rowCount} rows.`);
    } catch (error) {
      const attempts = job.opts.attempts ?? 1;
      const finalAttempt = job.attemptsMade + 1 >= attempts;
      const message = error instanceof Error ? error.message : 'Report export failed.';
      await db.reportRun.updateMany({
        where: { id: runId },
        data: finalAttempt
          ? { status: 'FAILED', errorMessage: message.slice(0, 500), completedAt: new Date() }
          : { status: 'RUNNING', errorMessage: message.slice(0, 500) },
      });
      this.logger.error(`Report run ${runId} failed${finalAttempt ? '' : '; will retry'}: ${message}`);
      if (!finalAttempt) throw error;
    }
  }

  /**
   * Re-resolves the requesting user's CURRENT effective permission scopes and intersects them with
   * the scope frozen on the run. This makes role revocation effective for queued/scheduled exports
   * instead of trusting a stale snapshot, while never broadening access.
   */
  private async revalidateGrants(
    db: TenantScopedPrismaClient,
    actorUserId: string | null,
    snapshot: ScopeSnapshot,
  ): Promise<ReportScopeGrant[]> {
    if (!actorUserId || !snapshot.sourcePermission) return [];
    const userRoles = await db.userRole.findMany({
      where: { userId: actorUserId },
      include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
    });
    const grantsByKey = new Map<string, ReportScopeGrant[]>();
    const manageScopesByModule = new Map<string, ReportScopeGrant[]>();
    for (const userRole of userRoles) {
      const assignment = {
        ...(userRole.scopeCampusId ? { campusId: userRole.scopeCampusId } : {}),
        ...(userRole.scopeDepartmentId ? { departmentId: userRole.scopeDepartmentId } : {}),
        ...(userRole.scopeProgramId ? { programId: userRole.scopeProgramId } : {}),
      };
      for (const rolePermission of userRole.role.rolePermissions) {
        const { key, module, action } = rolePermission.permission;
        const grant: ReportScopeGrant = { scopeType: rolePermission.scopeType, ...assignment };
        grantsByKey.set(key, [...(grantsByKey.get(key) ?? []), grant]);
        if (action === PERMISSION_ACTIONS.MANAGE) {
          manageScopesByModule.set(module, [...(manageScopesByModule.get(module) ?? []), grant]);
        }
      }
    }
    if (manageScopesByModule.size) {
      const implied = await db.permission.findMany({
        where: { module: { in: [...manageScopesByModule.keys()] }, action: { in: [...ACTIONS_IMPLIED_BY_MANAGE] } },
      });
      for (const permission of implied) {
        const manageScopes = manageScopesByModule.get(permission.module) ?? [];
        grantsByKey.set(permission.key, [...(grantsByKey.get(permission.key) ?? []), ...manageScopes]);
      }
    }

    const currentReport = grantsByKey.get('reports.view') ?? [];
    const currentSource = grantsByKey.get(snapshot.sourcePermission) ?? [];
    if (!currentReport.length || !currentSource.length) return [];
    const frozen = snapshot.effectiveGrants ?? [];
    if (!frozen.length) return [];
    return frozen.filter((grant) => coveredBy(currentReport, grant) && coveredBy(currentSource, grant));
  }
}

export function coveredBy(grants: ReportScopeGrant[], target: ReportScopeGrant): boolean {
  if (target.scopeType === 'GLOBAL') return grants.some((grant) => grant.scopeType === 'GLOBAL');
  const global = grants.some((grant) => grant.scopeType === 'GLOBAL');
  if (global) return true;
  switch (target.scopeType) {
    case 'CAMPUS':
      return grants.some((grant) => grant.scopeType === 'CAMPUS' && grant.campusId === target.campusId);
    case 'DEPARTMENT':
      return grants.some((grant) => grant.scopeType === 'DEPARTMENT' && grant.departmentId === target.departmentId);
    case 'PROGRAM':
      return grants.some((grant) => grant.scopeType === 'PROGRAM' && grant.programId === target.programId);
    case 'OWN':
      return grants.some((grant) => grant.scopeType === 'OWN');
    default:
      return false;
  }
}
