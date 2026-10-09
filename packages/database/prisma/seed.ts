import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { seedGlobalCatalog } from '../src/seeding/global-catalog';

const prisma = new PrismaClient();

async function seedPlatformAdmin() {
  const email = process.env.PLATFORM_ADMIN_EMAIL ?? 'platform-admin@college-erp.local';
  const password = process.env.PLATFORM_ADMIN_PASSWORD ?? 'ChangeMe123!';
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
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
