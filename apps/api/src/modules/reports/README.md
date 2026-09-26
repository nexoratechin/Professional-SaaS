# Reports module

Reusable, tenant-scoped reporting engine. Predefined operational definitions and the query/export
engine live in `packages/reporting` (`@college-erp/reporting`) and are shared by this API module and
the worker's `report-exports` queue.

- `GET /reports` — permission-filtered catalog (10 operational reports across admissions, students,
  attendance, fees, exams, placements, library, hostel, transport, inventory).
- `GET /reports/options` — report-scope-filtered campus/department/program/section/year/term choices.
- `POST /reports/preview` — synchronous, paginated, scope- and source-permission-enforced preview.
- `POST /reports/exports` — enqueue a CSV/Excel/PDF run (`report-exports` queue); run history and
  signed downloads are exposed under `/reports/runs`.
- `GET/POST/PATCH/DELETE /reports/saved` — private-per-owner saved filter sets.
- `GET/POST/PATCH/DELETE /reports/templates` — reusable column selections (mutations require `reports.manage`).
- `GET/POST/PATCH/DELETE /reports/schedules` — recurring exports (mutations require `reports.manage`).

Access requires `reports.view` plus the report's source-domain `*.view` permission; the two scope
grants are intersected so neither can broaden the other. Exports require `reports.export`; templates
and schedules require `reports.manage`. Scope is snapshotted on runs/schedules and re-validated by
the worker before execution. Specialized admission/fee/placement report screens are linked from the
catalog rather than duplicated.
