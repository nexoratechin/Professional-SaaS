/**
 * Automated recovery tests: real mysqldump -> mysql restore -> integrity verification against a live
 * MySQL server. Separate from the default (unit) suite because it needs `mysqldump` and `mysql`
 * on PATH plus a database it may write to (`RECOVERY_TEST_DATABASE_URL`, falling back to
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
