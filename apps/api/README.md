# College ERP SaaS — REST API (`apps/api`)

Multi-tenant college ERP REST platform built on NestJS, Prisma, PostgreSQL, Redis/BullMQ and
MinIO. This document covers the cross-cutting platform contract every endpoint shares: versioning,
authentication/authorization, tenant enforcement, requests, responses, pagination, idempotency and
rate limiting. Interactive docs live at `/api/docs` (Swagger UI) once the server is running.

---

## 1. Versions

Current version: **v1**. Compatibility is the priority — every existing route (and every e2e test,
web app URL, and un-versioned client) is served as v1 exactly as before.

Version negotiation (header-based; URI prefixes are reserved, not enabled, so existing paths/tests are untouched):

| Mechanism | Example | Notes |
| --- | --- | --- |
| Omit the version | `GET /tenants` | Defaults to v1. Today's clients. |
| `X-API-Version` header | `X-API-Version: 1` | Explicit; `2` becomes active when a v2 handler ships. |

Only the header form is enabled: current routes are un-versioned and answer the default version
`1`; a handler declaring `@Version("2")` is answered only when the header asks for v2. URI-style
`/v1/...` / `/v2/...` prefixes stay available as a future migration path.

Implementation: `app.enableVersioning({ type: VersioningType.HEADER, header: 'X-API-Version', defaultVersion: '1' })`.

## 2. Authentication & Authorization

Two identities exist:

- **Tenant user** — `POST /auth/login` (JWT `access-token` bearer + httpOnly refresh cookie).
  Optional MFA, session management and trust devices under `/auth/...`.
- **Platform operator** — `POST /platform/auth/login` (own JWT + guards for the control plane:
  tenants, subscriptions, billing, invoices, payments, usage, audit, plans, feature flags).

Authorization is layered everywhere:

- `JwtAuthGuard` / `PlatformAuthGuard` — authenticate.
- `TenantMatchGuard` — ensures a tenant user only reaches records of their own tenant.
- `PermissionsGuard` + `@RequirePermission(...)` — RBAC capability checks (e.g. `STUDENTS_CREATE`).
- `PlatformRoleGuard` + `@RequirePlatformRole(...)` — control-plane roles (e.g. `PLATFORM_ADMIN`).
- `FeatureFlagsGuard` + `@RequireFeature(...)` — tenant feature-flag entitlement (e.g. `STUDENTS`).

The HTTP surface uses JWT `Authorization: Bearer <token>`; refresh happens via the httpOnly cookie.

## 3. Tenant binding

Every request is bound to a tenant before any handler runs (`TenantResolutionMiddleware`):

- **Production** — resolved from the request **subdomain**.
- **Dev / CI** — `TENANT_HEADER_FALLBACK=true` resolves from the **`X-Tenant-Slug` header**
  (the web app sends this automatically in dev).

Public/control-plane surface that must not be tenant-bound is excluded explicitly
(`/health`, `/api/docs`, `/public/*`, `/platform/*`, `/plans`, `/feature-flags`, `/tenants`,
`/subscriptions`, `/invoices`, `/attendance/devices/ingest/*`, `/integrations/webhooks/*`, …).
Attachment/ORM queries run through the tenant-prisma client so cross-tenant access is structurally
impossible; any isolation violation surfaces as `403` with `code: "CROSS_TENANT_VIOLATION"`.

## 4. Requests

### Headers (global)

| Header | Required | Meaning |
| --- | --- | --- |
| `X-API-Version` | no | Target API version; defaults to `1`. |
| `X-Tenant-Slug` | dev only | Tenant slug when `TENANT_HEADER_FALLBACK` is on. |
| `X-Request-Id` | no | Correlation id; generated when omitted, always echoed back on the response. |
| `Idempotency-Key` | no | Makes a mutating request at-most-once (see §6). |
| `Authorization` | depends | `Bearer <access token>` for protected routes. |

All request headers above are injected into the OpenAPI document for every operation, so Swagger
UI documents the full contract.

### Validation

The global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`) rejects unknown
query/body fields with `400` instead of silently ignoring them, and coerces typed query params
(e.g. `@Type(() => Number)` on `skip`/`take`). Failures return the standard error envelope with
`code: "VALIDATION_FAILED"` and per-field `details`.

## 5. Responses & Errors

**Success** — list endpoints return a plain array body plus pagination metadata headers (see §7).
Details/bulk operations return their entity JSON. 204 is returned where there is no body.

**Errors** — every failure, from validation to an unhandled 500, uses one envelope:

```json
{
  "statusCode": 409,
  "error": "Conflict",
  "code": "DUPLICATE_ADMISSION_NUMBER",
  "message": "admission number in use",
  "details": { "admissionNumber": "B2024-001" },
  "requestId": "0f4a2d3c-7f8b-4a6e-9c10-2e3d4f5a6b7c",
  "path": "/students",
  "method": "POST",
  "timestamp": "2026-10-06T09:30:00.000Z"
}
```

- `code` is a stable machine-readable token clients can branch on (`HTTP_400` by default;
  `VALIDATION_FAILED` for validation; custom codes like `DUPLICATE_ADMISSION_NUMBER` where a
  service sets them). Unknown/internals never leak stack traces or details — the `requestId` maps
  a user report to the server log line.
- The envelope is produced by the global `HttpExceptionFilter` (registered via `APP_FILTER` so e2e
  tests boot the identical behavior). Frontend compatibility is preserved: `message` stays a string
  (or array) and existing client code reading `body.message` keeps working.

## 6. Idempotency

Send `Idempotency-Key` on any `POST` / `PATCH` / `PUT` / `DELETE` to guarantee **at-most-once**
execution — mandatory for payment-style endpoints that must never double-apply.

- A retried key within `IDEMPOTENCY_TTL_SECONDS` (default **24 h**) replays the **original
  2xx JSON response** verbatim with `Idempotency-Replayed: true`; the handler is not re-run.
- A **concurrent** duplicate gets `409 Conflict`.
- Failures release the claim, so a corrected retry with the same key executes normally.
- Keys are scoped to `(user, tenant, method, path, key)` — two tenants or users can never collide.
- Non-JSON bodies (streams, files, 204s) are not cached. Platform/webhook/attendance surfaces are
  skipped. If Redis is unavailable the interceptor degrades to a no-op (pass-through + warning log)
  so a Redis blip never 500s the API.

## 7. Pagination, Filtering, Sorting & Search

The platform uses **offset pagination** with the shared `PaginationQueryDto` base:

| Query param | Default | Rules |
| --- | --- | --- |
| `skip` | `0` | `>= 0`, integer |
| `take` | `20` | `1..200` (hard cap, clamped) |
| `sortOrder` | `asc` | `asc` \| `desc` |
| `search` | — | free text, case-insensitive, applied per-module |
| `sortBy` | module | module-declared `@IsIn([...])` enum — invalid keys fail validation |

List endpoints return an **array body** (backward-compatible) with pagination metadata as headers:

```
X-Total-Count: 45
X-Total-Pages: 3
X-Page: 2
X-Page-Size: 20
Link: </students?skip=0&take=20>; rel="prev", </students?skip=40&take=20>; rel="next"
```

`applyPaginationMetadata` (in `common/pagination/pagination.util.ts`) owns these headers; modules
just call it with `(res, total, query, req.originalUrl)`.

## 8. Rate limiting

- Global per-IP window for every route: `THROTTLE_LIMIT` requests per `THROTTLE_TTL` ms
  (defaults **100 / 60 s**, env-configurable).
- Sensitive auth endpoints override with stricter windows via `@Throttle()` — `AUTH_THROTTLE`
  (5/min on login/MFA/refresh) and `MFA_THROTTLE`.

## 9. Request logging

Every request is logged exactly once with method, path, status, latency, `requestId`, resolved
tenant, acting user and client IP (4xx → warn, 5xx → error, else debug). `/health` and the Swagger
UI are skipped. Implemented by the global `ApiLoggingInterceptor`.

## 10. API groups

| Group | Swagger tag(s) | Covers |
| --- | --- | --- |
| Auth | `auth`, `platform` | Tenant login/MFA/sessions; platform operator login |
| Tenants | `tenants`, `saas` | Tenant lifecycle, settings, features, entitlements, plans, subscriptions |
| Students | `students` | Student 360: profiles, admission numbers, bulk, CSV export |
| Admissions | `admissions` | Applications, documents, evaluations, offers, insights |
| Academics | `academics`, `timetable`, `organization` | Courses, curricula, offerings, registrations, advising, calendar, timetable |
| Attendance | `attendance` | Sessions, marks, devices & device ingestion |
| Exams | `exams`, `results`, `certificates` | Exam definitions, scheduling, marks, grading, results, certificates |
| Finance (fees) | `fees` | Fee heads, structures, demands, concessions, payments, refunds |
| Billing (SaaS) | `billing`, `payments` | Subscriptions, invoices, payment recording, billing summaries |
| Reports | `reports`, `analytics` | Report catalog, preview, exports, schedules, analytics |
| Platform ops | `platform`, `audit`, `health`, `security`, `users` | Audit log, usage, health, security, user management |

## 11. Config reference

New env vars introduced by the platform contract (schemas in `packages/config`, defaults shown):

| Var | Default | Purpose |
| --- | --- | --- |
| `THROTTLE_TTL` | `60000` (ms) | Global throttler window |
| `THROTTLE_LIMIT` | `100` | Requests per window |
| `IDEMPOTENCY_TTL_SECONDS` | `86400` | Idempotency cache lifetime |

See `apps/api/.env.example` for the full set.

## 12. Local development

```bash
pnpm install
pnpm db:migrate        # apply Prisma migrations
pnpm --filter @college-erp/api dev
# API   → http://localhost:3000
# Docs  → http://localhost:3000/api/docs
```

Checks this workspace uses: typecheck, lint, unit tests, `prisma validate`/`generate`, e2e
(`test:e2e` — needs Postgres + Redis up) and a Nest production build.