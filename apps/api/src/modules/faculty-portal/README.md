# Faculty Portal

Self-service portal for faculty members. It is a thin composition layer over the existing
domain modules — **no new tables, no parallel business logic**. The single access-control anchor
is the caller's own `Employee` row (`Employee.userId = authenticated user id`); teaching data is
further restricted to the course offerings the caller is actively assigned to via
`CourseOfferingFaculty`, and to the students registered in those offerings.

## Endpoints (`/faculty-portal`)

| Method | Path | Feature | Notes |
| --- | --- | --- | --- |
| GET | `/dashboard` | per-section | Aggregated snapshot; sections disabled on the plan return `null`. |
| GET/PATCH | `/profile` | — | Own employee profile; only a safe whitelist of fields is editable. |
| GET | `/courses` | academics | Assigned course offerings (`CourseOfferingFaculty.isActive`). |
| GET | `/students` | students | Rosters of assigned offerings; optional `courseOfferingId` is re-validated. |
| GET | `/timetable` | timetable | Published `TimetableEntry` rows assigned to the caller + substitutions. |
| GET | `/attendance/sessions` | attendance | Reuses `AttendanceService.listSessions` (OWN-scoped). |
| POST | `/attendance/sessions` | attendance | Offering ownership verified before delegating. |
| GET | `/attendance/sessions/:id` | attendance | Reuses `AttendanceService.getSession`. |
| POST | `/attendance/sessions/:id/mark` | attendance | Reuses `AttendanceService.markSession`. |
| POST | `/attendance/sessions/:id/close` | attendance | Reuses `AttendanceService.closeSession`. |
| GET | `/attendance/report` | attendance | Per-student / per-subject attendance for assigned offerings. |
| GET | `/marks/subjects` | exams | Papers whose course the caller teaches, or that they invigilate. |
| GET | `/marks/subjects/:subjectId` | exams | Roster + marks entries; subject ownership verified. |
| POST | `/marks/subjects/:subjectId/bulk` | exams | Reuses `ExamsService.bulkMarks` after ownership check. |
| POST | `/marks/subjects/:subjectId/submit` | exams | Reuses `ExamsService.bulkSubmitMarks` after ownership check. |
| GET | `/academics` | academics | Teaching assignments, invigilation duties, advising, calendar. |
| GET/POST | `/leave` | hr | Reuses `HrLeaveService` catalogue/balances/applications. |
| POST | `/leave/:id/cancel` | hr | Self-service cancel (own pending application only). |
| GET | `/workload` | hr | `FacultyWorkload` + timetable-derived teaching hours + invigilation. |
| GET | `/notifications` | notifications | In-app inbox (`NotificationsService`). |
| POST | `/notifications/:id/read` | notifications | Marks an inbox item read. |
| GET | `/reports/overview` | reports | Faculty-scoped aggregates (offerings, attendance, marks, leave). |

## Security

- **Anchor**: `resolveFaculty()` resolves `Employee.userId = caller`; no employee → `403`.
- **Offering scope**: every read/write that takes a `courseOfferingId`/`subjectId` re-validates it
  against the caller's active `CourseOfferingFaculty` assignments before touching data.
- **Reused services**: `AttendanceService`/`HrLeaveService`/`HrService` apply their own OWN-scope
  via `PermissionsService`; the faculty system role already holds these OWN grants.
- **Plan gating**: each route carries `@RequireFeature(...)`; disabled modules never serve data.

## Tests

`faculty-portal.service.spec.ts` pins the access-control behaviour: the unlinked-user rejection,
the offering-anchor rejection before any query runs, and the positive anchoring of roster reads.
