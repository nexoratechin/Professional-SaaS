import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { PERMISSION_CATALOG, FEATURE_FLAG_CATALOG, PLAN_DEFINITIONS } from '@college-erp/auth';

const prisma = new PrismaClient();

async function seedPermissions() {
  for (const permission of PERMISSION_CATALOG) {
    await prisma.permission.upsert({
      where: { key: permission.key },
      update: { module: permission.module, action: permission.action, description: permission.description },
      create: permission,
    });
  }
  console.log(`Seeded ${PERMISSION_CATALOG.length} permissions.`);
}

async function seedFeatureFlags() {
  for (const flag of FEATURE_FLAG_CATALOG) {
    await prisma.featureFlag.upsert({
      where: { key: flag.key },
      update: { name: flag.name, module: flag.module },
      create: { key: flag.key, name: flag.name, module: flag.module },
    });
  }
  console.log(`Seeded ${FEATURE_FLAG_CATALOG.length} feature flags.`);
}

async function seedPlans() {
  for (const planDef of PLAN_DEFINITIONS) {
    const plan = await prisma.plan.upsert({
      where: { code: planDef.code },
      update: { name: planDef.name, isCustom: planDef.isCustom },
      create: { code: planDef.code, name: planDef.name, isCustom: planDef.isCustom, billingCycle: 'ANNUAL' },
    });

    for (const featureKey of planDef.features) {
      const flag = await prisma.featureFlag.findUniqueOrThrow({ where: { key: featureKey } });
      await prisma.planFeatureFlag.upsert({
        where: { planId_featureFlagId: { planId: plan.id, featureFlagId: flag.id } },
        update: {},
        create: { planId: plan.id, featureFlagId: flag.id },
      });
    }
  }
  console.log(`Seeded ${PLAN_DEFINITIONS.length} plans with feature mappings.`);
}

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
  await seedPermissions();
  await seedFeatureFlags();
  await seedPlans();
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
