/**
 * Standalone demo-college seeder: ensures the global catalog exists, then seeds (idempotently)
 * the full demo college — safe to run repeatedly.
 *
 *   pnpm db:seed:demo          # from the repo root
 *
 * Environment:
 *   SEED_DEMO_PASSWORD — password for every demo account (required in production; defaults to a
 *                        documented dev-only value elsewhere).
 */
import { PrismaClient } from '@prisma/client';
import { seedGlobalCatalog } from '../src/seeding/global-catalog';
import { formatDemoSeedSummary, seedDemoCollege } from '../src/seeding/demo';

const prisma = new PrismaClient();

async function main() {
  await seedGlobalCatalog(prisma);
  const summary = await seedDemoCollege(prisma);
  console.log(formatDemoSeedSummary(summary));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
