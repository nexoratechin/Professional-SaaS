import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import {
  PERMISSION_CATALOG,
  FEATURE_FLAG_CATALOG,
  PLAN_DEFINITIONS,
  ENTITLEMENT_CATALOG,
  ENTITLEMENT_MODULE_MAP,
} from '@college-erp/auth';

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

/** Seeds granular sub-feature entitlements (PlanModule rows) per plan. A plan gets a granular
 * entitlement whenever its plan-feature set already includes the module that granular entitlement
 * belongs to — e.g. a plan with the fees module gets fees.online_payment and fees.installment.
 * These PlanModule rows are what EntitlementsService.recompute materializes into the entitlements
 * table, so granular gating (attendance.qr, fees.online_payment, …) takes effect end-to-end. */
async function seedPlanModules() {
  for (const planDef of PLAN_DEFINITIONS) {
    const plan = await prisma.plan.findUniqueOrThrow({ where: { code: planDef.code } });
    const planModuleKeys = new Set(planDef.features);

    for (const entry of ENTITLEMENT_CATALOG) {
      // A plan is entitled to a granular sub-feature if it already includes that sub-feature's module.
      if (!planModuleKeys.has(ENTITLEMENT_MODULE_MAP[entry.key])) {
        continue;
      }
      await prisma.planModule.upsert({
        where: { planId_moduleKey: { planId: plan.id, moduleKey: entry.key } },
        update: { name: entry.name },
        create: {
          planId: plan.id,
          moduleKey: entry.key,
          name: entry.name,
          type: 'BOOLEAN',
        },
      });
    }
  }
  console.log(`Seeded ${ENTITLEMENT_CATALOG.length} granular entitlements into plan modules.`);
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

/** Seeds the singleton SaaS billing configuration row (tax, invoice numbering, grace/due
 *  periods). BillingConfigService.get() also lazily upserts it, but an explicit row keeps the
 *  defaults visible/editable from day one. */
async function seedBillingConfig() {
  await prisma.billingConfig.upsert({
    where: { id: 'default' },
    update: {},
    create: {},
  });
  console.log('Seeded billing configuration (GST 18%, INV prefix, 7-day grace).');
}

async function main() {
  await seedPermissions();
  await seedFeatureFlags();
  await seedPlans();
  await seedPlanModules();
  await seedBillingConfig();
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
