# Timetable module

Weekly timetables per tenant, term, and campus with a configurable day × period grid, conflict-free
manual entries, greedy generation from active course offerings, a conflict recheck sweep, holidays,
faculty availability blocks, date-specific substitutions, and an audit log.

Feature flag: `timetable`. Scope grants decide visibility:

- GLOBAL — see every timetable in the tenant.
- CAMPUS / DEPARTMENT / PROGRAM — resolved up to the caller's campus ids.
- OWN — published timetables only, and only entries where the caller is the assigned faculty or a
  student member of the scheduled section.

## Conventions

- Lists return `{ data, total }` (like the organization module).
- Entry cells have **no** database-level uniqueness constraint; a hard service gate runs on every
  manual entry and generation, and rejected (or drifting) placements are recorded as
  `TimetableConflict` rows with `source: 'write' | 'sweep' | 'substitution'`.
- `workingDays` is stored as a JSON array (0 = Sunday) on the timetable; `normalizeDays` defaults
  to `[1,2,3,4,5]`.
- Availability blocks and substitutions use the entry's weekday + period times, matching by name
  rather than a fixed offset.

## Routes

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/timetable/lookups` | TIMETABLE_VIEW |
| GET/POST | `/timetable/availability` | VIEW / CREATE |
| PATCH/DELETE | `/timetable/availability/:blockId` | UPDATE |
| GET/POST | `/timetable` | VIEW / CREATE |
| GET/PATCH | `/timetable/:id` | VIEW / UPDATE |
| POST | `/timetable/:id/generate` | MANAGE |
| POST | `/timetable/:id/publish` | PUBLISH |
| POST | `/timetable/:id/archive` | UPDATE |
| GET/PUT | `/timetable/:id/periods` | VIEW / UPDATE |
| GET/POST | `/timetable/:id/entries` | VIEW / CREATE |
| PATCH/DELETE | `/timetable/:id/entries/:entryId` | UPDATE |
| GET/POST | `/timetable/:id/holidays` | VIEW / CREATE |
| DELETE | `/timetable/:id/holidays/:holidayId` | UPDATE |
| GET | `/timetable/:id/conflicts` | VIEW |
| POST | `/timetable/:id/conflicts/recheck` | MANAGE |
| GET | `/timetable/:id/history` | VIEW |
| GET | `/timetable/:id/availability` | VIEW |
| GET/POST | `/timetable/:id/substitutions` | VIEW / CREATE |
| PATCH | `/timetable/:id/substitutions/:subId` | UPDATE |

## Mutability

- Headers, periods, entries, and holidays are editable while the timetable is `DRAFT` or
  `GENERATED`; editing and re-generation are blocked once `PUBLISHED` / `ARCHIVED`.
- Substitutions are available on `GENERATED` and `PUBLISHED` timetables (per date).
- Replacing the period grid deletes all existing entries first (period rows are FK-restricted).