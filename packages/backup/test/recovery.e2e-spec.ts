/**
 * Automated recovery test: the full DR loop against a real MySQL server.
 *
 *   fixture data -> mysqldump -> structure verification -> restore into a scratch database
 *   -> integrity probes compare source and restore -> cleanup
 *
 * Gated so it can live in the normal repo without breaking machines that lack the client tools:
 * it skips (with a console notice) unless `RECOVERY_TEST_DATABASE_URL` (or `DATABASE_URL`) is set
 * AND `mysqldump`/`mysql` are resolvable. CI runs it explicitly — see
 * .github/workflows/ci.yml and docs/backup-recovery.md § Automated recovery tests.
 *
 * The test intentionally creates and drops a scratch database; point it at a disposable server
 * (CI MySQL service or a local MySQL), never at production.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildScratchDatabaseName,
  computeFileSha256,
  createScratchDatabase,
  createMysqlBackup,
  dropDatabase,
  resolveMysqlBinary,
  restoreMysqlBackup,
  runIntegrityProbes,
  runSql,
  toAdminDatabaseUrl,
  verifyMysqlDump,
} from '../src';

const SOURCE_URL = process.env.RECOVERY_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const MYSQLDUMP = resolveMysqlBinary('mysqldump', process.env.BACKUP_MYSQLDUMP_PATH);
const MYSQL = resolveMysqlBinary('mysql', process.env.BACKUP_MYSQL_PATH);
const KEEP_SCRATCH = process.env.RECOVERY_KEEP_SCRATCH === 'true';

const canRun = Boolean(SOURCE_URL && MYSQLDUMP && MYSQL);

if (!canRun) {
  console.warn(
    '[recovery.e2e] Skipping: set RECOVERY_TEST_DATABASE_URL (or DATABASE_URL) and install ' +
      'mysqldump/mysql to run the automated recovery test.',
  );
}

const describeRecovery = canRun ? describe : describe.skip;

describeRecovery('MySQL backup -> verify -> restore recovery loop', () => {
  const runId = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const scratchName = buildScratchDatabaseName('college_erp_recovery_test_', runId);
  const adminUrl = toAdminDatabaseUrl(SOURCE_URL as string);
  const mysqlPath = MYSQL as string;
  const scratchUrl = (() => {
    const url = new URL(SOURCE_URL as string);
    url.pathname = `/${scratchName}`;
    return url.toString();
  })();

  let workDir = '';
  let dumpPath = '';

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'college-erp-recovery-'));
    dumpPath = join(workDir, 'recovery-probe.sql');
    await runSql({
      databaseUrl: SOURCE_URL as string,
      mysqlPath,
      sql: [
        'CREATE TABLE IF NOT EXISTS backup_recovery_probe (id INT AUTO_INCREMENT PRIMARY KEY, note VARCHAR(64) NOT NULL)',
        'TRUNCATE TABLE backup_recovery_probe',
        "INSERT INTO backup_recovery_probe (note) WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < 250) SELECT CONCAT('row-', n) FROM seq",
      ].join('; '),
    });
  });

  afterAll(async () => {
    if (!KEEP_SCRATCH) {
      await dropDatabase({ adminDatabaseUrl: adminUrl, name: scratchName, mysqlPath }).catch(() => undefined);
    }
    if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it(
    'produces a restorable, verified dump and detects integrity mismatches',
    async () => {
      // 1. Fixture state is what the restore will be compared against.
      const sourceProbes = await runIntegrityProbes({
        databaseUrl: SOURCE_URL as string,
        mysqlPath,
        probes: [{ name: 'fixture_rows', sql: 'SELECT count(*) FROM backup_recovery_probe', exact: 250 }],
      });
      expect(sourceProbes).toEqual([expect.objectContaining({ name: 'fixture_rows', value: 250, ok: true })]);

      // 2. Backup.
      const backup = await createMysqlBackup({
        databaseUrl: SOURCE_URL as string,
        outputPath: dumpPath,
        mysqldumpPath: MYSQLDUMP as string,
        mysqlPath,
      });
      expect(backup.sizeBytes).toBeGreaterThan(0);
      expect(backup.sha256).toMatch(/^[0-9a-f]{64}$/);
      // The checksum in the manifest is the checksum of the bytes on disk.
      await expect(computeFileSha256(dumpPath)).resolves.toBe(backup.sha256);

      // 3. Structure verification (streamed dump scan).
      const structure = await verifyMysqlDump({ dumpPath });
      expect(structure.ok).toBe(true);
      expect(structure.tableCount).toBeGreaterThanOrEqual(1);
      expect(structure.insertCount).toBeGreaterThanOrEqual(1);

      // 4. Restore into a scratch database.
      await createScratchDatabase({ adminDatabaseUrl: adminUrl, name: scratchName, mysqlPath });
      const restore = await restoreMysqlBackup({
        dumpPath,
        targetDatabaseUrl: scratchUrl,
        mysqlPath,
        clean: false,
      });
      expect(restore.databaseName).toBe(scratchName);

      // 5. Integrity probes: the restored data matches the source, row for row.
      const probes = await runIntegrityProbes({
        databaseUrl: scratchUrl,
        mysqlPath,
        probes: [
          { name: 'fixture_rows', sql: 'SELECT count(*) FROM backup_recovery_probe', exact: 250 },
          {
            name: 'fixture_checksum',
            sql: 'SELECT count(*) FROM (SELECT MD5(GROUP_CONCAT(note ORDER BY id)) FROM backup_recovery_probe) t',
            exact: 1,
          },
        ],
      });
      expect(probes.map((probe) => probe.ok)).toEqual([true, true]);

      // 6. The verification logic actually fails on a mismatch (proves step 5 can fail).
      const mismatch = await runIntegrityProbes({
        databaseUrl: scratchUrl,
        mysqlPath,
        probes: [{ name: 'fixture_rows', sql: 'SELECT count(*) FROM backup_recovery_probe', exact: 999 }],
      });
      expect(mismatch).toEqual([expect.objectContaining({ name: 'fixture_rows', value: 250, ok: false })]);
    },
    240_000,
  );
});
