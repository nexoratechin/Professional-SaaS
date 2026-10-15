import { parseDatabaseUrl } from './mysql-tools';
import { redactDatabaseUrl } from '../tools';
import { scanMysqlDump } from './mysql-verify';
import { assertDatabaseIdentifier, buildScratchDatabaseName, toAdminDatabaseUrl } from './mysql';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('parseDatabaseUrl', () => {
  it('extracts connection parts and moves the password out of the URL', () => {
    const info = parseDatabaseUrl('mysql://college_erp:p%40ss%2Fword@db.internal:3306/college_erp?ssl-mode=REQUIRED');
    expect(info).toMatchObject({
      host: 'db.internal',
      port: 3306,
      database: 'college_erp',
      user: 'college_erp',
      password: 'p@ss/word',
      sslMode: 'REQUIRED',
    });
    expect(info.sanitizedUrl).not.toContain('p%40ss');
    expect(info.sanitizedUrl).toContain('ssl-mode=REQUIRED');
  });

  it('drops Prisma-only parameters the mysql client would reject', () => {
    const info = parseDatabaseUrl(
      'mysql://u:p@localhost:3306/db?connection_limit=5&pool_timeout=10&ssl-mode=REQUIRED',
    );
    expect(info.sanitizedUrl).not.toContain('connection_limit');
    expect(info.sanitizedUrl).not.toContain('pool_timeout');
    expect(info.sanitizedUrl).toContain('ssl-mode=REQUIRED');
  });

  it('rejects non-mysql URLs and missing database names', () => {
    expect(() => parseDatabaseUrl('postgresql://u:p@localhost/db')).toThrow(/mysql/);
    expect(() => parseDatabaseUrl('mysql://localhost')).toThrow(/database name/);
  });
});

describe('redactDatabaseUrl', () => {
  it('removes the password', () => {
    expect(redactDatabaseUrl('mysql://u:secret@localhost:3306/db')).toBe('mysql://u@localhost:3306/db');
    expect(redactDatabaseUrl('not a url')).toBe('<invalid database url>');
  });
});

describe('scanMysqlDump', () => {
  it('counts CREATE TABLE / INSERT INTO statements and detects the completion marker', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mysql-dump-scan-'));
    const file = join(dir, 'dump.sql');
    await writeFile(
      file,
      [
        '-- MySQL dump 10.13',
        '',
        'CREATE TABLE `tenants` (',
        '  `id` char(36) NOT NULL',
        ');',
        'CREATE TABLE `users` (',
        '  `id` char(36) NOT NULL',
        ');',
        'INSERT INTO `tenants` VALUES (...);',
        '-- Dump completed on 2026-10-15  9:00:00',
      ].join('\n'),
      'utf8',
    );
    const structure = await scanMysqlDump(file);
    expect(structure).toEqual({ tableCount: 2, insertCount: 1, completed: true });
  });
});

describe('scratch database names', () => {
  it('sanitizes into a valid identifier and truncates to 64 characters', () => {
    const name = buildScratchDatabaseName('college_erp_recovery_test_', '20261009T021530Z-AB/CD');
    expect(name).toMatch(/^[a-z_][a-z0-9_]{0,63}$/);
    expect(name.length).toBeLessThanOrEqual(64);
    expect(name).not.toContain('/');
  });

  it('rejects invalid identifiers', () => {
    expect(() => assertDatabaseIdentifier('bad-name')).toThrow(/Invalid database identifier/);
    expect(() => assertDatabaseIdentifier('1leading')).toThrow(/Invalid database identifier/);
  });

  it('derives the maintenance database URL (information_schema)', () => {
    expect(toAdminDatabaseUrl('mysql://u:p@localhost:3306/college_erp?ssl-mode=REQUIRED')).toContain(
      '/information_schema?ssl-mode=REQUIRED',
    );
  });
});
