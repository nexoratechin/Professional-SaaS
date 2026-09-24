/**
 * Helpdesk reporting/dashboards — aggregate views over tickets for the module's Summary tab and
 * the reports tabs: status/priority breakdown, SLA health, department/category/agent performance,
 * a created-vs-resolved trend, and satisfaction distribution. Read-only; gated by helpdesk.view.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@college-erp/database';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { HELPDESK_OPEN_STATUSES, type HelpdeskReportQueryDto } from './dto/helpdesk.dto';

type Client = PrismaClient;

const OPEN_STATUSES = [...HELPDESK_OPEN_STATUSES];

@Injectable()
export class HelpdeskReportService {
  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  private get db(): Client {
    return this.tenantPrisma.client as unknown as Client;
  }

  private dateWhere(q: HelpdeskReportQueryDto) {
    const where: any = {};
    if (q.dateFrom || q.dateTo) {
      where.createdAt = {};
      if (q.dateFrom) where.createdAt.gte = new Date(q.dateFrom);
      if (q.dateTo) where.createdAt.lte = new Date(q.dateTo);
    }
    if (q.departmentId) where.departmentId = q.departmentId;
    if (q.categoryId) where.categoryId = q.categoryId;
    return where;
  }

  private dateRange(q: HelpdeskReportQueryDto) {
    const to = q.dateTo ? new Date(q.dateTo) : new Date();
    const from = q.dateFrom ? new Date(q.dateFrom) : new Date(to.getTime() - 29 * 24 * 60 * 60 * 1000);
    return { from, to };
  }

  async summary(tenantId: string, q: HelpdeskReportQueryDto) {
    const where = this.dateWhere(q);
    const now = new Date();

    const [byStatus, byPriority, total, feedbackAgg, resolvedRows] = await Promise.all([
      this.db.helpdeskTicket.groupBy({ by: ['status'], where, _count: { _all: true } }),
      this.db.helpdeskTicket.groupBy({ by: ['priority'], where, _count: { _all: true } }),
      this.db.helpdeskTicket.count({ where }),
      this.db.helpdeskFeedback.aggregate({ where: { ticket: { is: where } }, _avg: { score: true }, _count: { _all: true } }),
      this.db.helpdeskTicket.findMany({
        where: { ...where, status: { in: ['RESOLVED', 'CLOSED'] }, resolvedAt: { not: null } },
        select: { createdAt: true, resolvedAt: true, firstRespondedAt: true },
      }),
    ]);

    const openCount = byStatus
      .filter((row: any) => OPEN_STATUSES.includes(row.status))
      .reduce((sum: number, row: any) => sum + row._count._all, 0);

    const overdueCount = await this.db.helpdeskTicket.count({
      where: {
        ...where,
        status: { in: OPEN_STATUSES },
        resolutionDueAt: { lt: now },
      },
    });

    const unassignedCount = await this.db.helpdeskTicket.count({ where: { ...where, status: { in: OPEN_STATUSES }, assignedToUserId: null } });

    const resolutionMinutes = resolvedRows
      .filter((row: any) => row.resolvedAt)
      .map((row: any) => (new Date(row.resolvedAt).getTime() - new Date(row.createdAt).getTime()) / 60_000);
    const responseMinutes = resolvedRows
      .filter((row: any) => row.firstRespondedAt)
      .map((row: any) => (new Date(row.firstRespondedAt).getTime() - new Date(row.createdAt).getTime()) / 60_000);

    const avg = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
    const resolvedCount = byStatus
      .filter((row: any) => row.status === 'RESOLVED' || row.status === 'CLOSED')
      .reduce((sum: number, row: any) => sum + row._count._all, 0);

    return {
      tenantId,
      total,
      open: openCount,
      overdue: overdueCount,
      unassigned: unassignedCount,
      resolved: resolvedCount,
      byStatus: Object.fromEntries(byStatus.map((row: any) => [row.status, row._count._all])),
      byPriority: Object.fromEntries(byPriority.map((row: any) => [row.priority, row._count._all])),
      avgResolutionMinutes: avg(resolutionMinutes),
      avgFirstResponseMinutes: avg(responseMinutes),
      satisfactionAverage: feedbackAgg._avg.score ?? null,
      feedbackCount: feedbackAgg._count._all,
      slaComplianceRate: total > 0 ? Math.max(0, (total - overdueCount) / total) : 1,
    };
  }

  async byDepartment(tenantId: string, q: HelpdeskReportQueryDto) {
    const where = this.dateWhere(q);
    const grouped = await this.db.helpdeskTicket.groupBy({ by: ['departmentId', 'status'], where, _count: { _all: true }, _avg: { satisfactionScore: true } });
    const departmentIds = [...new Set(grouped.map((row: any) => row.departmentId).filter(Boolean))] as string[];
    const departments = departmentIds.length
      ? await this.db.helpdeskDepartment.findMany({ where: { id: { in: departmentIds } }, select: { id: true, name: true, code: true } })
      : [];
    const nameById = new Map(departments.map((d: any) => [d.id, d]));

    const result: Record<string, any> = {};
    for (const row of grouped as any[]) {
      const key = row.departmentId ?? 'unassigned';
      const name = row.departmentId ? nameById.get(row.departmentId)?.name ?? 'Unknown' : 'Unassigned';
      const code = row.departmentId ? nameById.get(row.departmentId)?.code ?? null : null;
      const entry = result[key] ?? { departmentId: row.departmentId, name, code, total: 0, open: 0, resolved: 0, satisfactionSum: 0, satisfactionCount: 0, byStatus: {} };
      entry.total += row._count._all;
      entry.byStatus[row.status] = row._count._all;
      if (OPEN_STATUSES.includes(row.status)) entry.open += row._count._all;
      if (row.status === 'RESOLVED' || row.status === 'CLOSED') entry.resolved += row._count._all;
      if (row._avg.satisfactionScore != null) {
        entry.satisfactionSum += row._avg.satisfactionScore * row._count._all;
        entry.satisfactionCount += row._count._all;
      }
      result[key] = entry;
    }

    return Object.values(result)
      .map((entry: any) => ({
        departmentId: entry.departmentId,
        name: entry.name,
        code: entry.code,
        total: entry.total,
        open: entry.open,
        resolved: entry.resolved,
        byStatus: entry.byStatus,
        satisfactionAverage: entry.satisfactionCount ? entry.satisfactionSum / entry.satisfactionCount : null,
      }))
      .sort((a, b) => b.total - a.total);
  }

  async byCategory(tenantId: string, q: HelpdeskReportQueryDto) {
    const where = this.dateWhere(q);
    const grouped = await this.db.helpdeskTicket.groupBy({ by: ['categoryId', 'status'], where, _count: { _all: true } });
    const categoryIds = [...new Set(grouped.map((row: any) => row.categoryId))] as string[];
    const categories = categoryIds.length
      ? await this.db.helpdeskCategory.findMany({ where: { id: { in: categoryIds } }, select: { id: true, name: true, code: true } })
      : [];
    const nameById = new Map(categories.map((c: any) => [c.id, c]));

    const result: Record<string, any> = {};
    for (const row of grouped as any[]) {
      const entry = result[row.categoryId] ?? { categoryId: row.categoryId, name: nameById.get(row.categoryId)?.name ?? 'Unknown', code: nameById.get(row.categoryId)?.code ?? null, total: 0, open: 0, resolved: 0, byStatus: {} };
      entry.total += row._count._all;
      entry.byStatus[row.status] = row._count._all;
      if (OPEN_STATUSES.includes(row.status)) entry.open += row._count._all;
      if (row.status === 'RESOLVED' || row.status === 'CLOSED') entry.resolved += row._count._all;
      result[row.categoryId] = entry;
    }
    return Object.values(result).sort((a: any, b: any) => b.total - a.total);
  }

  async byAgent(tenantId: string, q: HelpdeskReportQueryDto) {
    const where = this.dateWhere(q);
    const grouped = await this.db.helpdeskTicket.groupBy({ by: ['assignedToUserId', 'status'], where, _count: { _all: true }, _avg: { satisfactionScore: true } });
    const userIds = [...new Set(grouped.map((row: any) => row.assignedToUserId).filter(Boolean))] as string[];
    const users = userIds.length ? await this.db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true, email: true } }) : [];
    const userById = new Map(users.map((u: any) => [u.id, u]));

    const result: Record<string, any> = {};
    for (const row of grouped as any[]) {
      const key = row.assignedToUserId ?? 'unassigned';
      const user = row.assignedToUserId ? userById.get(row.assignedToUserId) : null;
      const entry = result[key] ?? { assignedToUserId: row.assignedToUserId, name: user?.fullName ?? 'Unassigned', email: user?.email ?? null, total: 0, open: 0, resolved: 0, satisfactionSum: 0, satisfactionCount: 0 };
      entry.total += row._count._all;
      if (OPEN_STATUSES.includes(row.status)) entry.open += row._count._all;
      if (row.status === 'RESOLVED' || row.status === 'CLOSED') entry.resolved += row._count._all;
      if (row._avg.satisfactionScore != null) {
        entry.satisfactionSum += row._avg.satisfactionScore * row._count._all;
        entry.satisfactionCount += row._count._all;
      }
      result[key] = entry;
    }
    return Object.values(result)
      .map((entry: any) => ({
        assignedToUserId: entry.assignedToUserId,
        name: entry.name,
        email: entry.email,
        total: entry.total,
        open: entry.open,
        resolved: entry.resolved,
        satisfactionAverage: entry.satisfactionCount ? entry.satisfactionSum / entry.satisfactionCount : null,
      }))
      .sort((a, b) => b.total - a.total);
  }

  async trend(tenantId: string, q: HelpdeskReportQueryDto) {
    const { from, to } = this.dateRange(q);
    const tickets = await this.db.helpdeskTicket.findMany({
      where: { createdAt: { gte: from, lte: to }, ...(q.departmentId ? { departmentId: q.departmentId } : {}), ...(q.categoryId ? { categoryId: q.categoryId } : {}) },
      select: { createdAt: true, resolvedAt: true },
    });

    const days: Array<{ date: string; created: number; resolved: number }> = [];
    const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
    const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
    const dayKey = (d: Date) => d.toISOString().slice(0, 10);
    const createdCounts = new Map<string, number>();
    const resolvedCounts = new Map<string, number>();
    for (const t of tickets as any[]) {
      const ck = dayKey(new Date(t.createdAt));
      createdCounts.set(ck, (createdCounts.get(ck) ?? 0) + 1);
      if (t.resolvedAt) {
        const rk = dayKey(new Date(t.resolvedAt));
        resolvedCounts.set(rk, (resolvedCounts.get(rk) ?? 0) + 1);
      }
    }
    while (cursor <= end) {
      const key = dayKey(cursor);
      days.push({ date: key, created: createdCounts.get(key) ?? 0, resolved: resolvedCounts.get(key) ?? 0 });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return { from: from.toISOString(), to: to.toISOString(), days };
  }

  async satisfaction(tenantId: string, q: HelpdeskReportQueryDto) {
    const where = this.dateWhere(q);
    const [distribution, aggregate, recent] = await Promise.all([
      this.db.helpdeskFeedback.groupBy({ by: ['score'], where: { ticket: { is: where } }, _count: { _all: true } }),
      this.db.helpdeskFeedback.aggregate({ where: { ticket: { is: where } }, _avg: { score: true }, _count: { _all: true } }),
      this.db.helpdeskFeedback.findMany({
        where: { ticket: { is: where }, comment: { not: null } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: { ticket: { select: { ticketNumber: true, subject: true } } },
      }),
    ]);

    const counts: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    for (const row of distribution as any[]) counts[String(row.score)] = row._count._all;

    return {
      average: aggregate._avg.score ?? null,
      totalResponses: aggregate._count._all,
      distribution: counts,
      recentComments: recent,
    };
  }
}
