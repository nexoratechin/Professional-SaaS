import {
  InvalidTenantDatabaseIdentifierError,
  assertValidDatabaseName,
  assertValidSchemaName,
  databaseNameFromUrl,
  deriveDatabaseName,
  deriveSchemaName,
  quoteIdentifier,
  slugToIdentifier,
  withDatabaseName,
  withSchemaParam,
} from './identifiers';

describe('tenant database identifiers', () => {
  it('accepts safe identifiers', () => {
    expect(assertValidSchemaName('tenant_acme_college')).toBe('tenant_acme_college');
    expect(assertValidDatabaseName('college_erp_tenant_acme')).toBe('college_erp_tenant_acme');
  });

  it('rejects unsafe identifiers', () => {
    for (const bad of ['', 'Tenant', '1tenant', 'tenant-a', 'tenant a', 'tenant;drop', 'a'.repeat(64)]) {
      expect(() => assertValidSchemaName(bad)).toThrow(InvalidTenantDatabaseIdentifierError);
    }
  });

  it('normalises slugs to identifiers', () => {
    expect(slugToIdentifier('Acme-College 2026')).toBe('acme_college_2026');
    expect(slugToIdentifier('--edge--')).toBe('edge');
  });

  it('derives prefixed names', () => {
    expect(deriveSchemaName('tenant_', 'Acme College')).toBe('tenant_acme_college');
    expect(deriveDatabaseName('college_erp_tenant_', 'acme')).toBe('college_erp_tenant_acme');
  });

  it('quotes identifiers defensively', () => {
    expect(quoteIdentifier('tenant_x')).toBe('"tenant_x"');
    expect(quoteIdentifier('we"ird')).toBe('"we""ird"');
  });

  it('sets the schema parameter without losing credentials or query params', () => {
    const url = withSchemaParam('postgresql://u:p@localhost:5432/db?sslmode=require', 'tenant_x');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('schema')).toBe('tenant_x');
    expect(parsed.searchParams.get('sslmode')).toBe('require');
    expect(parsed.username).toBe('u');
    expect(parsed.password).toBe('p');
  });

  it('swaps the database name', () => {
    const url = withDatabaseName('postgresql://u:p@localhost:5432/shared_db', 'tenant_db');
    expect(databaseNameFromUrl(url)).toBe('tenant_db');
  });
});
