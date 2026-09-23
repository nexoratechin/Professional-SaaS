# Library module (`library` feature flag)

Library Management: catalog (categories / publishers / authors / books), physical copies with
auto-assigned Code-128 barcodes + QR labels and per-copy transaction history, members, circulation
(issue / renew / return / mark-lost + overdue sweeps), reservations (waiting/ready with hold expiry),
fines (overdue / lost / damage), per-tenant circulation rules, notification + audit hooks, and
reports (summary, circulation, inventory).

## Design notes

- **One loan table.** Circulation reuses the pre-existing `StudentLibraryLoan` table (extended with
  optional `copy_id`, `member_id`, `renewal_count`, `last_renewed_at`, `return_condition`,
  `returned_by_id` and a now-optional `student_id`). Catalog issued loans carry the
  `copy`/`member` links and the copy's status is kept in sync; the legacy student-360 "quick loan"
  flow still works because the free-form `itemTitle`/`itemCode` fields remain.
- **Tenant + RBAC.** All routes sit behind `JwtAuthGuard + TenantMatchGuard + PermissionsGuard +
  FeatureFlagsGuard` with `@RequireFeature('library')`. Permissions used: `library.view`,
  `library.create`, `library.update`, `library.delete`, `library.manage` (sweeps, config, mark-lost,
  pay/waive). Scope-aware reads (GLOBAL/CAMPUS/DEPARTMENT/PROGRAM/OWN) are enforced for members,
  loans, reservations and fines via `library-scope.ts`.
- **Per-tenant data.** Catalog/copies/config are tenant-scoped by the DMMF-driven tenant isolation
  client (`TenantScopedPrismaService`); creates explicitly connect `tenant`.
- **Audit + notifications.** Every mutation writes an `AUDIT_MODULES.LIBRARY` audit record
  (`packages/auth/src/audit-keys.ts` — 28 new `LIBRARY_*` actions; rebuild `@college-erp/auth` if it
  changes again). Issue/return/renew/mark-lost and reservation ready/waiting notifications are sent
  to the member's linked user via `NotificationsService`.

## Schema

- Models added to `packages/database/prisma/schema.prisma`: `LibraryConfig`, `LibrarySequence`,
  `LibraryCategory`, `LibraryPublisher`, `LibraryAuthor`, `LibraryBook`, `LibraryBookAuthor`,
  `LibraryCopy`, `LibraryMember`, `LibraryReservation`, `LibraryFine`, `LibraryTransaction`.
- Migration: `packages/database/prisma/migrations/20260927000000_add_library_module/migration.sql`
  (hand-written). Apply once a database is available:

  ```sh
  pnpm db:generate   # regenerate client (already run after the schema edit)
  pnpm db:migrate    # prisma migrate dev (or prisma migrate deploy on a server)
  ```

## API surface

All under `/api/library` (module: `apps/api/src/modules/library`). Highlights:

- `GET /library/lookups` — catalog options + enums + resolving default `LibraryConfig`.
- `GET|POST|PATCH|DELETE /library/categories|publishers|authors`, `GET|POST|PATCH|DELETE
  /library/books`, `GET|POST /library/books/{bookId}/copies`, `GET|PATCH|POST /library/copies/:id`
  (incl. `/status`, `/barcode`, `/transactions`).
- `GET|POST|PATCH|DELETE /library/members` (+ `/status`), `GET|POST /library/loans`
  (+ `/sweep-overdue`, `/:id/renew`, `/:id/return`, `/:id/mark-lost`), reservations
  (+ `/expire-sweep`, `/:id/ready`, `/:id/cancel`), fines (`/:id/pay`, `/:id/waive`), config
  (`GET`/`PUT`), reports (`/reports/summary|circulation|inventory`).

## Web

`apps/web/src/routes/library.tsx` + `library-shared.tsx`, routed at `/library`, linked from the
dashboard for users holding `library.view`. Barcode label rendering (entitlement
`library.barcode`) lives on the Copies tab.