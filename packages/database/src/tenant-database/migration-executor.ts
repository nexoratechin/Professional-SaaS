/**
 * Applies Prisma schema migrations to an enterprise tenant's physical store.
 *
 * Enterprise stores are reconciled against the CURRENT Prisma schema rather than by replaying the
 * historical `prisma/migrations` files — that history is `public`-schema-qualified in places and
 * written for the shared database, so replaying it into a tenant schema/database would either
 * fail or target the wrong tables. Instead:
 *
 *   prisma migrate diff --from-url <store> --to-schema-datamodel <schema.prisma> --script
 *
 * produces exactly the DDL the store is missing (the full schema for an empty store, a delta for
 * an existing one; empty when already up to date), and
 *
 *   prisma db execute --file <sql> --url <store>
 *
 * applies it. This is idempotent and needs no shadow database.
 *
 * The executor is an interface so the provisioning/migration logic can be unit-tested without
 * spawning the Prisma CLI or touching a database.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface TenantMigrationExecutor {
  /** SQL that brings `targetUrl`'s store up to the current schema (empty when up to date). */
  generateMigrationSql(targetUrl: string): Promise<string>;
  /** Applies a SQL script to the store at `targetUrl`. */
  applySql(targetUrl: string, sql: string): Promise<void>;
}

export interface PrismaCliMigrationExecutorOptions {
  /** Absolute path to schema.prisma. */
  schemaPath: string;
  /** Absolute path to the Prisma CLI entry (build/index.js). Resolved automatically when omitted. */
  prismaCliPath?: string;
  /** Overrides `node` — primarily for tests. */
  nodePath?: string;
  /** Max time a single Prisma CLI invocation may take. */
  timeoutMs?: number;
}

/** Default executor: shells out to the locally-installed Prisma CLI (a devDependency of this package). */
export class PrismaCliMigrationExecutor implements TenantMigrationExecutor {
  private readonly schemaPath: string;
  private readonly prismaCliPath: string;
  private readonly nodePath: string;
  private readonly timeoutMs: number;

  constructor(options: PrismaCliMigrationExecutorOptions) {
    this.schemaPath = options.schemaPath;
    this.prismaCliPath = options.prismaCliPath ?? resolvePrismaCliPath();
    this.nodePath = options.nodePath ?? process.execPath;
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  async generateMigrationSql(targetUrl: string): Promise<string> {
    const { stdout } = await execFileAsync(
      this.nodePath,
      [
        this.prismaCliPath,
        'migrate',
        'diff',
        '--from-url',
        targetUrl,
        '--to-schema-datamodel',
        this.schemaPath,
        '--script',
      ],
      { timeout: this.timeoutMs, maxBuffer: 64 * 1024 * 1024 },
    );
    return stdout;
  }

  async applySql(targetUrl: string, sql: string): Promise<void> {
    if (!sql.trim()) return;
    const dir = await mkdtemp(join(tmpdir(), 'tenant-db-migrate-'));
    const file = join(dir, 'migration.sql');
    try {
      await writeFile(file, sql, 'utf8');
      await execFileAsync(
        this.nodePath,
        [this.prismaCliPath, 'db', 'execute', '--file', file, '--url', targetUrl],
        { timeout: this.timeoutMs, maxBuffer: 64 * 1024 * 1024 },
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

/**
 * Resolves the Prisma CLI entry point. Tries this package's own dependency tree first (it is a
 * devDependency of @college-erp/database), then the workspace root, then a bare `prisma` name so
 * a globally-installed CLI still works in a stripped-down runtime.
 */
export function resolvePrismaCliPath(): string {
  const candidates = [
    () => require.resolve('prisma/build/index.js'),
    () => require.resolve('prisma/build/index.js', { paths: [join(__dirname, '..', '..', '..', '..')] }),
  ];
  for (const resolveCandidate of candidates) {
    try {
      return resolveCandidate();
    } catch {
      // try the next candidate
    }
  }
  return 'prisma';
}
