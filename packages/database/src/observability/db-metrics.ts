import { Prisma } from '@prisma/client';
import { recordDbQuery } from '@college-erp/observability';

/**
 * Prisma Client Extension that records every database operation into the observability metrics
 * registry: a latency histogram by (model, operation), an ok/error counter, and a slow-query
 * counter + structured warning above SLOW_QUERY_MS.
 *
 * Applied to the shared `platformPrismaClient` (so it also times every tenant-scoped client
 * derived from it) and to each dedicated-store client created by TenantPrismaClientPool. Raw
 * queries (`$queryRaw`/`$executeRaw` and their unsafe variants) are covered too, since health
 * probes and reporting SQL bypass the model layer entirely.
 *
 * Deliberately an extension rather than `$use` middleware: extensions compose with the
 * tenant-guard extension (packages/database/src/client.ts) and middleware is deprecated in
 * Prisma 5.x.
 */
export function dbMetricsExtension() {
  return Prisma.defineExtension((client) =>
    client.$extends({
      name: 'db-metrics',
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            const startedAt = process.hrtime.bigint();
            try {
              const result = await query(args);
              recordDbQuery({
                model,
                operation,
                durationMs: elapsedMs(startedAt),
                ok: true,
              });
              return result;
            } catch (error) {
              recordDbQuery({
                model,
                operation,
                durationMs: elapsedMs(startedAt),
                ok: false,
              });
              throw error;
            }
          },
        },
        async $queryRaw({ args, query }) {
          return timedRaw('queryRaw', args, query);
        },
        async $queryRawUnsafe({ args, query }) {
          return timedRaw('queryRawUnsafe', args, query);
        },
        async $executeRaw({ args, query }) {
          return timedRaw('executeRaw', args, query);
        },
        async $executeRawUnsafe({ args, query }) {
          return timedRaw('executeRawUnsafe', args, query);
        },
      },
    }),
  );
}

async function timedRaw<T>(operation: string, args: unknown, query: (args: unknown) => Promise<T>): Promise<T> {
  const startedAt = process.hrtime.bigint();
  try {
    const result = await query(args);
    recordDbQuery({ model: 'raw', operation, durationMs: elapsedMs(startedAt), ok: true });
    return result;
  } catch (error) {
    recordDbQuery({ model: 'raw', operation, durationMs: elapsedMs(startedAt), ok: false });
    throw error;
  }
}

function elapsedMs(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1e6;
}
