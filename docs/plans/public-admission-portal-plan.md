# Plan — Public Online Admission Portal

Status: **implemented (branch `feature/public-admission-portal`)** — see "Implementation notes" at the end
Owner: parth.prajapati
Area: `apps/api/src/modules/admissions`, `apps/web`, `apps/worker`, `packages/database`
Feature flag: existing `admissions` module flag + new per-session portal toggle

## Goal

Let a prospective student apply to a college themselves, from a public branded page, with no
staff data entry:

1. Open `/apply/<college-slug>` → see open admission sessions and programs.
2. Verify email/phone, fill the configurable application form, upload documents.
3. Submit → a normal `AdmissionApplication` appears in the staff admissions pipeline.
4. Track status by application reference; accept or decline an offer.

Everything downstream (verification, merit, counselling, enrolment) keeps using the existing
staff-side admissions module unchanged.

## Why this feature (evidence from the current code)

| Observation | Where |
|---|---|
| Admissions has **no public surface** — every endpoint is staff-authenticated, and the domain code says so explicitly: "Admissions is staff-facing (applicants don't log in), so OWN is deliberately impossible." | `apps/api/src/modules/admissions/admissions.service.ts:100` |
| The application form is already configurable per session, and its doc comment says the form JSON is "sent to applicants" — but nothing ever sends it. | `AdmissionFormField` in `packages/database/prisma/schema.prisma`; `AdmissionsService.formDefinition()` |
| Sessions carry intake windows, application/admission fees and per-program seat counts, but only staff can consume them. `source` even defaults to `"FRONT_DESK"`. | `AdmissionSession`, `AdmissionProgramOffer` |
| Application records already support everything an applicant would submit (personal details, guardian JSON, dynamic `data` answers, qualifications, documents, offers). Only `createdBy` (nullable) assumes a staff actor. | `AdmissionApplication` |
| A public, non-tenant-middleware route pattern already exists and is proven. | `public/(.*)` excluded in `apps/api/src/app.module.ts`; `PublicCertificatesController`; `PublicBrandingController` |
| Tenant branding is already readable publicly by slug. | `GET /public/branding/:slug` (`public-branding.controller.ts`) |
| **Admission documents are metadata-only today** — staff types a document name; no bytes are uploaded. A portal needs real uploads. | `AdmissionsService.createDocument()` |
| Signed, single-purpose storage URLs + a virus-scan queue already exist and are used by the general documents module. | `apps/api/src/common/storage`, `apps/worker/src/queues/document-virus-scan` |
| OTP delivery is feasible without new infrastructure: SMTP/SMS/WhatsApp providers, tenant-scoped encrypted provider config, per-channel queues. | `packages/notifications/src/providers.ts`, `apps/worker/src/queues/notifications/channel-delivery.processor.ts` |
| **No live payment gateway exists.** `payments` is a README stub and only a mock provider is implemented. Online fee collection is therefore a separate feature. | `apps/api/src/modules/payments/README.md`, `packages/payments/src/mock-gateway.provider.ts` |
| Audit is centralised and append-only, with `actorType: USER \| PLATFORM_USER \| SYSTEM`. A public applicant is a fourth actor kind. | `apps/api/src/modules/audit/audit.service.ts:9`, `PlatformAuditLog` |

## Decision log (your answers, 22 Oct 2026)

| # | Decision | Outcome |
|---|---|---|
| D1 | Applicant identity | Email/phone OTP → signed `admission:applicant` token + emailed resume link. No `User` rows. |
| D2 | Application fee in v1 | No online payment. Submission allowed with fee pending; staff records it at the counter via `payAdmissionFee`. |
| D3 | v1 depth | Full self-service: apply → upload → submit → status tracking → offer accept/decline. Staff keep verification, merit, counselling and enrolment. |
| D4 | Editing after submit | Editable while status is `INITIATED` or `SUBMITTED`; frozen from `UNDER_VERIFICATION` onward. Staff can reopen with the existing update path. |
| D5 | Staff setup | Full **Portal** tab in Admissions: per-session toggle, slug + copy link, public window, instructions, consent text/version, form preview. |

## Design choices derived from those decisions

1. **Extend the `admissions` module** — add `public-admissions.controller.ts` + service; do not
   create a parallel `admission-portal` module. Business rules (duplicate detection, seat
   counters, status transitions, audit) stay in one place.
2. **Public API lives under `/public/admissions/:tenantSlug/...`** and resolves the tenant from the
   path, exactly like `/public/branding/:slug`. Public routes bypass `TenantResolutionMiddleware`,
   so the tenant is never inferred from a header or subdomain for these endpoints.
3. **Web URL is `/apply/:tenantSlug`** on the same SPA, using the public branding payload for
   logo/colour/name. No new app, no subdomain requirement.
4. **Applicants are not `User` rows.** They are a separate, short-lived access identity: email/phone
   OTP → signed `admission:applicant` token + emailed resume link. Avoids polluting RBAC,
   seat-based user metering (`UsageEvent`) and login/MFA surfaces with transient actors.
5. **Portal is opt-in per session**, off by default. `AdmissionSession.portalEnabled` +
   `publicSlug`. A college can run an internal intake and a public intake side by side.
6. **Applicant-submitted applications are ordinary `AdmissionApplication` rows** with
   `submittedVia = PORTAL`, `createdBy = null`, and a random `publicReference`. Staff scope filters
   (campus/program) continue to work; no new staff pipeline.
7. **Additive migration only.** New columns are nullable or defaulted; no existing table is
   rewritten; staff endpoints keep their current contracts.
8. **Documents are real uploads** via signed URLs bound to the application + applicant token, run
   through the existing virus-scan queue before staff can verify them.
9. **Portal-editable until verification** (D4) — the applicant PATCH route checks the status before
   every write, not just in the UI.
10. **No applicant-side chat/agent accounts, no multilingual UI, no offline mode** in v1.

## Architecture

### Request path

```
Browser  /apply/:tenantSlug
   │
   ├── GET  /public/branding/:slug            (exists)  → logo, colours, college name
   ├── GET  /public/admissions/:tenantSlug/sessions     → open sessions + programs
   ├── POST /public/admissions/:tenantSlug/applicant/otp     → send code
   ├── POST /public/admissions/:tenantSlug/applicant/verify  → applicant access token
   ├── POST /public/admissions/:tenantSlug/applications      → create draft
   ├── PATCH .../applications/:id                            → save sections
   ├── POST .../applications/:id/documents/upload-url        → signed PUT
   ├── POST .../applications/:id/documents/:docId/confirm    → enqueue virus scan
   ├── POST .../applications/:id/submit                      → staff pipeline
   ├── GET  .../track/:reference  (token)                    → status timeline
   └── POST .../offers/:offerId/accept|decline
```

### Tenant resolution

`/public/*` is already excluded from `TenantResolutionMiddleware` (`app.module.ts`). The public
admissions service resolves the tenant by slug **per request**, then uses the existing
tenant-scoped Prisma client for that tenant id (including enterprise dedicated-DB tenants via
`TenantConnectionService`). Every query is additionally filtered by that tenant id — never by a
client-supplied body field.

Consequence to respect: a wrong/unknown slug must return the same generic 404 as a disabled
portal, so slugs cannot be enumerated.

### Applicant identity (D1)

New table `AdmissionApplicantAccess`:

- contact normalised (email lowercased / phone E.164) + SHA-256 hash for lookup
- `otpHash`, `otpExpiresAt` (10 min), `otpAttempts`, `otpSentAt`, `verifiedAt`
- `resumeTokenHash` + `resumeExpiresAt` (30 days) for the emailed "continue application" link
- `applicationId` (nullable until a draft is created), `lastSeenAt`, `ipHash`, `userAgentHash`

Access token: JWTs signed with the existing key pair, `scope: admission:applicant`,
`{ tenantId, applicationId?, accessId, jti }`, ~45 min TTL. Verified by a new
`ApplicantAccessGuard` — deliberately **not** `JwtAuthGuard`, which expects a `User` row.

Abuse controls on the OTP endpoints: `@Throttle` per IP and per contact (e.g. 3 sends / 10 min,
5 verify attempts / 15 min), constant-time hash comparison, no distinction between "unknown
contact" and "wrong code" in responses, and a counter in `AdmissionApplicantAccess` so a
distributed IP pool cannot bypass the per-contact limit. Captcha (Turnstile/hCaptcha) is optional
and config-driven; add only if spam appears.

### Application form

`AdmissionsService.formDefinition(tenantId, sessionId, programId)` already merges default fields,
per-session `AdmissionFormField` rows and the `TenantConfiguration.admissions` section. The public
endpoint returns the same shape **minus** internal metadata (no ids, no `createdBy`, no draft
state), plus the document checklist and the consent block.

Validation on submit: required dynamic fields present, programme still open, seat available,
session window open (tenant timezone), consent version accepted, required documents uploaded.

### Edit window (D4)

- `PATCH` from the portal is accepted only while the application is `INITIATED` or `SUBMITTED`.
- From `UNDER_VERIFICATION` onward the portal returns `409` with a "contact the admissions
  office" message; staff use the existing `updateApplication` path to reopen or correct.
- Every applicant edit writes an `AdmissionActivity` row and an audit entry, and re-runs the
  completeness check — a previously submitted application cannot be left missing a required
  document by an edit.
- Fee status is display-only for applicants (pending / recorded at counter); they cannot mark it
  paid.

### Documents

- `POST .../documents/upload-url` returns a short-lived signed PUT (existing `StorageService`)
  under `tenants/<tenantId>/admissions/<applicationId>/...`.
- Client uploads directly, then `POST .../confirm` with size/mime/checksum; server re-validates
  category against the session checklist, mime against an allow-list, size against a cap
  (default 10 MB), and per-application document count.
- Confirmed uploads enqueue the existing `document-virus-scan` job. Status stays
  `PENDING`/`SCANNING`; staff cannot verify an unscanned or infected document.
- Deleting a draft document removes the storage object and the row.

### Notifications

Triggered through the existing notifications service (templates, per-channel queues, branding):

- `APPLICATION_RECEIVED` (applicant + admissions staff)
- `DOCUMENT_REJECTED` / `APPLICATION_NEEDS_INFO`
- `OFFER_ISSUED`, `OFFER_EXPIRING` (worker reminder)
- `DRAFT_ABANDONED` (worker, 7 days)

Each trigger is seeded as a template so colleges can edit wording. Delivery requires the tenant
(or platform default) to have an email/SMS provider configured; `ConsoleProvider` is dev-only —
flag this in the go-live checklist.

### Audit

Applicant actions are audited via `AuditService.record` with a new `APPLICANT` actor kind added to
`RecordAuditEntryInput.actorType` (plus the DB-side constraint if `PlatformAuditLog` constrains
it), `actorUserId = null`, `actorEmail` = verified contact. Actions: portal application created,
submitted, document uploaded/deleted, offer accepted/declined, OTP sent/verified/failed.

## Data model changes

One additive migration, e.g. `20261022090000_add_admission_portal`.

### `AdmissionSession`

| Column | Type | Notes |
|---|---|---|
| `publicSlug` | `VarChar(191)?` | URL segment; `@@unique([tenantId, publicSlug])` |
| `portalEnabled` | `Boolean @default(false)` | opt-in |
| `portalOpenAt` / `portalCloseAt` | `DateTime?` | overrides `startAt`/`endAt` for the public window; tenant timezone |
| `portalInstructions` | `Json?` | intro copy, eligibility note, support contact |

### `AdmissionApplication`

| Column | Type | Notes |
|---|---|---|
| `publicReference` | `VarChar(32)?` | random, human-quotable; `@@unique([tenantId, publicReference])` |
| `submittedVia` | `AdmissionSubmissionChannel @default(STAFF)` | enum `STAFF \| PORTAL` |
| `consentAcceptedAt` | `DateTime?` | |
| `consentVersion` | `VarChar(32)?` | matches the configured consent text version |
| `applicantAccessId` | `Char(36)?` | FK → `AdmissionApplicantAccess`, `SetNull` |

### `AdmissionDocument`

| Column | Type | Notes |
|---|---|---|
| `uploadedVia` | `AdmissionSubmissionChannel?` | distinguishes portal uploads |
| `scanStatus` | `VarChar(32)?` | mirrors the general documents lifecycle (`PENDING/SCANNING/CLEAN/INFECTED/FAILED`) |

### New `AdmissionApplicantAccess`

Tenant-scoped, `tenantId` FK, contact fields + hashes, OTP state, resume token state, `applicationId`
(nullable), `expiresAt`, timestamps. Indexes: `[tenantId, contactHash]`, `[tenantId, applicationId]`,
`[expiresAt]` (cleanup).

Order of migration steps to stay safe on MySQL: create table → add nullable columns → add uniques
on nullable columns (MySQL allows multiple NULLs) → backfill `submittedVia = STAFF` for existing
rows via the column default, no data rewrite → deploy code.

## API surface

New files in `apps/api/src/modules/admissions/`:
`public-admissions.controller.ts`, `public-admissions.service.ts`,
`applicant-access.service.ts`, `applicant-access.guard.ts`, `dto/public-admissions.dto.ts`.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/public/admissions/:tenantSlug/sessions` | none | Open sessions w/ programs, seats, fees |
| GET | `/public/admissions/:tenantSlug/sessions/:publicSlug/form` | none | Fields, doc checklist, consent text, instructions |
| POST | `/public/admissions/:tenantSlug/applicant/otp` | none | Send code (rate-limited) |
| POST | `/public/admissions/:tenantSlug/applicant/verify` | none | Verify code → access token |
| POST | `/public/admissions/:tenantSlug/applicant/resume` | none | Resume token → access token |
| GET | `/public/admissions/:tenantSlug/me` | applicant | Current draft + status |
| POST | `/public/admissions/:tenantSlug/applications` | applicant | Create draft |
| PATCH | `/public/admissions/:tenantSlug/applications/:id` | applicant | Save sections while `INITIATED`/`SUBMITTED` (D4) |
| POST | `/public/admissions/:tenantSlug/applications/:id/qualifications` | applicant | Add/update/delete qualification |
| POST | `/public/admissions/:tenantSlug/applications/:id/documents/upload-url` | applicant | Signed PUT |
| POST | `/public/admissions/:tenantSlug/applications/:id/documents/:docId/confirm` | applicant | Confirm + scan |
| DELETE | `/public/admissions/:tenantSlug/applications/:id/documents/:docId` | applicant | Remove while editable (D4) |
| POST | `/public/admissions/:tenantSlug/applications/:id/submit` | applicant | Submit |
| GET | `/public/admissions/:tenantSlug/track/:reference` | applicant | Status timeline, documents, offer |
| POST | `/public/admissions/:tenantSlug/offers/:offerId/accept` | applicant | Accept |
| POST | `/public/admissions/:tenantSlug/offers/:offerId/decline` | applicant | Decline |

Staff-side additions (existing protected controller): `PATCH /admissions/sessions/:id/portal`
(enable, slug, window, instructions) and `GET /admissions/applications?submittedVia=PORTAL`.
Swagger: new tag `public-admissions`, excluded from the production docs build like the rest.

## Web surface

New folder `apps/web/src/routes/apply/`:

- `apply-layout.tsx` — public shell, branding from `public/branding/:slug`, no sidebar/nav
- `apply-root.tsx` — session + programme picker, intake deadlines, fee display
- `apply-verify.tsx` — contact + OTP step
- `apply-form.tsx` — multi-step wizard (personal → programme → qualifications → dynamic answers)
- `apply-documents.tsx` — checklist, drag-drop upload, per-file state, retry
- `apply-review.tsx` — summary, consent checkbox, submit
- `apply-status.tsx` — reference lookup + timeline, document feedback, offer actions
- `apply-shared.tsx` — types, step state, validation helpers
- `apply-helpers.spec.ts` — pure validation/step-logic tests

Routes added to `apps/web/src/App.tsx` as siblings of `/verify/*` (public, no `ProtectedRoute`):

```
/apply/:tenantSlug
/apply/:tenantSlug/status
```

Applicant token kept in `sessionStorage` (never the tenant auth token, never the httpOnly refresh
cookie). API calls use `apiFetch(..., { skipAuth: true, tenantSlug })` + explicit
`Authorization: Bearer <applicantToken>`.

## Staff UI changes

- `apps/web/src/routes/admissions.tsx`: new `Portal` tab — per-session enable toggle, slug with
  copy-link button, public window, instructions, consent text/version, preview of the published
  form.
- `admissions-applications.tsx`: `Source` column (`Staff` / `Online`), filter, public reference
  shown on the detail; document rows show real files with open/download and scan state.
- `admissions-shared.tsx`: shared types for the new fields.

## Config, seeding, worker

- `packages/config/src/index.ts`: env additions if needed (`PUBLIC_APP_URL` already exists for
  certificates; reuse it for portal links). No new secret required.
- `TenantConfiguration.data.admissionsPortal`: `{ enabled, consentText, consentVersion,
  supportEmail, supportPhone, maxUploadMb, allowedMimeTypes, captcha }` — read via the existing
  configuration service, defaults applied in code.
- Seed: demo tenant gets one open session with `portalEnabled` + `publicSlug = "demo-2026"`, plus
  the notification templates.
- Worker `apps/worker/src/queues/admission-portal/`: hourly job that expires OTPs/resume tokens,
  purges abandoned drafts older than N days (config, default 30) together with their storage
  objects, and sends `OFFER_EXPIRING` / `DRAFT_ABANDONED` reminders.

## Security, privacy, abuse

- Public write surface: strict DTO whitelisting (global `ValidationPipe` already forbids unknown
  fields), per-endpoint throttles, OTP attempt caps, per-IP and per-contact counters.
- No enumeration: identical responses for unknown tenant/slug/reference, random references, status
  lookup requires both reference and a verified access token (or OTP re-verification).
- Uploads: private bucket/prefix, signed single-purpose URLs, mime allow-list, size cap, virus scan
  before staff visibility, no public GET.
- PII: consent captured with version + timestamp; log redaction for contact/OTP values; retention
  policy for rejected/abandoned applications documented; applicant PII lives only on
  `AdmissionApplication` / `AdmissionApplicantAccess`, deletable by application cascade.
- Seat concurrency: submit/accept must use a transaction with a conditional `filledSeats` update
  (`UPDATE ... WHERE filledSeats < seats`) so two applicants cannot take the last seat.
- Cross-tenant: every public query filtered by the resolved tenant id; add e2e coverage that a
  slug-A applicant token cannot read slug-B data even with a guessed id.

## Tests

**Unit** — OTP issue/verify (expiry, attempts, constant-time compare), reference generation
collision handling, session-window/timezone rules, form filtering, document category/mime/size
validation, applicant-token guard.

**e2e** — new `apps/api/test/public-admissions.e2e-spec.ts`:
1. happy path: sessions → OTP → draft → upload → submit → staff sees `submittedVia=PORTAL`
2. closed / not-yet-open session rejected (incl. timezone edge)
3. portal disabled or unknown slug → 404, no tenant leak
4. duplicate application flagged, not blocked twice
5. OTP brute force throttled; wrong code and unknown contact indistinguishable
6. upload with foreign tenant storage key rejected; infected scan blocks staff verification
7. submit without required document / consent → 400 with field details
8. seat-full submit and double offer-accept → one winner, no overbooking
9. cross-tenant isolation on every public route (extends `tenant-isolation.e2e-spec.ts` patterns)
10. edit window: `PATCH` works in `SUBMITTED`, returns `409` in `UNDER_VERIFICATION`, and cannot
    remove a required document after submit
11. staff endpoints unchanged (regression on existing `admissions` coverage)

**Web** — wizard step/validation helpers; manual run of the 4 viewport sizes used elsewhere.

## Implementation order

| Phase | Work | Est. |
|---|---|---|
| 0 | Spike public-slug tenant resolution, signed upload and notification delivery on a dedicated-DB tenant | 0.5 d |
| 1 | Schema + migration + regenerate client; enums; backfill check | 1 d |
| 2 | `AdmissionApplicantAccess` + OTP + token guard + throttles + audit | 2 d |
| 3 | Public catalog/form endpoints + create/update draft (reusing `formDefinition`, duplicate detection) | 3 d |
| 4 | Document upload path (signed URL, confirm, scan integration, delete) | 2 d |
| 5 | Submit + status tracking + offer accept/decline (transactional seats) | 2 d |
| 6 | Staff portal settings tab, source filter, real-file document review | 2 d |
| 7 | Web public portal (layout, wizard, upload, status) | 5 d |
| 8 | Notification templates + worker cleanup/reminders | 2 d |
| 9 | Security hardening, e2e suite, docs (Swagger tag, README, `docs/admission-portal.md`) | 3 d |
| 10 | Seed/demo data, go-live checklist, manual QA | 1 d |

Roughly 3–4 weeks of focused work; the API (phases 1–5) is usable by the existing staff UI before
the web wizard is finished.

## Files affected (summary)

- `packages/database/prisma/schema.prisma` + one migration folder
- `apps/api/src/modules/admissions/` — 5 new files, `admissions.controller.ts`,
  `admissions.service.ts`, `admissions.module.ts`, `dto/`
- `apps/api/src/modules/audit/audit.service.ts` — applicant actor kind
- `apps/api/src/app.module.ts` — no middleware change needed (already `public/*`); Swagger tag in `main.ts`
- `apps/api/src/modules/notifications/` — trigger wiring only
- `apps/worker/src/` — new queue module + reminder/cleanup processor
- `apps/web/src/App.tsx`, `apps/web/src/routes/apply/*`, `admissions*.tsx`
- `packages/database/prisma/seed.ts`, `packages/config/src/index.ts` (if env changes)

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Public endpoints become an abuse vector (spam applications, OTP bombing, upload floods) | per-contact + per-IP throttles, OTP caps, optional captcha, per-application upload quota, scan queue |
| Duplicate/noisy applications at scale | existing duplicate detection at submit + staff merge/clear actions already exist; add a "portal duplicates" filter |
| Seat races at offer acceptance | conditional transactional update on `filledSeats`; e2e for double accept |
| Document review workload shifts to staff (real files now) | checklist enforcement before submit, scan-before-review, bulk verify already exists |
| Applicant token leakage via URL/referrer | token in memory/sessionStorage, `Referrer-Policy` already set by helmet, short TTL, resume tokens single-use |
| Timezone mistakes on intake windows | store UTC, evaluate against `Tenant.timezone`, e2e edge test |
| Email/SMS provider not configured for a tenant | pre-flight check on portal enable; block enabling without a working provider (or warn loudly) |
| Dedicated-DB (enterprise) tenants on public routes | resolve tenant → `TenantConnectionService` per request; explicit test |
| Consent/retention obligations (DPDP/GDPR) | versioned consent, documented retention, purge job, deletable applicant data |

## Acceptance criteria

1. A prospective student can apply end-to-end from `/apply/<slug>` on a phone without staff help.
2. The resulting application is indistinguishable from a staff-created one downstream, and is
   visible in the staff pipeline with `Source = Online`.
3. Real document files are stored privately, scanned, and reviewable by staff.
4. Applicants can track status and accept/decline an offer; seats never overbook.
5. Portal can be enabled per session by a college admin, with no code deploy.
6. No public route leaks data across tenants; all abuse paths are rate-limited and audited.
7. Applicants can correct their application until verification starts, and cannot after that (D4).
8. Existing admissions staff flows and tests pass unchanged.

## Appendix — alternative ideas considered

- **Course feedback / surveys (NAAC/NBA accreditation)** — `HelpdeskFeedback` and `AiFeedback`
  exist, but there is no survey engine at all, even though the blueprint lists "feedback and
  surveys". Medium-sized, self-contained, high accreditation value.
- **Alumni relations module** — `StudentStatus.ALUMNI` exists but there is no alumni model
  (directory, events, donations, mentorship, referrals). Wholly new module.

## Implementation notes (what shipped on this branch)

Phases 1–8 of the plan are implemented as one vertical slice:

| Area | Delivered |
|---|---|
| Schema | `AdmissionSubmissionChannel`, `AdmissionApplicantChannel`, session portal columns, application provenance columns, document `uploadedVia`/`scanStatus`, `admission_applicant_accesses`, `Notification.recipientAddress`/`recipientName`; migration `20261022120000_add_admission_portal` |
| Applicant auth | OTP issue/verify (HMAC'd codes, 10-min TTL, 5 attempts, 60s cooldown, per-access send cap), RS256 `admission:applicant` tokens, single-use resume tokens |
| Public API | `/public/admissions/:tenantSlug/...` — catalogue, form, OTP, draft create/update, qualifications, signed document upload + confirm + download, submit, track, offer accept/decline |
| Storage | Real admission files, private signed PUT/GET, mime/size limits, virus scan through the existing queue |
| Staff | Admissions → **Portal** tab (publish/unpublish, slug, window, consent/support copy), `submittedVia` filter, scan-aware document verification |
| Worker | `admission-portal-maintenance` hourly sweep (expire offers, purge stale access rows and abandoned drafts + their files); scan processor handles `AdmissionDocument`; delivery resolves `recipientAddress` |
| Seed | Demo 2027 intake published at `/apply/<demo-tenant>` with `demo-2027` slug |
| Tests | `admission-portal.config.spec.ts` (config precedence/clamps), `apply-helpers.spec.ts` (wizard helpers) |

**Deliberate deviations from the text above**

1. `AdmissionApplicantAccess.applicationId` is the single FK; there is no `applicantAccessId` on the
   application. Two FKs between the same tables bought nothing and complicated cascade semantics.
2. Applicant notifications are wired (OTP, resume link, application received); offer-issued emails
   and admissions-staff fan-out are not — staff already see new applications in the pipeline, and
   staff targeting needs a role/department audience resolver.
3. Offer-expiry reminders are not scheduled; the hourly sweep marks overdue offers `EXPIRED`.
   An applicant sees that on the tracking page.
4. The staff UI edits per-session instructions; the tenant-wide `admissionsPortal` section is read
   by the resolver but has no dedicated settings screen yet.
5. No captcha at launch (config flag reserved); abuse controls are throttles + OTP counters.
6. End-to-end coverage for the public flow is still to be added — it needs MySQL + Redis, which
   were not available while this slice was built. Unit coverage exists for the pure logic.

**Before production**

- Run `pnpm db:migrate` (or `db:deploy:safe`) and confirm the demo slug renders.
- Configure an email/SMS provider per tenant; without one the worker falls back to `ConsoleProvider`
  in development and fails terminally in production.
- Add the e2e suite listed in "Tests" above; it is the acceptance gate for phase 9.

- **Real-time event stream (SSE/WebSocket)** — nothing in the web app subscribes to server events
  today; notifications/approvals/helpdesk are poll-based. Infra improvement, not a product feature.
- **Live payment gateway + reconciliation** — `payments` is a stub and would unlock online fees
  for both admissions and student fees. Large, and the natural follow-up to D2.
