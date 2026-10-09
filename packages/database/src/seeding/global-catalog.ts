/**
 * Reusable global-catalog seeding.
 *
 * Extracted from prisma/seed.ts so the exact same catalog can be seeded into an enterprise
 * tenant's dedicated store (schema/database) — those stores are full schema copies, so their
 * foreign keys (e.g. RolePermission -> Permission) require the catalog to exist locally. Keeping
 * one implementation means the shared database and every dedicated store stay identical.
 */
import type { PrismaClient } from '@prisma/client';
import {
  PERMISSION_CATALOG,
  FEATURE_FLAG_CATALOG,
  PLAN_DEFINITIONS,
  ENTITLEMENT_CATALOG,
  ENTITLEMENT_MODULE_MAP,
} from '@college-erp/auth';

export async function seedPermissions(prisma: PrismaClient): Promise<number> {
  for (const permission of PERMISSION_CATALOG) {
    await prisma.permission.upsert({
      where: { key: permission.key },
      update: { module: permission.module, action: permission.action, description: permission.description },
      create: permission,
    });
  }
  return PERMISSION_CATALOG.length;
}

export async function seedFeatureFlags(prisma: PrismaClient): Promise<number> {
  for (const flag of FEATURE_FLAG_CATALOG) {
    await prisma.featureFlag.upsert({
      where: { key: flag.key },
      update: { name: flag.name, module: flag.module },
      create: { key: flag.key, name: flag.name, module: flag.module },
    });
  }
  return FEATURE_FLAG_CATALOG.length;
}

export async function seedPlans(prisma: PrismaClient): Promise<number> {
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
  return PLAN_DEFINITIONS.length;
}

/** Seeds granular sub-feature entitlements (PlanModule rows) per plan. A plan gets a granular
 * entitlement whenever its plan-feature set already includes the module that granular entitlement
 * belongs to — e.g. a plan with the fees module gets fees.online_payment and fees.installment. */
export async function seedPlanModules(prisma: PrismaClient): Promise<number> {
  for (const planDef of PLAN_DEFINITIONS) {
    const plan = await prisma.plan.findUniqueOrThrow({ where: { code: planDef.code } });
    const planModuleKeys = new Set(planDef.features);

    for (const entry of ENTITLEMENT_CATALOG) {
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
  return ENTITLEMENT_CATALOG.length;
}

/** Seeds the singleton SaaS billing configuration row (tax, invoice numbering, grace/due periods). */
export async function seedBillingConfig(prisma: PrismaClient): Promise<void> {
  await prisma.billingConfig.upsert({
    where: { id: 'default' },
    update: {},
    create: {},
  });
}

/**
 * Seeds every global catalog table a full-schema store needs: permissions, feature flags, plans,
 * plan-feature mappings, plan modules and the billing configuration. Idempotent (all upserts), so
 * it is safe to re-run against the shared database or a dedicated store.
 */
export async function seedGlobalCatalog(prisma: PrismaClient): Promise<void> {
  await seedPermissions(prisma);
  await seedFeatureFlags(prisma);
  await seedPlans(prisma);
  await seedPlanModules(prisma);
  await seedBillingConfig(prisma);
}
