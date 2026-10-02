# Parent / Guardian Portal (`/parent-portal`)

Read-only self-service API for a tenant user who is linked to one or more `Guardian` rows. It is a
**composition layer** over the existing modules — no new domain tables, no duplicated business
rules.

## How access works

- A guardian is linked to a login account through `Guardian.userId` (set from the existing Students
  API — `POST /students/:studentId/guardian` or the generic record endpoints, via the `userId`
  field). One guardian has one `Guardian` row per child, so the link is per-student.
- `ParentPortalService.listChildren` resolves every non-deleted child via
  `Guardian.userId = authenticated user id`.
- Every child-scoped route takes an optional `studentId`. `resolveChild` checks it against the
  caller's own linked children and throws `403` otherwise; omitting it falls back to the first
  linked child. **There is no path parameter that bypasses this check**, so a guardian can never
  read another student's data even if they guess an id.
- The authorization anchor is the **guardian link**, not the `PARENT` role: an account with the
  `PARENT` role but no `Guardian` row is refused.
- Endpoints are not RBAC-gated (a parent holds no staff permissions); they are gated by
  `JwtAuthGuard`, `TenantMatchGuard` and, per section, `FeatureFlagsGuard` via `@RequireFeature`
  so a plan without a module never serves that module's data here either.
- `notices` is the guardian's own per-user notification inbox; `documents` is the linked child's
  records and downloads are signed through the tenant-prefix-validated `StorageService`.

## Endpoints

| Method | Path | Feature gate | Reuses |
| --- | --- | --- | --- |
| GET | `children` | — | `Guardian`/`Student` (the access anchor) |
| GET | `dashboard` | — | tenant-scoped reads |
| GET | `profile` | — | `Student`, `Guardian`, `StudentEnrollment`, `StudentHold` |
| GET | `attendance` | attendance | `StudentAttendance` |
| GET | `timetable` | timetable | `Timetable`/`TimetablePeriod`/`TimetableEntry` |
| GET | `fees` | fees | `StudentFee`/`FeeDemand` |
| GET | `payments` | payments | `StudentPayment` |
| GET | `exams` | exams | `ExamRegistration`/`ExamSession`/`ExamSubject` |
| GET | `results` | results | `ResultProcess`/`StudentResult` |
| GET/POST | `notices` | notifications | `NotificationsService` per-user inbox |
| GET | `documents` | documents | `StudentDocument` |
| GET | `documents/:id/download-url` | documents | `StorageService` signed URL |
| GET | `transport` | transport | `StudentTransportPass` |
| GET | `hostel` | hostel | `StudentHostelBooking`/`HostelComplaint` |

## Frontend

Routes live under `/parent/*` in `apps/web/src/routes/parent/`, wrapped by `ParentGate` (which
verifies the guardian link) and `ParentPortalLayout` (child switcher + responsive shell). Staff land
on the existing `/dashboard`; users whose roles include `PARENT` get a link to the portal.
