import type { PrismaClient } from '@prisma/client';
import { TenantPrismaClientPool } from './client-pool';

const SHARED_URL = 'postgresql://u:p@localhost:5432/shared';

function fakeSharedClient(): PrismaClient {
  return { $disconnect: async () => undefined } as unknown as PrismaClient;
}

describe('TenantPrismaClientPool', () => {
  it('returns the shared client for the shared URL', () => {
    const shared = fakeSharedClient();
    const pool = new TenantPrismaClientPool({ sharedClient: shared, sharedUrl: SHARED_URL });
    expect(pool.getClient(SHARED_URL)).toBe(shared);
    expect(pool.size).toBe(0);
  });

  it('caches a dedicated client per URL', () => {
    const pool = new TenantPrismaClientPool({ sharedClient: fakeSharedClient(), sharedUrl: SHARED_URL });
    const url = 'postgresql://u:p@localhost:5432/tenant_a';
    const first = pool.getClient(url);
    const second = pool.getClient(url);
    expect(first).toBe(second);
    expect(pool.size).toBe(1);
  });

  it('evicts the oldest client beyond the bound', async () => {
    const pool = new TenantPrismaClientPool({
      sharedClient: fakeSharedClient(),
      sharedUrl: SHARED_URL,
      maxClients: 1,
    });
    pool.getClient('postgresql://u:p@localhost:5432/a');
    pool.getClient('postgresql://u:p@localhost:5432/b');
    expect(pool.size).toBe(1);
    await pool.disconnectAll();
    expect(pool.size).toBe(0);
  });
});
