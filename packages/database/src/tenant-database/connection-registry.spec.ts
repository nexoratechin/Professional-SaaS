import { TenantConnectionRegistry } from './connection-registry';
import { descriptorToTarget, descriptorsToTargets } from './connection-resolver';
import { TenantDatabaseSecretCipher } from './cipher';

describe('TenantConnectionRegistry', () => {
  it('starts empty and resolves dedicated targets only when registered', () => {
    const registry = new TenantConnectionRegistry();
    expect(registry.has('t1')).toBe(false);
    expect(registry.isDedicated('t1', 'SHARED')).toBe(false);
    expect(registry.isDedicated('t1', 'DEDICATED_SCHEMA')).toBe(true);

    registry.upsert({
      tenantId: 't1',
      mode: 'DEDICATED_SCHEMA',
      connectionUrl: 'postgresql://u:p@h/db?schema=tenant_x',
      schemaName: 'tenant_x',
      databaseName: null,
    });
    expect(registry.has('t1')).toBe(true);
    expect(registry.get('t1')?.schemaName).toBe('tenant_x');

    registry.remove('t1');
    expect(registry.has('t1')).toBe(false);
  });

  it('replaces all targets atomically', () => {
    const registry = new TenantConnectionRegistry();
    registry.upsert({ tenantId: 'old', mode: 'SHARED', connectionUrl: 'x', schemaName: null, databaseName: null });
    registry.replaceAll([
      { tenantId: 'a', mode: 'DEDICATED_SCHEMA', connectionUrl: 'a', schemaName: 'sa', databaseName: null },
    ]);
    expect(registry.list().map((t) => t.tenantId)).toEqual(['a']);
  });
});

describe('descriptorToTarget', () => {
  const cipher = new TenantDatabaseSecretCipher('b'.repeat(64));

  it('returns null for SHARED tenants', () => {
    expect(
      descriptorToTarget(
        { tenantId: 't1', mode: 'SHARED', status: 'NOT_APPLICABLE', schemaName: null, databaseName: null, connectionUrlEncrypted: null },
        cipher,
      ),
    ).toBeNull();
  });

  it('returns null until the store is READY and has a URL', () => {
    const base = {
      tenantId: 't1',
      mode: 'DEDICATED_DATABASE' as const,
      status: 'READY' as const,
      schemaName: null,
      databaseName: 'db',
      connectionUrlEncrypted: cipher.encrypt('postgresql://u:p@h/db') as string | null,
    };
    expect(descriptorToTarget({ ...base, status: 'PROVISIONING' }, cipher)).toBeNull();
    expect(descriptorToTarget({ ...base, connectionUrlEncrypted: null }, cipher)).toBeNull();
  });

  it('decrypts a READY descriptor', () => {
    const url = 'postgresql://u:p@h/tenant_db';
    const target = descriptorToTarget(
      {
        tenantId: 't1',
        mode: 'DEDICATED_DATABASE',
        status: 'READY',
        schemaName: null,
        databaseName: 'tenant_db',
        connectionUrlEncrypted: cipher.encrypt(url),
      },
      cipher,
    );
    expect(target?.connectionUrl).toBe(url);
  });

  it('filters descriptorsToTargets', () => {
    const targets = descriptorsToTargets(
      [
        { tenantId: 'a', mode: 'SHARED', status: 'NOT_APPLICABLE', schemaName: null, databaseName: null, connectionUrlEncrypted: null },
        {
          tenantId: 'b',
          mode: 'DEDICATED_SCHEMA',
          status: 'READY',
          schemaName: 's',
          databaseName: null,
          connectionUrlEncrypted: cipher.encrypt('postgresql://u:p@h/db?schema=s'),
        },
      ],
      cipher,
    );
    expect(targets.map((t) => t.tenantId)).toEqual(['b']);
  });
});
