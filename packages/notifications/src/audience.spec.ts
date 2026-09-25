import { resolveAudience } from './audience';
import type { NotificationAudienceFilter } from '@college-erp/types';

interface FakeRow {
  id?: string;
  userId?: string | null;
  scopeDepartmentId?: string | null;
  scopeCampusId?: string | null;
  batchId?: string | null;
  deletedAt?: string | null;
}

type Model = 'user' | 'userRole' | 'student';

function fakeClient(data: Record<Model, FakeRow[]>) {
  return {
    user: {
      findMany: jest.fn(async ({ select }: { where: { status?: { in?: string[] } }; select: { id: true } }) =>
        data.user.map((row) => ({ id: row.id })) as { id: string }[],
      ),
    },
    userRole: {
      findMany: jest.fn(async ({ where, select }: { where: Record<string, unknown>; select: { userId: true } }) =>
        data.userRole
          .filter((row) => matches(where, row))
          .map((row) => ({ userId: row.userId })) as { userId: string }[],
      ),
    },
    student: {
      findMany: jest.fn(async ({ where, select }: { where: Record<string, unknown>; select: { userId: true } }) =>
        data.student
          .filter((row) => matches(where, row))
          .map((row) => ({ userId: row.userId })) as { userId: string | null }[],
      ),
    },
  } as unknown as Parameters<typeof resolveAudience>[0];
}

function matches(where: Record<string, unknown>, row: FakeRow): boolean {
  const role = where.role as { code?: { in?: string[] } } | undefined;
  if (role?.code?.in && !role.code.in.includes(row.id ?? '')) return false;
  const scopeDept = where.scopeDepartmentId as { in?: string[] } | undefined;
  if (scopeDept?.in && !scopeDept.in.includes(row.scopeDepartmentId ?? '')) return false;
  const scopeCampus = where.scopeCampusId as { in?: string[] } | undefined;
  if (scopeCampus?.in && !scopeCampus.in.includes(row.scopeCampusId ?? '')) return false;
  const batch = where.batchId as { in?: string[] } | undefined;
  if (batch?.in && !batch.in.includes(row.batchId ?? '')) return false;
  const studentIds = where.id as { in?: string[] } | undefined;
  if (studentIds?.in && !studentIds.in.includes(row.id ?? '')) return false;
  const userIdFilter = where.userId as { not?: unknown } | undefined;
  if (userIdFilter?.not === null && row.userId === null) return false;
  if (where.deletedAt === null && row.deletedAt !== undefined && row.deletedAt !== null) return false;
  return true;
}

describe('resolveAudience', () => {
  it('selects all eligible users for ALL', async () => {
    const client = fakeClient({
      user: [
        { id: 'u1' },
        { id: 'u2' },
        { id: 'u3' },
        { id: 'u4' },
      ],
      userRole: [],
      student: [],
    });
    const result = await resolveAudience(client, { type: 'ALL' });
    expect(result.sort()).toEqual(['u1', 'u2', 'u3', 'u4']);
  });

  it('resolves ROLES to the users holding any of the role codes without duplicates', async () => {
    const client = fakeClient({
      user: [],
      userRole: [
        { userId: 'u1', id: 'FACULTY' },
        { userId: 'u2', id: 'HOD' },
        { userId: 'u1', id: 'HOD' },
        { userId: 'u5', id: 'STUDENT' },
      ],
      student: [],
    });
    const result = await resolveAudience(client, { type: 'ROLES', roleCodes: ['FACULTY', 'HOD'] });
    expect(result.sort()).toEqual(['u1', 'u2']);
  });

  it('resolves BATCHES to students in the batch who have a linked user account', async () => {
    const client = fakeClient({
      user: [],
      userRole: [],
      student: [
        { userId: 's1u', batchId: 'b1' },
        { userId: null, batchId: 'b1' },
        { userId: 's2u', batchId: 'b2' },
      ],
    });
    const result = await resolveAudience(client, { type: 'BATCHES', batchIds: ['b1'] });
    expect(result).toEqual(['s1u']);
  });

  it('returns an empty list for filters with no ids', async () => {
    const client = fakeClient({ user: [], userRole: [], student: [] });
    expect(await resolveAudience(client, { type: 'ROLES', roleCodes: [] })).toEqual([]);
    expect(await resolveAudience(client, { type: 'USERS' })).toEqual([]);
  });
});