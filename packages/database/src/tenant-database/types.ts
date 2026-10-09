/**
 * Shared types for the enterprise database-isolation abstraction.
 *
 * The default remains the shared database + tenant_id model. These types describe the opt-in
 * dedicated-schema / dedicated-database modes and the metadata the provisioning, routing and
 * migration layers pass between each other. Deliberately framework-free (no Nest, no Prisma
 * client instance) so they can be unit-tested in isolation and used from both apps/api and
 * apps/worker.
 */

export const TENANT_DATA_ISOLATION_MODES = ['SHARED', 'DEDICATED_SCHEMA', 'DEDICATED_DATABASE'] as const;
/**
 * Named `TenantIsolationMode` (not `TenantDataIsolationMode`) deliberately: Prisma already
 * generates a top-level `TenantDataIsolationMode` enum type from schema.prisma, and two `export *`
 * branches of the package barrel exporting the same name would be ambiguous (TS2308). The
 * Prisma-generated type is the same union, so consumers can import either.
 */
export type TenantIsolationMode = (typeof TENANT_DATA_ISOLATION_MODES)[number];

export const TENANT_DATABASE_PROVISION_STATUSES = [
  'NOT_APPLICABLE',
  'PENDING',
  'PROVISIONING',
  'MIGRATING',
  'READY',
  'FAILED',
] as const;
/** Named `TenantStoreStatus` for the same reason as TenantIsolationMode above. */
export type TenantStoreStatus = (typeof TENANT_DATABASE_PROVISION_STATUSES)[number];

export const TENANT_DATABASE_MIGRATION_MODES = ['auto', 'manual'] as const;
export type TenantDatabaseMigrationMode = (typeof TENANT_DATABASE_MIGRATION_MODES)[number];

/** A tenant's resolved physical target — what the client factory routes to. */
export interface TenantConnectionTarget {
  tenantId: string;
  mode: TenantIsolationMode;
  /** Connection URL the tenant's Prisma client must use (includes ?schema= for schema mode). */
  connectionUrl: string;
  schemaName: string | null;
  databaseName: string | null;
}

/** The persisted `tenant_databases` row, decoupled from the generated Prisma type. */
export interface TenantDatabaseDescriptor {
  id: string;
  tenantId: string;
  mode: TenantIsolationMode;
  status: TenantStoreStatus;
  schemaName: string | null;
  databaseName: string | null;
  connectionUrlEncrypted: string | null;
  appliedMigrationCount: number;
  lastAppliedMigration: string | null;
  lastMigratedAt: Date | null;
  provisionedAt: Date | null;
  failureReason: string | null;
}

export interface TenantDatabaseProvisionContext {
  tenantId: string;
  /** Usually the tenant slug — used to derive a stable, human-readable schema/database name. */
  slug: string;
  mode: TenantIsolationMode;
  /** Explicit target names; when omitted they are derived from the configured prefixes + slug. */
  schemaName?: string;
  databaseName?: string;
}

export interface TenantDatabaseProvisionResult {
  mode: TenantIsolationMode;
  connectionUrl: string;
  schemaName: string | null;
  databaseName: string | null;
  /** True when a migration script was actually applied (false for SHARED or manual mode). */
  migrationsApplied: boolean;
  lastAppliedMigration: string | null;
  /** SQL length applied, for logging only. */
  appliedSqlLength: number;
}

export interface TenantMigrationResult {
  applied: boolean;
  lastAppliedMigration: string | null;
  sqlLength: number;
}
