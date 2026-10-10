/**
 * Automated recovery tests: real pg_dump -> pg_restore -> integrity verification against a live
 * PostgreSQL server. Separate from the default (unit) suite because it needs `pg_dump`, `pg_restore`
 * and `psql` on PATH plus a database it may write to (`RECOVERY_TEST_DATABASE_URL`, falling back to
 * `DATABASE_URL`). Tests self-skip when either is missing — see docs/backup-recovery.md.
 *
 * @type {import('jest').Config}
 */
module.exports = {
  rootDir: 'test',
  testRegex: '.*\\.e2e-spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  moduleFileExtensions: ['js', 'json', 'ts'],
  testEnvironment: 'node',
  testTimeout: 300_000,
};
