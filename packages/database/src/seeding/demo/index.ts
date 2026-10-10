/**
 * Demo-college seeding orchestrator.
 *
 * `seedDemoCollege` builds a complete, realistic demo tenant — organisation, people, academics,
 * admissions, attendance, fees, exams/results, library, hostel, transport, placements, inventory
 * and helpdesk — as an idempotent, re-runnable routine:
 *
 *   - every row gets a deterministic UUID (see core.ts) and is written with `upsert`, so running
 *     the seeder twice updates rather than duplicates;
 *   - the tenant bootstrap (roles, permissions, workflow definitions, admin user) reuses the very
 *     same `provisionTenantDefaults` routine the API's POST /tenants runs;
 *   - entitlements are materialized with the same `recomputeTenantEntitlements` routine the SaaS
 *     layer uses, so the demo tenant's modules are actually unlocked;
 *   - passwords come from the environment (SEED_DEMO_PASSWORD) with a documented dev-only default
 *     that is refused in production.
 */
import * as bcrypt from 'bcryptjs';
import type { PrismaClient } from '@prisma/client';
import {
  provisionTenantDefaults,
  type ProvisioningClient,
} from '../../provisioning/tenant-provisioning';
import { DEMO_TENANT, seedTenantAndOrganisation } from './org';
import { ADMIN_EMAIL, seedPeople } from './people';
import { seedAcademics } from './academics';
import { seedAdmissions } from './admissions';
import { seedAttendance } from './attendance';
import { seedFees } from './fees';
import { seedExams } from './exams';
import { seedLibrary } from './library';
import { seedHostel } from './hostel';
import { seedTransport } from './transport';
import { seedPlacement } from './placement';
import { seedInventory } from './inventory';
import { seedHelpdesk } from './helpdesk';
import type { DemoContext } from './core';

export { DEMO_TENANT_SLUG } from './core';
export { DEMO_TENANT } from './org';

export const DEMO_ADMIN = {
  email: ADMIN_EMAIL,
  fullName: 'Ananya Deshmukh',
} as const;

export interface DemoSeedSummary {
  tenantId: string;
  tenantSlug: string;
  adminEmail: string;
  users: number;
  students: number;
  guardians: number;
  modules: Record<string, number>;
}

export interface SeedDemoOptions {
  /** Overrides SEED_DEMO_PASSWORD / the dev default (tests, scripts). */
  password?: string;
}

/**
 * Resolves the demo-user password. Precedence: explicit option > SEED_DEMO_PASSWORD env > a
 * documented dev-only default. Creating a full college whose every account shares the well-known
 * default is refused in production unless the operator supplies a real password.
 */
export function resolveDemoPasswordFromEnv(optionPassword?: string): { password: string; isDefault: boolean } {
  if (optionPassword) {
    return { password: optionPassword, isDefault: false };
  }
  const fromEnv = process.env.SEED_DEMO_PASSWORD;
  if (fromEnv) {
    return { password: fromEnv, isDefault: false };
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'SEED_DEMO_PASSWORD must be set to seed the demo college in production — refusing to create demo accounts with the default password.',
    );
  }
  return { password: 'ChangeMe123!', isDefault: true };
}

/**
 * Whether `prisma db seed` should include the demo college. SEED_DEMO_DATA wins when set
 * ('true'/'1'/'yes' enables, 'false'/'0'/'no' disables); otherwise demo data is seeded in every
 * environment except production, where it stays off unless explicitly requested.
 */
export function shouldSeedDemoData(): boolean {
  const raw = process.env.SEED_DEMO_DATA?.trim().toLowerCase();
  if (raw === 'true' || raw === '1' || raw === 'yes') return true;
  if (raw === 'false' || raw === '0' || raw === 'no') return false;
  return process.env.NODE_ENV !== 'production';
}

/** Seeds (idempotently) the complete demo college. Safe to run repeatedly. */
export async function seedDemoCollege(prisma: PrismaClient, options: SeedDemoOptions = {}): Promise<DemoSeedSummary> {
  const { password, isDefault } = resolveDemoPasswordFromEnv(options.password);

  const started = Date.now();
  console.log(`[demo-seed] Seeding demo college "${DEMO_TENANT.name}" (${DEMO_TENANT.slug})…`);
  if (isDefault) {
    console.warn(
      `[demo-seed] SEED_DEMO_PASSWORD not set — demo users share the dev-only default password. ` +
        'Set SEED_DEMO_PASSWORD before using this data beyond local development.',
    );
  }

  // One bcrypt hash shared by every demo user — same password, one cost-12 computation.
  const passwordHash = await bcrypt.hash(password, 12);

  const { tenantId, ids: org } = await seedTenantAndOrganisation(prisma);

  const provisioned = await provisionTenantDefaults(prisma as unknown as ProvisioningClient, {
    tenantId,
    email: DEMO_ADMIN.email,
    fullName: DEMO_ADMIN.fullName,
    passwordHash,
  });

  const roles = await prisma.role.findMany({ where: { tenantId }, select: { id: true, code: true } });
  const rolesByCode = new Map(roles.map((role) => [role.code, role.id]));

  const ctx: DemoContext = {
    prisma,
    tenantId,
    creator: provisioned.adminUserId,
    passwordHash,
    ids: (segment) => org[segment] ?? '',
  };

  const people = await seedPeople({ prisma, tenantId, adminUserId: provisioned.adminUserId, passwordHash, org, rolesByCode });
  const academics = await seedAcademics({ prisma, ctx, org, people });
  const admissions = await seedAdmissions({ prisma, ctx, org, people });
  const attendance = await seedAttendance({ prisma, ctx, org, people, academics });
  const fees = await seedFees({ prisma, ctx, org, people });
  const exams = await seedExams({ prisma, ctx, org, people, academics });
  const library = await seedLibrary({ prisma, ctx, org, people });
  const hostel = await seedHostel({ prisma, ctx, org, people });
  const transport = await seedTransport({ prisma, ctx, org, people });
  const placement = await seedPlacement({ prisma, ctx, org, people });
  const inventory = await seedInventory({ prisma, ctx, org, people });
  const helpdesk = await seedHelpdesk({ prisma, ctx, org, people });

  const userCount = await prisma.user.count({ where: { tenantId } });
  const summary: DemoSeedSummary = {
    tenantId,
    tenantSlug: DEMO_TENANT.slug,
    adminEmail: DEMO_ADMIN.email,
    users: userCount,
    students: people.students.length,
    guardians: people.guardianUsers,
    modules: {
      admissions: admissions.applicationCount,
      attendanceSessions: attendance.sessions,
      attendanceRecords: attendance.records,
      feeReceipts: fees.receipts,
      feeDemands: fees.demands,
      publishedResults: exams.publishedResults,
      libraryLoans: library.loans,
      hostelBookings: hostel.bookings,
      transportPasses: transport.passes,
      placementOffers: placement.offers,
      inventoryAssets: inventory.assets,
      helpdeskTickets: helpdesk.tickets,
    },
  };

  console.log(`[demo-seed] Demo college ready in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
  return summary;
}

/** Human-readable multi-line summary for the seed script. */
export function formatDemoSeedSummary(summary: DemoSeedSummary): string {
  const modules = Object.entries(summary.modules)
    .map(([key, value]) => `  - ${key}: ${value}`)
    .join('\n');
  return [
    `Demo college seeded: ${summary.tenantSlug} (tenant ${summary.tenantId})`,
    `  - admin login: ${summary.adminEmail}`,
    `  - users: ${summary.users}, students: ${summary.students}, guardians with accounts: ${summary.guardians}`,
    modules,
  ].join('\n');
}
