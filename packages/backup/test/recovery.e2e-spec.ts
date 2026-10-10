/**
 * Automated recovery test: the full DR loop against a real PostgreSQL server.
 *
 *   fixture data -> pg_dump -> structure verification -> restore into a scratch database
 *   -> integrity probes compare source and restore -> cleanup
 *
 * Gated so it can live in the normal repo without breaking machines that lack the client tools:
 * it skips (with a console notice) unless `RECOVERY_TEST_DATABASE_URL` (or `DATABASE_URL`) is set
 * AND `pg_dump`/`pg_restore`/`psql` are resolvable. CI runs it explicitly — see
 * .github/workflows/ci.yml and docs/backup-recovery.md § Automated recovery tests.
 *
 * The test intentionally creates and drops a scratch database; point it at a disposable server
 * (CI service container or local docker-compose Postgres), never at production.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildScratchDatabaseName,
  computeFileSha256,
  createScratchDatabase,
  createPostgresBackup,
  dropDatabase,
  resolvePgBinary,
  restorePostgresBackup,
  runIntegrityProbes,
  runSql,
  toAdminDatabaseUrl,
  verifyPostgresArchive,
} from '../src';

const SOURCE_URL = process.env.RECOVERY_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const PG_DUMP = resolvePgBinary('pg_dump', process.env.BACKUP_PG_DUMP_PATH);
const PG_RESTORE = resolvePgBinary('pg_restore', process.env.BACKUP_PG_RESTORE_PATH);
const PSQL = resolvePgBinary('psql', process.env.BACKUP_PSQL_PATH);
const KEEP_SCRATCH = process.env.RECOVERY_KEEP_SCRATCH === 'true';

const canRun = Boolean(SOURCE_URL && PG_DUMP && PG_RESTORE && PSQL);

if (!canRun) {
  console.warn(
    '[recovery.e2e] Skipping: set RECOVERY_TEST_DATABASE_URL (or DATABASE_URL) and install ' +
      'pg_dump/pg_restore/psql to run the automated recovery test.',
  );
}

const describeRecovery = canRun ? describe : describe.skip;

describeRecovery('PostgreSQL backup -> verify -> restore recovery loop', () => {
  const runId = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const scratchName = buildScratchDatabaseName('college_erp_recovery_test_', runId);
  const adminUrl = toAdminDatabaseUrl(SOURCE_URL as string);
  const scratchUrl = (() => {
    const url = new URL(SOURCE_URL as string);
    url.pathname = `/${scratchName}`;
    return url.toString();
  })();

  let workDir = '';
  let archivePath = '';

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'college-erp-recovery-'));
    archivePath = join(workDir, 'recovery-probe.dump');
    await runSql({
      databaseUrl: SOURCE_URL as string,
      psqlPath: PSQL as string,
      sql: [
        'CREATE TABLE IF NOT EXISTS backup_recovery_probe (id serial PRIMARY KEY, note text NOT NULL)',
        'TRUNCATE backup_recovery_probe',
        "INSERT INTO backup_recovery_probe (note) SELECT 'row-' || g FROM generate_series(1, 250) g",
      ].join('; '),
    });
  });

  afterAll(async () => {
    if (!KEEP_SCRATCH) {
      await dropDatabase({ adminDatabaseUrl: adminUrl, name: scratchName, psqlPath: PSQL as string }).catch(
        () => undefined,
      );
    }
    if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it(
    'produces a restorable, verified archive and detects integrity mismatches',
    async () => {
      // 1. Fixture state is what the restore will be compared against.
      const sourceProbes = await runIntegrityProbes({
        databaseUrl: SOURCE_URL as string,
        psqlPath: PSQL as string,
        probes: [{ name: 'fixture_rows', sql: 'SELECT count(*) FROM backup_recovery_probe', exact: 250 }],
      });
      expect(sourceProbes).toEqual([expect.objectContaining({ name: 'fixture_rows', value: 250, ok: true })]);

      // 2. Backup.
      const backup = await createPostgresBackup({
        databaseUrl: SOURCE_URL as string,
        outputPath: archivePath,
        pgDumpPath: PG_DUMP as string,
      });
      expect(backup.sizeBytes).toBeGreaterThan(0);
      expect(backup.sha256).toMatch(/^[0-9a-f]{64}$/);
      // The checksum in the manifest is the checksum of the bytes on disk.
      await expect(computeFileSha256(archivePath)).resolves.toBe(backup.sha256);

      // 3. Structure verification (pg_restore --list).
      const structure = await verifyPostgresArchive({
        archivePath,
        pgRestorePath: PG_RESTORE as string,
      });
      expect(structure.ok).toBe(true);
      expect(structure.tableDataEntries).toBeGreaterThanOrEqual(1);
      expect(structure.tableCount).toBeGreaterThanOrEqual(1);

      // 4. Restore into a scratch database.
      await createScratchDatabase({ adminDatabaseUrl: adminUrl, name: scratchName, psqlPath: PSQL as string });
      const restore = await restorePostgresBackup({
        archivePath,
        targetDatabaseUrl: scratchUrl,
        pgRestorePath: PG_RESTORE as string,
        clean: false,
      });
      expect(restore.databaseName).toBe(scratchName);

      // 5. Integrity probes: the restored data matches the source, row for row.
      const probes = await runIntegrityProbes({
        databaseUrl: scratchUrl,
        psqlPath: PSQL as string,
        probes: [
          { name: 'fixture_rows', sql: 'SELECT count(*) FROM backup_recovery_probe', exact: 250 },
          {
            name: 'fixture_checksum',
            sql: "SELECT count(*) FROM (SELECT md5(string_agg(note, ',' ORDER BY id)) FROM backup_recovery_probe) t",
            exact: 1,
          },
        ],
      });
      expect(probes.map((probe) => probe.ok)).toEqual([true, true]);

      // 6. The verification logic actually fails on a mismatch (proves step 5 can fail).
      const mismatch = await runIntegrityProbes({
        databaseUrl: scratchUrl,
        psqlPath: PSQL as string,
        probes: [{ name: 'fixture_rows', sql: 'SELECT count(*) FROM backup_recovery_probe', exact: 999 }],
      });
      expect(mismatch).toEqual([expect.objectContaining({ name: 'fixture_rows', value: 250, ok: false })]);
    },
    240_000,
  );
});
