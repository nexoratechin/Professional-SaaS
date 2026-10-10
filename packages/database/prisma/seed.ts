import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { seedGlobalCatalog } from '../src/seeding/global-catalog';
import {
  formatDemoSeedSummary,
  seedDemoCollege,
  shouldSeedDemoData,
  type DemoSeedSummary,
} from '../src/seeding/demo';

const prisma = new PrismaClient();

async function seedPlatformAdmin() {
  const email = process.env.PLATFORM_ADMIN_EMAIL ?? 'platform-admin@college-erp.local';
  const password = process.env.PLATFORM_ADMIN_PASSWORD ?? 'ChangeMe123!';

  // Refuse to seed publicly-known default credentials outside development. A production seed
  // without an operator-provided password would create a full platform admin anyone can log into.
  if (!process.env.PLATFORM_ADMIN_PASSWORD && process.env.NODE_ENV === 'production') {
    throw new Error(
      'PLATFORM_ADMIN_PASSWORD must be set when seeding in production — refusing to create a platform admin with the default password.',
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.platformUser.upsert({
    where: { email },
    update: {},
    create: {
      email,
      passwordHash,
      fullName: 'Platform Administrator',
      role: 'PLATFORM_ADMIN',
    },
  });

  if (!process.env.PLATFORM_ADMIN_PASSWORD) {
    console.warn(
      `PLATFORM_ADMIN_PASSWORD not set — seeded default dev credentials (${email} / ${password}). ` +
        'Set PLATFORM_ADMIN_EMAIL/PLATFORM_ADMIN_PASSWORD before seeding anything beyond local dev.',
    );
  } else {
    console.log(`Seeded platform admin: ${email}`);
  }
}

async function main() {
  // Permissions, feature flags, plans, plan modules and billing config — the same routine every
  // enterprise tenant's dedicated store is seeded with (see src/seeding/global-catalog.ts).
  await seedGlobalCatalog(prisma);
  console.log('Seeded global catalog (permissions, feature flags, plans, plan modules, billing config).');

  await seedPlatformAdmin();

  // Demo college: on by default outside production, opt-in in production with SEED_DEMO_DATA=true.
  // Idempotent — every row is upserted against a deterministic key, so re-running is safe.
  if (shouldSeedDemoData()) {
    const summary: DemoSeedSummary = await seedDemoCollege(prisma);
    console.log(formatDemoSeedSummary(summary));
  } else {
    console.log(
      'Demo college seeding skipped (SEED_DEMO_DATA is disabled, or NODE_ENV=production without an explicit opt-in).',
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
