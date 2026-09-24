# Placements module

The full placement-lifecycle API and domain logic: recruiting **companies** & their **contacts**,
placement **drives** & **positions**, **eligibility** evaluation (CGPA / percentage / backlog
criteria scored against each student's `StudentAcademicRecord` + `CourseBacklog`), student
**resumes** (tenant-prefixed signed-URL upload/download like HR documents), job **applications**,
interview **rounds** & per-student **results**, **selections**, offer **letters**, **joining**
tracking, and the closing-the-books **outcomes** record that backs statistics, department
analytics and the generated placement report.

## Feature & permissions

- Routed under `@RequireFeature(FEATURE_KEYS.PLACEMENTS)`.
- Existing permission keys are used as-is: `placements.view` (reads/lists/statistics/reports),
  `placements.create` (companies/contacts/drives/positions/resumes/applications/rounds/offers/
  joinings), `placements.update` (edits, status transitions, selections, results),
  `placements.approve` (outcome declaration — the closes-the-books step), `placements.export`.
- Seeded roles today: Principal → `PLACEMENTS_VIEW`, Placement Officer → `PLACEMENTS_MANAGE`
  (implies view/create/update/approve at GLOBAL scope).

## Scope model (placements-scope.ts)

- **Catalog rows** (company, contact, drive, position, round) are tenant-wide once the caller
  holds the placement permission — every current grant is GLOBAL.
- **Student-anchored rows** (eligibility, resumes, applications, round results, selections,
  offers, joinings, outcomes) are filtered by the caller's grants along the student dimension
  via `placementStudentWhere` (reuses the students-module convention): GLOBAL → unrestricted,
  OWN → own `Student.userId`, CAMPUS → `student.campusId` in granted, DEPARTMENT →
  `student.program.departmentId` in granted, PROGRAM → `student.programId` in granted. Multiple
  grants are OR'd; an empty grant set defensively yields an impossible filter.

## Database

13 tenant-owned models + 12 enums live in `packages/database/prisma/schema.prisma`
(`PlacementCompany` … `PlacementOutcome`) with a pre-generated migration
`20260930000000_add_placement_module`. Money is integer cents; eligibility results freeze
`criteriaSnapshot`/`studentSnapshot` at evaluation time; `PlacementOutcome` is unique per
(tenant, academicYear, student) and is the analytics anchor.

## Audit + notifications

Every mutation records under `AUDIT_MODULES.PLACEMENTS` with placement-specific
`AUDIT_ACTIONS.*` constants. Students are notified (via `NotificationsService.sendSystem`, using
their linked `Student.userId`) on: drive publish, application shortlist/reject, round scheduling,
offer issue, selection and joining status changes.

## Key flows

1. Register company + contacts → create drive → add positions (each carrying the eligibility
   criteria + package) → publish drive (notifies students).
2. Evaluate eligibility (per position: `POST /placements/eligibility/evaluate`) which upserts
   `PlacementEligibility` rows with frozen snapshots; exempt/override per student.
3. Collect resumes (signed upload URL → confirm) → apply students (`POST /placements/applications`
   and `/bulk`; single applications enforce eligibility + deadline).
4. Shortlist/reject → schedule rounds → record per-student results → create selections →
   issue offers → accept/decline (accepting auto-creates a `PENDING` joining) → update joining.
5. Declare per-year outcomes (`POST /placements/outcomes`, requires `placements.approve`) →
   view statistics / department analytics / the generated report.

See `packages/types/src/placements.ts` for the shared DTO contracts consumed by the web app.