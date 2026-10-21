# Tenant layer: jops-warehouse → Professional-SaaS alignment

Status: proposal. Nothing in this document is implemented yet except the platform-admin
role gate described at the end.

Reference implementation: `C:\Users\parth.prajapati\jops-warehouse`
(master DB + DB-per-tenant, path-based tenant routing, tenant picker in the SPA).

## 1. The reference invariants worth copying

From `jops-warehouse/AGENTS.md` ("Multi-tenancy (the core invariant)"):

1. One master/control-plane DB plus one DB per tenant.
2. The frontend selects a tenant once and stores it; the tenant registry is the only
   authoritative list of valid slugs.
3. Tenant slugs are opaque — no aliases, no default tenant, no silent fallback.
4. A stored slug that is not in the user's available tenants is cleared and the user is
   sent to a company picker.
5. Every tenant-scoped request is rewritten to `/api/tenant/{slug}/...`; tenant-agnostic
   endpoints are explicitly listed.
6. The backend resolves the tenant in one middleware; unknown slug → 404; no access → 403;
   models fail loudly if no tenant is resolved.
7. API envelope: `{ success, data | error }`.

## 2. Current state in Professional-SaaS

Already satisfied:

| Invariant | Where |
| --- | --- |
| Control plane separated from tenant data | `PlatformUser` / `PlatformSession` vs `User` / `Session`, separate JWT realms (`packages/auth/src/jwt-claims.ts`) |
| One place resolves the tenant | `apps/api/src/common/middleware/tenant-resolution.middleware.ts` |
| Unknown/suspended tenant fails closed | same file: 404 / 403 / 503 |
| No default tenant | registry lookup is required; no fallback slug |
| Mechanical tenant scoping | `packages/database/src/client.ts` Prisma extension (required `tenant_id`) |
| Isolated stores available | `SHARED` / `DEDICATED_SCHEMA` / `DEDICATED_DATABASE` (`docs/enterprise-database-isolation.md`) |
| Web keeps the chosen slug | `college_erp_tenant_slug` in `apps/web/src/features/auth/auth-context.tsx` |
| Tenant sent on every request | `X-Tenant-Slug` in `apps/web/src/lib/http.ts` |
| JWT tenant assertion | `TenantMatchGuard` + `tenantId` claim |

Different from the reference:

| Area | jops-warehouse | Professional-SaaS |
| --- | --- | --- |
| Tenant transport | Path: `/api/tenant/{slug}/...` | Header `X-Tenant-Slug`, or subdomain |
| Membership | `UserTenant` join — one user, many tenants | `User.tenantId` is required — one user, one tenant |
| Tenant picker | `/select-company` + `availableTenants` | None; the slug is typed at login and kept in localStorage |
| API envelope | `{ success, data }` | Raw payloads (no envelope) |
| Default isolation | DB per tenant for everyone | Shared + `tenant_id`, dedicated stores opt-in |

## 3. What a literal port would cost

- **Path-based routing** touches every controller: Nest mounts controllers at their own
  paths and there is no global prefix today (`apps/api/src/main.ts` never calls
  `setGlobalPrefix`). A real `/api/tenant/:slug/*` tree means re-mounting ~40 modules under
  a parameterised parent router, plus a tenant-agnostic allowlist.
- **Membership** needs a `UserTenant` (or `TenantMembership`) model, a migration, a
  backfill from `User.tenantId`, changes to login/refresh (which tenant to pick when the
  same email exists in several), and session scoping.
- **Envelope** changes every response and every web call site — a repo-wide breaking change
  with no isolation benefit.
- **DB-per-tenant by default** invalidates the current migration story (shared Prisma
  migrations) for every existing tenant.

None of these improve isolation on their own; they change shape. The isolation invariants
(1, 3, 6) are already enforced.

## 4. Recommended phases

### Phase 0 — Platform admin is super-admin-only (done in this change)

- `apps/web/src/features/platform-auth/platform-access.ts` — single role policy.
- `PlatformProtectedRoute` verifies role and supports `adminOnly` routes.
- `/platform/billing`, `/platform/catalog`, `/platform/audit-log`, `/platform/tenants/new`
  are admin-only; support keeps dashboard/analytics/tenants/support.
- Nav is filtered by role; signed-in users no longer see the login form.
- API enforcement was already correct (`@RequirePlatformRole`).

### Phase 1 — Tenant picker for users with more than one tenant (implemented)

What shipped:

1. `TenantMembership` (control plane): `email`, `tenantId`, tenant-local `userId`, `isActive`,
   unique `(email, tenantId)`. No FK to `User` — user rows can live in a dedicated store.
   Migration: `packages/database/prisma/migrations/20261021120000_add_tenant_memberships/`
   (creates the table and backfills one row per existing user).
2. `TenantMembershipService` (`apps/api/src/common/tenant/`) keeps the directory in sync at
   invite, SSO provisioning, onboarding creation/completion and user status changes. Reads
   self-heal a missing row for the caller.
3. `GET /auth/tenants` (JWT + `TenantMatchGuard`) returns
   `{ tenants: [{ slug, name, status, isCurrent }] }` for the signed-in email, restricted to
   TRIAL/ACTIVE tenants.
4. Web: `AuthContext` loads the directory with the profile and caches it for the public
   `/select-tenant` screen; login routes through the picker when more than one workspace
   exists; the app shell offers "Switch workspace"; login accepts `?tenant=&email=` prefill.
5. Slugs stay opaque: the picker only ever sends back a slug returned by the API, and an empty
   directory sends the user to the normal login form (no default tenant).

Deliberate limitation: tenant sessions are per-college (the JWT is bound to one `tenantId`,
and each tenant has its own `Session` rows). Switching a workspace therefore ends the current
session and asks for that college's credentials, with slug and email prefilled. Seamless
switching would require a cross-tenant identity/session exchange — a separate security design,
not a data-model tweak.

### Phase 2 — Optional path transport (large, only if a client requires it)

- Add a tenant-prefixed router or an edge rewrite that maps
  `/api/tenant/{slug}/*` → the existing routes plus `X-Tenant-Slug`, with an explicit
  tenant-agnostic allowlist, then migrate the web client's `resolveTenantSlug` to it.
- Only worth doing for contract/compliance reasons; it is a transport change, not an
  isolation improvement.

### Phase 3 — Response envelope (not recommended)

Would touch every controller and every fetch call for no security gain.

## 5. Decision needed

Phase 1 is implemented. Phase 2 (path transport) remains a routing rewrite for cosmetic
parity and should only be undertaken if a client contract requires `/api/tenant/{slug}/...`.
Phase 3 is not recommended.
