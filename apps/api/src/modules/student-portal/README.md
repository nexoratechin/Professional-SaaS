# Student Portal (`/student-portal`)

Self-service API for a tenant user who is linked to a `Student` record. It is a **composition
layer** over the existing modules — no new tables, no duplicated business rules.

## How access works

- The portal resolves the caller's student via `Student.userId = authenticated user id`
  (`StudentPortalService.resolveStudent`). A user with no linked student gets `403`.
- There is **no** `:studentId` path parameter anywhere: every query is anchored to the resolved
  student id, and every write is performed under the caller's own identity.
- Endpoints are not RBAC-gated (a student holds no staff permissions); they are gated by
  `JwtAuthGuard`, `TenantMatchGuard` and, per section, `FeatureFlagsGuard` via `@RequireFeature`
  so a plan without a module never serves that module's data here either.

Linking a user to a student is done through the existing Students API: `POST /students` or
`PATCH /students/:id` with `userId` (the `Student.userId` column).

## Endpoints

| Method | Path | Feature gate | Reuses |
| --- | --- | --- | --- |
| GET | `dashboard` | — | tenant-scoped reads |
| GET/PATCH | `profile` | — | `Student` (whitelisted contact fields) |
| GET | `attendance` | attendance | `StudentAttendance` |
| GET | `timetable` | timetable | `Timetable`/`TimetablePeriod`/`TimetableEntry` |
| GET | `courses` | academics | `CourseRegistration`/`StudentEnrollment` |
| GET | `fees` | fees | `StudentFee`/`FeeDemand` |
| GET | `payments` | payments | `StudentPayment` |
| POST | `payments` | payments | `FeePaymentsService.record` (receipt + allocation + ledger) |
| GET | `exams` | exams | `ExamRegistration`/`ExamSession`/`ExamSubject` |
| GET | `results` | results | `ResultProcess`/`StudentResult` |
| GET/POST | `certificates`, `certificates/:id/download-url` | certificates | `CertificatesService` (lifecycle, history, audit) |
| GET | `library` | library | `StudentLibraryLoan`/`LibraryFine`/`LibraryReservation` |
| GET | `hostel` | hostel | `StudentHostelBooking`/`HostelComplaint` |
| GET | `transport` | transport | `StudentTransportPass` |
| GET/POST | `notices`, `notices/:id/read` | notifications | `NotificationsService` per-user inbox |
| GET/POST | `tickets`, `tickets/lookups`, `tickets/:id`, `tickets/:id/comments`, `tickets/:id/feedback` | helpdesk | `HelpdeskTicketService`/`HelpdeskConfigService` |
| GET/POST | `documents`, `documents/upload-url`, `documents/:id/confirm-upload`, `documents/:id/download-url` | — | `DocumentsService` (presigned upload + virus scan + download log) |

## Frontend

Routes live under `/portal/*` in `apps/web/src/routes/portal/`, wrapped by `PortalGate` (which
verifies the student link) and `StudentPortalLayout` (mobile-first responsive shell). Staff land on
the existing `/dashboard`; users whose roles include `STUDENT`/`PARENT` get a link to the portal.
