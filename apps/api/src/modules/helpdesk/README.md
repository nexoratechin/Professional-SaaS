# Helpdesk / Feedback

The institution's own service desk: students, staff, and parents raise tickets against internal
routing units (IT, Maintenance, Accounts, Library, Hostel, …). This is distinct from the platform
control-plane `SupportTicket` model (`apps/api/src/modules/support`), which is a tenant raising a
ticket *to* the SaaS platform.

## Capabilities

- **Departments** — helpdesk routing units (`HelpdeskDepartment`), deliberately separate from the
  academic `Department` model (IT/Facilities have no academic counterpart).
- **Categories** — nested ticket categories with routing defaults (priority, department) and an
  optional pinned SLA policy; `requiresApproval` attaches a workflow-engine approval instance.
- **SLA policies** — response/resolution targets, at-risk threshold, and an escalation role +
  grace period. Resolution precedence: category-pinned policy → (priority + department) exact
  match → priority match → department match → tenant default.
- **Tickets** — numbering series (`HD-<year>-000001`), priority/source, requester (or external
  contact by name/email), assignment, first-response tracking, and due timestamps.
- **Status workflow** — `NEW → OPEN → IN_PROGRESS → PENDING → RESOLVED → CLOSED`, with
  `REOPENED` from `RESOLVED`/`CLOSED` (increments `reopenedCount`, clears resolution, extends the
  resolution due time) and `CANCELLED`. Every change writes an immutable `HelpdeskTicketHistory`
  row.
- **Internal notes** — comments are `PUBLIC` or `INTERNAL`; internal notes never notify the
  requester.
- **Attachments** — tickets/comments link to already-uploaded `Document` rows via the shared
  documents/storage module (`documentId` is a validated plain UUID, so `Document` is untouched).
- **Escalation** — manual escalation (assign to a user and/or an RBAC role) and automatic SLA
  escalation (worker sweep + `POST /helpdesk/sla/sweep`), both recorded in `HelpdeskEscalation`.
- **Feedback / satisfaction** — one response per ticket (1–5 + comment), denormalized onto the
  ticket for fast aggregation.
- **Dashboards & reports** — summary, by-department, by-category, by-agent, created-vs-resolved
  trend, and satisfaction distribution.

## Integrations

- **Notifications** — lifecycle events (created, assigned, comment, status change, resolved,
  reopened, escalated, feedback) fan out through the shared `NotificationsService` (in-app;
  delivered by the worker's notifications queue).
- **Workflow engine** — tickets in approval-requiring categories attach a generic
  `WorkflowInstance` (`entityType = "HelpdeskTicket"`); a default auto-approve definition is
  created on first use if the tenant hasn't configured one. Best-effort: a helpdesk action never
  fails because workflow infrastructure is unavailable.

## Permissions

`helpdesk.view`, `helpdesk.create`, `helpdesk.update`, `helpdesk.delete`, `helpdesk.export`,
`helpdesk.manage` (configuration/SLA sweep). Feature-gated by the `helpdesk` module flag.

## Background processing

`apps/worker` runs `HelpdeskSlaProcessor` on the `helpdesk-sla` queue every 10 minutes, finding
breached open tickets across all tenants and auto-escalating them.
