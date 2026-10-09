/**
 * NotificationsService — recipient/tenant enforcement, scheduling validation and the
 * "enqueue only tenantId + notificationId" contract that keeps the worker forced to re-fetch
 * through a tenant-scoped client. Mocked tenant-scoped client + BullMQ queues (no DB/Redis).
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { AppConfigService } from '../../config/app-config.service';
import type { TenantContextService } from '../../common/prisma/tenant-context.service';
import type { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import type { AuditService } from '../audit/audit.service';
import { NotificationsService } from './notifications.service';

const TENANT = 'tenant-1';
const SECRET = '0'.repeat(64);

function makeService() {
  const client = {
    user: { findFirst: jest.fn() },
    notification: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  };
  const tenantPrisma = { client } as unknown as TenantScopedPrismaService;
  const tenantContext = {} as TenantContextService;
  const queueAdd = jest.fn().mockResolvedValue({});
  const queue = { add: queueAdd } as unknown as Queue;
  const campaignQueue = { add: jest.fn() } as unknown as Queue;
  const auditService = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const appConfig = { get: jest.fn().mockReturnValue(SECRET) } as unknown as AppConfigService;
  const service = new NotificationsService(tenantPrisma, tenantContext, queue, campaignQueue, auditService, appConfig);
  return { service, client, queueAdd, auditService };
}

const dto = { recipientUserId: 'user-9', channel: 'EMAIL' as const, subject: 'Hi', body: 'Body' };

describe('NotificationsService.send', () => {
  it('rejects a recipient that does not belong to the tenant', async () => {
    const { service, client } = makeService();
    client.user.findFirst.mockResolvedValue(null);
    await expect(service.send(TENANT, dto, 'actor-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(client.notification.create).not.toHaveBeenCalled();
  });

  it('rejects a scheduledAt in the past', async () => {
    const { service, client } = makeService();
    client.user.findFirst.mockResolvedValue({ id: 'user-9' });
    await expect(
      service.send(TENANT, { ...dto, scheduledAt: new Date(Date.now() - 60_000).toISOString() }, 'actor-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(client.notification.create).not.toHaveBeenCalled();
  });

  it('creates the notification and enqueues only tenantId + notificationId', async () => {
    const { service, client, queueAdd, auditService } = makeService();
    client.user.findFirst.mockResolvedValue({ id: 'user-9' });
    client.notification.create.mockResolvedValue({ id: 'n1', tenantId: TENANT, channel: 'EMAIL' });

    const result = await service.send(TENANT, dto, 'actor-1');
    expect(result).toMatchObject({ id: 'n1' });
    expect(client.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tenantId: TENANT, recipientUserId: 'user-9', status: 'PENDING' }) }),
    );
    expect(queueAdd).toHaveBeenCalledWith('deliver', { tenantId: TENANT, notificationId: 'n1' }, { delay: undefined });
    expect(auditService.record).toHaveBeenCalled();
  });

  it('marks a future-dated notification QUEUED and passes a positive delay', async () => {
    const { service, client, queueAdd } = makeService();
    client.user.findFirst.mockResolvedValue({ id: 'user-9' });
    client.notification.create.mockResolvedValue({ id: 'n2', tenantId: TENANT, channel: 'EMAIL' });

    await service.send(TENANT, { ...dto, scheduledAt: new Date(Date.now() + 3_600_000).toISOString() }, 'actor-1');
    expect(client.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'QUEUED' }) }),
    );
    const [, , options] = queueAdd.mock.calls[0]! as [string, unknown, { delay: number }];
    expect(options.delay).toBeGreaterThan(0);
  });
});

describe('NotificationsService.sendSystem', () => {
  it('creates + enqueues without a per-notification audit entry', async () => {
    const { service, client, queueAdd, auditService } = makeService();
    client.notification.create.mockResolvedValue({ id: 'n3', tenantId: TENANT, channel: 'IN_APP' });

    await service.sendSystem(TENANT, { recipientUserId: 'user-9', subject: 'S', body: 'B' });
    expect(queueAdd).toHaveBeenCalledWith('deliver', { tenantId: TENANT, notificationId: 'n3' }, { delay: undefined });
    expect(auditService.record).not.toHaveBeenCalled();
  });
});

describe('NotificationsService tenant-scoped reads', () => {
  it('getOne throws NotFound for a notification outside the tenant', async () => {
    const { service, client } = makeService();
    client.notification.findFirst.mockResolvedValue(null);
    await expect(service.getOne('other-tenant-notification')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('only allows marking IN_APP notifications as read', async () => {
    const { service, client } = makeService();
    client.notification.findFirst.mockResolvedValue({ id: 'n1', channel: 'EMAIL', readAt: null });
    await expect(service.markInboxItemRead('user-9', 'n1')).rejects.toBeInstanceOf(BadRequestException);
  });
});
