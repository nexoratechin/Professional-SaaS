# Notifications

Tenant-aware, multi-channel notification infrastructure built on Redis/BullMQ. One `Notification`
row is created per recipient×channel at enqueue time with the FINAL rendered subject/body; the
worker (`apps/worker`'s `NotificationsProcessor`) re-fetches the row through a tenant-scoped client
and delivers it. Delivery attempts are recorded in `NotificationDeliveryLog`, retries/backoff are
BullMQ job attempts, and tenant sender configuration lives in `NotificationProviderConfig`
(credentials encrypted at rest with `NOTIFICATION_SECRET_KEY` via `@college-erp/notifications`).

## Channels & providers

- **EMAIL** — `smtp` (stdlib net/tls — no nodemailer) or `console`
- **SMS / WHATSAPP / PUSH** — generic `http` gateway (POST a JSON body/template) or `console`
- **IN_APP** — in-app inbox rows (owner can mark read)

## Features

- Direct send (`POST /notifications`) with optional `scheduledAt` (BullMQ delay)
- System sends — `sendSystem(tenantId, input)` keeps the pre-existing minimal-module signature
  (13 modules call it unchanged)
- Event-triggered notifications — `triggerEvent(tenantId, eventKey, input)` fans out to every
  ACTIVE `NotificationEventTrigger` for the key, rendering its template per channel
- Templates with `{{variable}}` interpolation, rendered at enqueue time
- Campaigns — audience filter resolved by `@college-erp/notifications` `resolveAudience` at launch
  (ALL / ROLES / DEPARTMENTS / CAMPUSES / BATCHES / STUDENTS / USERS); the worker fans each
  recipient out into one Notification + one deliver job; launch can be scheduled
- Delivery statuses: PENDING → QUEUED → SENT / SUPPRESSED (user opt-out or missing active
  provider beyond dev's console fallback) / FAILED (terminal — 4xx/missing config); transient
  errors (network, 5xx, SMTP 4xx) throw so BullMQ retries
- Per-user per-channel preferences (`NotificationPreference`); `SUPPRESSED` is terminal + audited
- Delivery logs: append-only per-attempt rows (provider, request/response snapshot, latency,
  error) — retries show as successive attempts
- Push device registry (`UserPushDevice`) for PUSH-channel delivery

## Permissions

`notifications.read`, `notifications.send`, `notifications.templates.manage`,
`notifications.campaigns.manage`, `notifications.triggers.manage`, `notifications.config.manage`
(all granted to REGISTRAR; TENANT_ADMIN receives them only at provisioning time).

## Frontend

`apps/web`'s `/notifications` page (gated by `notifications.read`) has Inbox / Summary /
Preferences tabs plus Templates / Campaigns / Event triggers / Providers admin tabs.