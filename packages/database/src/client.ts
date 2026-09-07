import { Prisma, PrismaClient } from '@prisma/client';

export class TenantIsolationViolationError extends Error {
  constructor(public readonly model: string) {
    super(
      `Tenant isolation violation on model "${model}": an explicit tenantId was supplied that ` +
        "does not match the authenticated request's tenant context.",
    );
    this.name = 'TenantIsolationViolationError';
  }
}

/**
 * Models carrying a REQUIRED tenantId scalar, derived from the Prisma DMMF rather than
 * hand-maintained, so new tenant-owned models added in later phases are picked up
 * automatically. Deliberately excludes models with an optional/nullable tenantId
 * (PlatformAuditLog, LoginEvent) — those are control-plane models that merely reference a
 * tenant when applicable, not tenant-owned data, and are only ever written through the
 * unscoped PlatformPrismaService.
 */
const TENANT_SCOPED_MODELS: ReadonlySet<string> = new Set(
  Prisma.dmmf.datamodel.models
    .filter((model) => model.fields.some((field) => field.name === 'tenantId' && field.isRequired))
    .map((model) => model.name),
);

export function isTenantScopedModel(model: string): boolean {
  return TENANT_SCOPED_MODELS.has(model);
}

function injectWhere(where: unknown, tenantId: string, model: string) {
  const w = (where ?? {}) as Record<string, unknown>;
  if (w.tenantId !== undefined && w.tenantId !== tenantId) {
    throw new TenantIsolationViolationError(model);
  }
  return { ...w, tenantId };
}

function injectData(data: unknown, tenantId: string, model: string) {
  const d = (data ?? {}) as Record<string, unknown>;
  if (d.tenantId !== undefined && d.tenantId !== tenantId) {
    throw new TenantIsolationViolationError(model);
  }
  return { ...d, tenantId };
}

const WHERE_ONLY_OPS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'deleteMany',
  'update',
  'delete',
]);

/**
 * Builds a Prisma Client Extension that scopes every operation on a tenant-owned model to a
 * single tenantId — merged into `where` on reads/updates/deletes and into `data` on creates.
 * This is the sole tenant-isolation enforcement mechanism: domain services must always use the
 * client this extension produces (via TenantScopedPrismaService in apps/api), never a raw,
 * unscoped PrismaClient.
 *
 * Known gap: `$queryRaw`/`$executeRaw` and nested relation writes bypass this extension and must
 * include an explicit tenant_id clause/field by convention — flagged for the security-review
 * checklist rather than solved generically here.
 */
export function tenantGuardExtension(tenantId: string) {
  return Prisma.defineExtension((client) =>
    client.$extends({
      name: 'tenant-guard',
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            if (!isTenantScopedModel(model)) {
              return query(args);
            }

            const scoped = { ...(args as Record<string, unknown>) };

            if (WHERE_ONLY_OPS.has(operation)) {
              scoped.where = injectWhere(scoped.where, tenantId, model);
            } else if (operation === 'create') {
              scoped.data = injectData(scoped.data, tenantId, model);
            } else if (operation === 'createMany') {
              const rows = scoped.data;
              scoped.data = Array.isArray(rows)
                ? rows.map((row) => injectData(row, tenantId, model))
                : rows;
            } else if (operation === 'upsert') {
              scoped.where = injectWhere(scoped.where, tenantId, model);
              scoped.create = injectData(scoped.create, tenantId, model);
              scoped.update = injectData(scoped.update, tenantId, model);
            }

            return query(scoped as typeof args);
          },
        },
      },
    }),
  );
}

/**
 * Unscoped singleton — for platform-admin (control-plane) services ONLY
 * (apps/api PlatformPrismaService). Domain/tenant services must never import this directly;
 * use createTenantScopedClient()/TenantScopedPrismaService instead.
 */
export const platformPrismaClient = new PrismaClient();

export function createTenantScopedClient(tenantId: string) {
  return platformPrismaClient.$extends(tenantGuardExtension(tenantId));
}

export type TenantScopedPrismaClient = ReturnType<typeof createTenantScopedClient>;

export * from '@prisma/client';
