import { TenantMembershipService } from './tenant-membership.service';

function makeService() {
  const tenantMembership = {
    upsert: jest.fn().mockResolvedValue({}),
    findMany: jest.fn().mockResolvedValue([]),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const platformPrisma = { client: { tenantMembership } };
  const service = new TenantMembershipService(platformPrisma as never);
  return { service, tenantMembership };
}

describe('TenantMembershipService', () => {
  it('records memberships under a normalized email and the opaque tenant id', async () => {
    const { service, tenantMembership } = makeService();

    await service.record({ tenantId: 't1', userId: 'u1', email: '  Dean@Alpha.EDU ' });

    expect(tenantMembership.upsert).toHaveBeenCalledWith({
      where: { email_tenantId: { email: 'dean@alpha.edu', tenantId: 't1' } },
      update: { userId: 'u1' },
      create: { email: 'dean@alpha.edu', tenantId: 't1', userId: 'u1', isActive: true },
    });
  });

  it('can record an inactive membership (unfinished onboarding)', async () => {
    const { service, tenantMembership } = makeService();

    await service.record({ tenantId: 't1', userId: 'u1', email: 'dean@alpha.edu', isActive: false });

    expect(tenantMembership.upsert.mock.calls[0][0].create.isActive).toBe(false);
  });

  it('toggles activity by tenant + tenant-local user id', async () => {
    const { service, tenantMembership } = makeService();

    await service.setActive('t1', 'u1', false);

    expect(tenantMembership.updateMany).toHaveBeenCalledWith({
      where: { tenantId: 't1', userId: 'u1' },
      data: { isActive: false },
    });
  });

  it('never lets a directory failure break a user status change', async () => {
    const { service, tenantMembership } = makeService();
    tenantMembership.updateMany.mockRejectedValueOnce(new Error('db down'));

    await expect(service.setActive('t1', 'u1', false)).resolves.toBeUndefined();
  });

  it('lists active memberships of live tenants and marks the current one', async () => {
    const { service, tenantMembership } = makeService();
    tenantMembership.findMany.mockResolvedValue([
      { tenantId: 't2', tenant: { slug: 'beta', name: 'Beta College', status: 'TRIAL' } },
      { tenantId: 't1', tenant: { slug: 'alpha', name: 'Alpha College', status: 'ACTIVE' } },
    ]);

    const result = await service.listForUser('t1', 'u1', 'dean@alpha.edu');

    expect(tenantMembership.findMany).toHaveBeenCalledWith({
      where: {
        email: 'dean@alpha.edu',
        isActive: true,
        tenant: { status: { in: ['TRIAL', 'ACTIVE'] } },
      },
      include: { tenant: { select: { slug: true, name: true, status: true } } },
    });
    expect(result).toEqual([
      { slug: 'alpha', name: 'Alpha College', status: 'ACTIVE', isCurrent: true },
      { slug: 'beta', name: 'Beta College', status: 'TRIAL', isCurrent: false },
    ]);
  });

  it('self-heals a missing row without reactivating an existing one', async () => {
    const { service, tenantMembership } = makeService();

    await service.listForUser('t1', 'u1', 'dean@alpha.edu');

    expect(tenantMembership.upsert).toHaveBeenCalledWith({
      where: { email_tenantId: { email: 'dean@alpha.edu', tenantId: 't1' } },
      update: {},
      create: { email: 'dean@alpha.edu', tenantId: 't1', userId: 'u1' },
    });
  });

  it('returns no workspaces for an empty email without touching the database', async () => {
    const { service, tenantMembership } = makeService();

    await expect(service.listForUser('t1', 'u1', '   ')).resolves.toEqual([]);
    expect(tenantMembership.findMany).not.toHaveBeenCalled();
  });
});
