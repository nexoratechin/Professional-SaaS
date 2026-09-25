/**
 * Audience resolution for notification campaigns — the single implementation shared by the API
 * (audience preview/count) and the worker (campaign fan-out), so both sides always agree on who a
 * filter selects. Operates on an already tenant-scoped Prisma client; the caller guarantees the
 * client is scoped to the tenant the filter belongs to.
 */
import type { TenantScopedPrismaClient } from '@college-erp/database';
import type { NotificationAudienceFilter } from '@college-erp/types';

/** Users eligible for delivery: ACTIVE accounts plus INVITED ones (e.g. a newly-invited staff
 * member who should still get onboarding emails). SUSPENDED/DEACTIVATED never receive mail. */
const ELIGIBLE_USER_STATUSES = ['ACTIVE', 'INVITED'] as const;

export async function resolveAudience(
  prisma: TenantScopedPrismaClient,
  filter: NotificationAudienceFilter,
): Promise<string[]> {
  switch (filter.type) {
    case 'ALL': {
      const users = await prisma.user.findMany({
        where: { status: { in: [...ELIGIBLE_USER_STATUSES] } },
        select: { id: true },
      });
      return users.map((user) => user.id);
    }

    case 'ROLES': {
      const roleCodes = (filter.roleCodes ?? []).filter(Boolean);
      if (roleCodes.length === 0) return [];
      const rows = await prisma.userRole.findMany({
        where: { role: { code: { in: roleCodes } } },
        select: { userId: true },
      });
      return [...new Set(rows.map((row) => row.userId))];
    }

    case 'DEPARTMENTS': {
      const ids = (filter.departmentIds ?? []).filter(Boolean);
      if (ids.length === 0) return [];
      const rows = await prisma.userRole.findMany({
        where: { scopeDepartmentId: { in: ids } },
        select: { userId: true },
      });
      return [...new Set(rows.map((row) => row.userId))];
    }

    case 'CAMPUSES': {
      const ids = (filter.campusIds ?? []).filter(Boolean);
      if (ids.length === 0) return [];
      const rows = await prisma.userRole.findMany({
        where: { scopeCampusId: { in: ids } },
        select: { userId: true },
      });
      return [...new Set(rows.map((row) => row.userId))];
    }

    case 'BATCHES': {
      const ids = (filter.batchIds ?? []).filter(Boolean);
      if (ids.length === 0) return [];
      const students = await prisma.student.findMany({
        where: { batchId: { in: ids }, userId: { not: null }, deletedAt: null },
        select: { userId: true },
      });
      return [...new Set(students.map((student) => student.userId as string))];
    }

    case 'STUDENTS': {
      const ids = (filter.studentIds ?? []).filter(Boolean);
      if (ids.length === 0) return [];
      const students = await prisma.student.findMany({
        where: { id: { in: ids }, userId: { not: null }, deletedAt: null },
        select: { userId: true },
      });
      return [...new Set(students.map((student) => student.userId as string))];
    }

    case 'USERS': {
      return [...new Set((filter.userIds ?? []).filter(Boolean))];
    }

    default:
      return [];
  }
}