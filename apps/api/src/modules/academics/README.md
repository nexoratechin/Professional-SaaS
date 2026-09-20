# Academics (Phase 4)

Course catalog & prerequisites, curricula with versioned course maps, course offerings &
faculty assignment, student course registration (windows, capacity, waitlist, prerequisites),
academic advising, progression/promotion & backlogs, and the academic calendar.

Feature flag: `academics` (`FEATURE_KEYS.ACADEMICS`).

Reuses the Foundation/Organization master data (Program, AcademicYear, Term — the semester
anchor, Campus, Department, Section, Batch) and Student 360 entities (Student,
StudentEnrollment). Faculty are `User` rows (HR module not built yet), so offerings and
advising sessions reference `userId`.

## Data model (`packages/database/prisma/schema.prisma`)

| Model                    | Table                           | Purpose |
| ------------------------ | ------------------------------- | ------- |
| `Course`                 | `courses`                       | Catalog entry (credits, type, soft-archived) |
| `CoursePrerequisite`     | `course_prerequisites`          | Directed course→course edge (minGrade optional, cycle-guarded) |
| `Curriculum`             | `curricula`                     | Named curriculum per program |
| `CurriculumVersion`      | `curriculum_versions`           | Revision; one `ACTIVE`/`isCurrent` per curriculum |
| `CurriculumCourse`       | `curriculum_courses`            | Course-in-semester membership (credit override, compulsory) |
| `CourseOffering`         | `course_offerings`              | Concrete term run (program/section/batch, capacity, windows) |
| `CourseOfferingFaculty`  | `course_offering_faculty`       | Faculty↔offering assignments (User rows) |
| `CourseRegistration`     | `course_registrations`          | Student seat (registered/confirmed/waitlisted) |
| `AcademicAdvisingRecord` | `academic_advising_records`     | Advising/counselling sessions |
| `AcademicProgressionRecord` | `academic_progression_records` | Year snapshot + promotion decision |
| `CourseBacklog`          | `course_backlogs`               | Failed courses pending clearance |
| `AcademicCalendarEvent`  | `academic_calendar_events`      | Announcements (publishing opt-in) |

## API surface (`/academics`)

* `courses` — CRUD + `archive`, `:id/prerequisites`
* `curricula` — CRUD + `archive`, `:id/versions`, version `activate`/`archive`/`courses`/`validate`
* `course-offerings` — CRUD + `cancel`, `:id/faculty` (assign/update/remove), `my-offerings`
* `registrations` — single/bulk register, status transitions (confirm/withdraw/drop/complete), `report`
* `advising` — CRUD + `resolve`
* `progression` — record, `promote-batch`, per-student summary
* `backlogs` — CRUD + `clear`
* `calendar` — CRUD + `publish`

Guards: `JwtAuthGuard`, `TenantMatchGuard`, `PermissionsGuard`, `FeatureFlagsGuard` +
`@RequireFeature('academics')`. Reads are scope-filtered (global/campus/department/program/own)
via `academics-scope.ts`; writes are audit-logged under the `academics` module.