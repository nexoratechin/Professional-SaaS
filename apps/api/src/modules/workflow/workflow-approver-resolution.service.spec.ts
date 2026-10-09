/**
 * WorkflowApproverResolutionService — turns a transition's approver slot into the concrete users
 * allowed to act right now, reusing the hierarchical RBAC UserRole scope columns. Mocked
 * tenant-scoped client (no DB).
 */
import type { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import {
  KNOWN_SCOPE_FIELDS,
  WorkflowApproverResolutionService,
  type ApproverSlot,
} from './workflow-approver-resolution.service';

function slot(overrides: Partial<ApproverSlot> = {}): ApproverSlot {
  return { approverType: 'ROLE', roleCode: null, specificUserId: null, scopeField: null, ...overrides };
}

function makeService() {
  const client = {
    user: { findFirst: jest.fn() },
    userRole: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const tenantPrisma = { client } as unknown as TenantScopedPrismaService;
  return { service: new WorkflowApproverResolutionService(tenantPrisma), client };
}

describe('WorkflowApproverResolutionService.resolveEligibleUsers', () => {
  it('resolves a SPECIFIC_USER slot to the active user', async () => {
    const { service, client } = makeService();
    client.user.findFirst.mockResolvedValue({ id: 'u1', email: 'hod@example.com' });

    const result = await service.resolveEligibleUsers(slot({ approverType: 'SPECIFIC_USER', specificUserId: 'u1' }), null);
    expect(result).toEqual([{ userId: 'u1', email: 'hod@example.com' }]);
    expect(client.user.findFirst).toHaveBeenCalledWith({
      where: { id: 'u1', status: 'ACTIVE' },
      select: { id: true, email: true },
    });
  });

  it('returns [] for a SPECIFIC_USER slot with no user id', async () => {
    const { service, client } = makeService();
    await expect(service.resolveEligibleUsers(slot({ approverType: 'SPECIFIC_USER' }), null)).resolves.toEqual([]);
    expect(client.user.findFirst).not.toHaveBeenCalled();
  });

  it('returns [] when the specific user is missing or inactive', async () => {
    const { service, client } = makeService();
    client.user.findFirst.mockResolvedValue(null);
    await expect(
      service.resolveEligibleUsers(slot({ approverType: 'SPECIFIC_USER', specificUserId: 'gone' }), null),
    ).resolves.toEqual([]);
  });

  it('returns [] for a ROLE slot without a roleCode', async () => {
    const { service, client } = makeService();
    await expect(service.resolveEligibleUsers(slot(), null)).resolves.toEqual([]);
    expect(client.userRole.findMany).not.toHaveBeenCalled();
  });

  it('dedupes users holding the role through multiple assignments', async () => {
    const { service, client } = makeService();
    client.userRole.findMany.mockResolvedValue([
      { user: { id: 'u1', email: 'a@example.com' } },
      { user: { id: 'u1', email: 'a@example.com' } },
      { user: { id: 'u2', email: 'b@example.com' } },
    ]);

    const result = await service.resolveEligibleUsers(slot({ roleCode: 'HOD' }), null);
    expect(result).toHaveLength(2);
    expect(new Set(result.map((r) => r.userId))).toEqual(new Set(['u1', 'u2']));
  });

  it('scopes a ROLE slot by the context scope value when scopeField is known', async () => {
    const { service, client } = makeService();
    client.userRole.findMany.mockResolvedValue([]);

    await service.resolveEligibleUsers(slot({ roleCode: 'HOD', scopeField: 'departmentId' }), { departmentId: 'd1' });
    expect(client.userRole.findMany).toHaveBeenCalledWith({
      where: {
        role: { code: 'HOD', deletedAt: null },
        user: { status: 'ACTIVE' },
        OR: [{ scopeDepartmentId: null }, { scopeDepartmentId: 'd1' }],
      },
      include: { user: { select: { id: true, email: true } } },
    });
  });

  it('treats an unknown scopeField as unscoped (GLOBAL-only holders) without an OR clause', async () => {
    const { service, client } = makeService();
    await service.resolveEligibleUsers(slot({ roleCode: 'HOD', scopeField: 'notAField' }), { departmentId: 'd1' });
    const arg = client.userRole.findMany.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect(arg.where.OR).toBeUndefined();
  });
});

describe('WorkflowApproverResolutionService.isUserEligible', () => {
  it('is true only when the user is among the resolved approvers', async () => {
    const { service, client } = makeService();
    client.user.findFirst.mockResolvedValue({ id: 'u1', email: 'a@example.com' });
    await expect(
      service.isUserEligible(slot({ approverType: 'SPECIFIC_USER', specificUserId: 'u1' }), null, 'u1'),
    ).resolves.toBe(true);
    await expect(
      service.isUserEligible(slot({ approverType: 'SPECIFIC_USER', specificUserId: 'u1' }), null, 'u2'),
    ).resolves.toBe(false);
  });
});

describe('KNOWN_SCOPE_FIELDS', () => {
  it('is exactly the three UserRole scope columns', () => {
    expect([...KNOWN_SCOPE_FIELDS].sort()).toEqual(['campusId', 'departmentId', 'programId']);
  });
});
