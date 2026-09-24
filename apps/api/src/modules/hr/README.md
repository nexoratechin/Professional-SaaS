# HR module

Employee master, designations, joining/exit, employee documents, faculty workload, leave
(types, balances, applications with approval), performance reviews, salary structures, payroll
runs with payslips, and an overview report. Feature flag: `hr`.

## Guards & scope

Controllers run behind `JwtAuthGuard + TenantMatchGuard + PermissionsGuard + FeatureFlagsGuard` with
`@RequireFeature(FEATURE_KEYS.HR)` and per-route `@RequirePermission`. Row-level visibility is
enforced in the services: `HrService.resolveEmployeeScope` turns the caller's grants for a
permission into an Employee-row `where` clause via `hrEmployeeScopeFilter` (see `hr-scope.ts`):

- `GLOBAL` → unrestricted (HR role holds `hr.manage` global)
- `CAMPUS` / `DEPARTMENT` / `PROGRAM` → filtered on the Employee's own `campusId`/`departmentId`
  (PROGRAM grants are resolved UP to their department, the org-module convention)
- `OWN` → only the caller's own employee row (FACULTY role holds `hr.view` OWN)

Child tables (leave, workload, reviews, payroll lines) scope through the `employee:` relation.
Payroll lifecycle steps (`process/approve/pay/cancel`) additionally require a GLOBAL `hr.manage`
grant (`HrService.assertGlobal`).

## Design notes

- `Employee.userId` is a unique 1:1 link to a platform `User` (faculty login). Employee documents
  and payslips use the shared StorageService signed-URL upload flow (`fileKey` under
  `tenants/<tenantId>/hr-*`).
- Recording an exit deactivates the employee master row (`exitDate` + `employmentStatus`) instead
  of deleting it; archiving soft-deletes via `deletedAt` (restorable).
- Approving a paid, bounded leave decrements the applicant's `LeaveBalance` ledger for the
  application's year (opening + credited - availed - adjusted = closing).
- Faculty self-service (`hr.view` OWN) can apply for/cancel their own leave and view their own
  paid payslips (`GET /hr/payslips/mine`).
- Faculty timetable and attendance are NOT duplicated here — they read the existing
  `TimetableEntry.assignedUserId` and `FacultyAttendance.userId` rows via the employee's `userId`.
- Overview (`GET /hr/reports/overview`) is hosted here rather than in the reports placeholder
  module.

## Routes

Employees, designations, joinings/exits, documents, workloads, leave, performance reviews, salary
structures and payroll runs — see `hr.controller.ts` for the full surface and permissions.