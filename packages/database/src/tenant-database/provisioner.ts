/**
 * Tenant database provisioning abstraction.
 *
 * One strategy per isolation mode, behind a single interface, so callers (the API's
 * TenantDatabaseService and the operator CLI) never branch on the mode themselves:
 *
 *   SHARED             no physical provisioning — the tenant keeps using the shared database.
 *   DEDICATED_SCHEMA   CREATE SCHEMA in the shared database, then a schema-scoped URL.
 *   DEDICATED_DATABASE CREATE DATABASE, then a URL pointing at it.
 *
 * Both dedicated modes are then reconciled to the current Prisma schema via the injected
 * TenantMigrationExecutor (see migration-executor.ts) unless migration mode is `manual`.
 *
 * The provisioner is deliberately free of Nest/HTTP concerns so it can run from a one-off
 * operator script as well as from a request.
 */
import { PrismaClient } from '@prisma/client';
import {
  assertValidDatabaseName,
  assertValidSchemaName,
  deriveDatabaseName,
  deriveSchemaName,
  quoteIdentifier,
  withDatabaseName,
  withSchemaParam,
} from './identifiers';
import type {
  TenantConnectionTarget,
  TenantDatabaseProvisionContext,
  TenantDatabaseProvisionResult,
  TenantDatabaseMigrationMode,
  TenantMigrationResult,
} from './types';

/** Minimal DDL seam so provisioning can be unit-tested without a database. */
export interface TenantAdminSqlRunner {
  execute(sql: string): Promise<void>;
  queryExists(sql: string, value: string): Promise<boolean>;
  dispose(): Promise<void>;
}

export type TenantAdminSqlRunnerFactory = (adminUrl: string) => TenantAdminSqlRunner;

export interface TenantDatabaseProvisionerOptions {
  /** The shared database URL (also the base for DEDICATED_SCHEMA). */
  sharedUrl: string;
  /** Privileged URL used to CREATE DATABASE / CREATE SCHEMA; defaults to `sharedUrl`. */
  adminUrl?: string;
  schemaPrefix: string;
  databasePrefix: string;
  migrationMode: TenantDatabaseMigrationMode;
  migrationExecutor: {
    generateMigrationSql(targetUrl: string): Promise<string>;
    applySql(targetUrl: string, sql: string): Promise<void>;
  };
  adminSqlRunnerFactory?: TenantAdminSqlRunnerFactory;
}

export class TenantDatabaseProvisioner {
  private readonly sharedUrl: string;
  private readonly adminUrl: string;
  private readonly schemaPrefix: string;
  private readonly databasePrefix: string;
  private readonly migrationMode: TenantDatabaseMigrationMode;
  private readonly migrationExecutor: TenantDatabaseProvisionerOptions['migrationExecutor'];
  private readonly adminSqlRunnerFactory: TenantAdminSqlRunnerFactory;

  constructor(options: TenantDatabaseProvisionerOptions) {
    this.sharedUrl = options.sharedUrl;
    this.adminUrl = options.adminUrl && options.adminUrl.length > 0 ? options.adminUrl : options.sharedUrl;
    this.schemaPrefix = options.schemaPrefix;
    this.databasePrefix = options.databasePrefix;
    this.migrationMode = options.migrationMode;
    this.migrationExecutor = options.migrationExecutor;
    this.adminSqlRunnerFactory = options.adminSqlRunnerFactory ?? defaultAdminSqlRunnerFactory;
  }

  /** The connection target a SHARED tenant routes to (the shared database). */
  sharedTarget(tenantId: string): TenantConnectionTarget {
    return {
      tenantId,
      mode: 'SHARED',
      connectionUrl: this.sharedUrl,
      schemaName: null,
      databaseName: null,
    };
  }

  /** Resolves the target for an already-provisioned descriptor without re-running DDL. */
  targetForDescriptor(input: {
    tenantId: string;
    mode: TenantConnectionTarget['mode'];
    schemaName: string | null;
    databaseName: string | null;
    connectionUrl: string;
  }): TenantConnectionTarget {
    return {
      tenantId: input.tenantId,
      mode: input.mode,
      connectionUrl: input.connectionUrl,
      schemaName: input.schemaName,
      databaseName: input.databaseName,
    };
  }

  /** Creates the physical store (if dedicated) and reconciles it to the current schema. */
  async provision(context: TenantDatabaseProvisionContext): Promise<TenantDatabaseProvisionResult> {
    switch (context.mode) {
      case 'SHARED':
        return {
          mode: 'SHARED',
          connectionUrl: this.sharedUrl,
          schemaName: null,
          databaseName: null,
          migrationsApplied: false,
          lastAppliedMigration: null,
          appliedSqlLength: 0,
        };
      case 'DEDICATED_SCHEMA':
        return this.provisionDedicatedSchema(context);
      case 'DEDICATED_DATABASE':
        return this.provisionDedicatedDatabase(context);
      default: {
        const exhaustive: never = context.mode;
        throw new Error(`Unsupported tenant data isolation mode: ${String(exhaustive)}`);
      }
    }
  }

  /** Reconciles an already-provisioned store to the current schema (the migrate operation). */
  async migrate(target: TenantConnectionTarget): Promise<TenantMigrationResult> {
    if (target.mode === 'SHARED') {
      return { applied: false, lastAppliedMigration: null, sqlLength: 0 };
    }
    if (this.migrationMode === 'manual') {
      return { applied: false, lastAppliedMigration: null, sqlLength: 0 };
    }
    const sql = await this.migrationExecutor.generateMigrationSql(target.connectionUrl);
    if (!sql.trim()) {
      return { applied: false, lastAppliedMigration: null, sqlLength: 0 };
    }
    await this.migrationExecutor.applySql(target.connectionUrl, sql);
    return { applied: true, lastAppliedMigration: reconcileMarker(), sqlLength: sql.length };
  }

  private async provisionDedicatedSchema(
    context: TenantDatabaseProvisionContext,
  ): Promise<TenantDatabaseProvisionResult> {
    const schemaName = assertValidSchemaName(
      context.schemaName ?? deriveSchemaName(this.schemaPrefix, context.slug),
    );
    const admin = this.adminSqlRunnerFactory(this.adminUrl);
    try {
      await admin.execute(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(schemaName)}`);
    } finally {
      await admin.dispose();
    }

    const connectionUrl = withSchemaParam(this.sharedUrl, schemaName);
    const migration = await this.runMigrations(connectionUrl);
    return {
      mode: 'DEDICATED_SCHEMA',
      connectionUrl,
      schemaName,
      databaseName: null,
      migrationsApplied: migration.applied,
      lastAppliedMigration: migration.lastAppliedMigration,
      appliedSqlLength: migration.sqlLength,
    };
  }

  private async provisionDedicatedDatabase(
    context: TenantDatabaseProvisionContext,
  ): Promise<TenantDatabaseProvisionResult> {
    const databaseName = assertValidDatabaseName(
      context.databaseName ?? deriveDatabaseName(this.databasePrefix, context.slug),
    );
    const admin = this.adminSqlRunnerFactory(this.adminUrl);
    try {
      const exists = await admin.queryExists(
        'SELECT 1 FROM pg_database WHERE datname = $1',
        databaseName,
      );
      if (!exists) {
        // CREATE DATABASE cannot run inside a transaction block; the raw runner executes it
        // standalone. Identifiers are validated + quoted, never interpolated raw.
        await admin.execute(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
      }
    } finally {
      await admin.dispose();
    }

    const connectionUrl = withDatabaseName(this.sharedUrl, databaseName);
    const migration = await this.runMigrations(connectionUrl);
    return {
      mode: 'DEDICATED_DATABASE',
      connectionUrl,
      schemaName: null,
      databaseName,
      migrationsApplied: migration.applied,
      lastAppliedMigration: migration.lastAppliedMigration,
      appliedSqlLength: migration.sqlLength,
    };
  }

  private async runMigrations(connectionUrl: string): Promise<TenantMigrationResult> {
    if (this.migrationMode === 'manual') {
      return { applied: false, lastAppliedMigration: null, sqlLength: 0 };
    }
    const sql = await this.migrationExecutor.generateMigrationSql(connectionUrl);
    if (!sql.trim()) {
      return { applied: false, lastAppliedMigration: null, sqlLength: 0 };
    }
    await this.migrationExecutor.applySql(connectionUrl, sql);
    return { applied: true, lastAppliedMigration: reconcileMarker(), sqlLength: sql.length };
  }
}

function reconcileMarker(): string {
  return `schema-reconcile@${new Date().toISOString()}`;
}

/** Default DDL runner: a short-lived Prisma client bound to the admin URL. */
const defaultAdminSqlRunnerFactory: TenantAdminSqlRunnerFactory = (adminUrl) => {
  const client = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  return {
    async execute(sql: string) {
      await client.$executeRawUnsafe(sql);
    },
    async queryExists(sql: string, value: string) {
      const rows = await client.$queryRawUnsafe<Array<{ one?: number }>>(sql, value);
      return rows.length > 0;
    },
    async dispose() {
      await client.$disconnect();
    },
  };
};
