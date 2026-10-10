import { parseDatabaseUrl, redactDatabaseUrl } from './pg-tools';
import { parsePgRestoreToc } from './postgres-verify';
import { assertDatabaseIdentifier, buildScratchDatabaseName, toAdminDatabaseUrl } from './psql';

describe('parseDatabaseUrl', () => {
  it('extracts connection parts and moves the password out of the URL', () => {
    const info = parseDatabaseUrl('postgresql://college_erp:p%40ss%2Fword@db.internal:5433/college_erp?sslmode=require');
    expect(info).toMatchObject({
      host: 'db.internal',
      port: 5433,
      database: 'college_erp',
      user: 'college_erp',
      password: 'p@ss/word',
      sslmode: 'require',
    });
    expect(info.sanitizedUrl).not.toContain('p%40ss');
    expect(info.sanitizedUrl).toContain('sslmode=require');
  });

  it('drops Prisma-only parameters that libpq would reject', () => {
    const info = parseDatabaseUrl(
      'postgresql://u:p@localhost:5432/db?schema=public&connection_limit=5&pool_timeout=10&sslmode=disable',
    );
    expect(info.sanitizedUrl).not.toContain('schema=');
    expect(info.sanitizedUrl).not.toContain('connection_limit');
    expect(info.sanitizedUrl).not.toContain('pool_timeout');
    expect(info.sanitizedUrl).toContain('sslmode=disable');
  });

  it('rejects non-postgres URLs and missing database names', () => {
    expect(() => parseDatabaseUrl('mysql://u:p@localhost/db')).toThrow(/postgresql/);
    expect(() => parseDatabaseUrl('postgresql://localhost')).toThrow(/database name/);
  });
});

describe('redactDatabaseUrl', () => {
  it('removes the password', () => {
    expect(redactDatabaseUrl('postgresql://u:secret@localhost:5432/db')).toBe('postgresql://u@localhost:5432/db');
    expect(redactDatabaseUrl('not a url')).toBe('<invalid database url>');
  });
});

describe('parsePgRestoreToc', () => {
  it('counts TOC entries, tables and table-data entries', () => {
    const toc = [
      ';',
      '; Archive created at 2026-10-09 02:15:30 UTC',
      ';',
      '215; 1259 16385 TABLE public students postgres',
      '216; 1259 16386 TABLE public users postgres',
      '3856; 0 16385 TABLE DATA public students postgres',
      '3857; 0 16386 TABLE DATA public users postgres',
      '3890; 0 0 SEQUENCE SET public students_id_seq postgres',
      '3900; 2604 16387 DEFAULT public students id postgres',
    ].join('\n');
    const result = parsePgRestoreToc(toc);
    expect(result).toEqual({ entries: 6, tableEntries: 2, tableDataEntries: 2 });
  });

  it('returns zeroes for an empty/garbage listing', () => {
    expect(parsePgRestoreToc('')).toEqual({ entries: 0, tableEntries: 0, tableDataEntries: 0 });
    expect(parsePgRestoreToc('pg_restore: error: could not read')).toEqual({
      entries: 0,
      tableEntries: 0,
      tableDataEntries: 0,
    });
  });
});

describe('scratch database names', () => {
  it('sanitizes into a valid identifier and truncates to 63 characters', () => {
    const name = buildScratchDatabaseName('college_erp_recovery_test_', '20261009T021530Z-AB/CD');
    expect(name).toMatch(/^[a-z_][a-z0-9_]{0,62}$/);
    expect(name.length).toBeLessThanOrEqual(63);
    expect(name).not.toContain('/');
  });

  it('rejects invalid identifiers', () => {
    expect(() => assertDatabaseIdentifier('bad-name')).toThrow(/Invalid database identifier/);
    expect(() => assertDatabaseIdentifier('1leading')).toThrow(/Invalid database identifier/);
  });

  it('derives the maintenance database URL', () => {
    expect(toAdminDatabaseUrl('postgresql://u:p@localhost:5432/college_erp?sslmode=require')).toContain(
      '/postgres?sslmode=require',
    );
  });
});
