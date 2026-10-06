# Integrations

Vendor-neutral connection framework for every external system the ERP talks to: payment gateways,
accounting, LMS, biometric devices, RFID, identity providers, document services, SMS, WhatsApp and
email.

Feature flag: `integrations`. Permissions: `integrations.view`, `integrations.manage` (both already
present in `@college-erp/auth` — this module consumes them, it does not define them).

## Why this is a framework and not a payments module

There is no `StripeClient`, no `razorpay` enum and no `if (provider === 'stripe')` anywhere. A
connection is a **row**, and the provider is a **string** that the adapter registry resolves:

| concern | where it lives | adding a vendor means |
| --- | --- | --- |
| what the system *is* | `Integration.category` (`PAYMENT_GATEWAY`, `BIOMETRIC`, …) | nothing |
| who speaks to it | `Integration.provider` → `IntegrationAdapterRegistry` | a config row, or one new adapter class |
| how it authenticates | `Integration.config.authStyle` + encrypted `credentials` | a config row |
| what it can do | `IntegrationAdapter` optional capabilities | nothing |
| how failures are retried | `Integration.retryPolicy` → `resolveRetryPolicy()` | a config row |

So the common case — a JSON-over-HTTP vendor — is onboarded by filling in a form, and the uncommon
case is one class implementing `IntegrationAdapter`. This mirrors `DeviceAdapterRegistry` in the
attendance module and `PROVIDERS_BY_CHANNEL` in `@college-erp/notifications`, so the pattern is
already familiar in this codebase.

## Layout

```
packages/integrations/         framework-free core (no Nest, no Prisma, no network deps)
  categories.ts                category → capability map, config-field specs, config validation
  registry.ts                  provider key → adapter instance, capability detection
  cipher.ts                    AES-256-GCM credential bag (INTEGRATION_SECRET_KEY)
  retry.ts                     failure classification + clamped retry policy + backoff
  signature.ts                 inbound webhook HMAC verification / signing
  redact.ts                    redaction + truncation for anything written to a log column
  sync.ts                      change detection, run-status derivation, cursor policy
  executor.ts                  the ONE outbound-call engine, shared by API and worker
  adapters/                    http_json (generic REST), webhook (inbound-only), mock (tests)

apps/api/src/modules/integrations/
  integrations.controller.ts       admin routes (all require integrations.view/manage)
  integration-webhooks.controller.ts   PUBLIC inbound endpoint — no JWT, no tenant middleware
  integrations.service.ts          CRUD, endpoints, log reads, connection test, cipher
  integrations-dispatch.service.ts  create + enqueue outbound operations
  integrations-sync.service.ts      create/cancel sync runs (execution lives in the worker)

apps/worker/src/queues/integrations/
  integration-operations.processor.ts  runs executeIntegrationOperation per job
  integration-sync.processor.ts        the run loop (pull pages / push records)
  integration-scheduler.service.ts     periodic cross-tenant sweep for scheduled syncs
```

## Data model

Seven tables, all tenant-scoped (`tenantId` is required on every one, which is what lets the
DMMF-derived tenant guard auto-scope them):

- **`integration`** — the connection: key, category, provider, config (JSONB), `credentials_encrypted`,
  retry policy, status, health, last-success/failure, `sync_cursor`, `is_default`.
- **`integration_webhook_endpoint`** — one inbound URL per provider concern, with a per-endpoint
  signing secret (encrypted), algorithm, header name and replay tolerance.
- **`integration_webhook_event`** — every inbound delivery: payload (redacted), signature verdict,
  external event id, processing status.
- **`integration_operation`** — every outbound attempt: operation name, status, attempt counter,
  `idempotency_key`, redacted request/response, latency, classified failure.
- **`integration_sync_run`** — one sync run: direction, status, counters, cursor before/after,
  `has_more`.
- **`integration_sync_record`** — the per-entity ledger row (`@@unique([integrationId, entityType,
  externalId])`) holding the content hash, status, last-known payload and ERP-side id.
- **`integration_failure`** — the cross-cutting failure log, optionally linked to the operation, webhook
  event or sync run that produced it. Those three links are `ON DELETE SET NULL` so deleting an
  operation does not erase the evidence of why it failed.

Migration: `packages/database/prisma/migrations/20261009000000_add_generic_integration_framework/`.

## Outbound flow

1. `POST /integrations/:id/dispatch` → `IntegrationsDispatchService.dispatch()`.
2. Deduplicated on `idempotencyKey` (`@@unique([integrationId, idempotencyKey])`) — a duplicate returns
   the **original** operation, so a client retry after a lost response never double-charges.
3. The row is written `PENDING` (request body already redacted) and a BullMQ job is enqueued. The row
   is the durable record; the queue is only the transport.
4. `executeIntegrationOperation()` — in `@college-erp/integrations`, run by the worker for queued
   dispatches and by the API only for `synchronous: true`. **One implementation, not two.**
5. On failure: classify → write `integration_failure` → if retryable and attempts remain, re-enqueue
   with the computed backoff delay.

`attempts: 1` on the BullMQ job is deliberate: attempt accounting is the engine's job, so letting
BullMQ also retry would double-count attempts and could re-send a request that failed permanently
(a wrong API key).

## Inbound flow

`POST /integrations/webhooks/:pathToken` is deliberately outside the tenant middleware (the caller is
a provider, not a logged-in user):

1. Resolve the endpoint by `pathToken` through the **platform** client.
2. Verify the signature against the **raw** body — `apps/api/src/main.ts` installs an Express
   `json({ verify })` hook that keeps `req.rawBody` before Nest's parser runs.
3. De-duplicate on `@@unique([webhookEndpointId, externalEventId])`. A replay returns the original
   event's response instead of reprocessing it.
4. Verify, record, then hand off to `resolved.webhook?.handleWebhook`. A failure is recorded with
   `signatureVerified: false` and the delivery is rejected.

## Sync flow

Runs are created by the API (so an operator sees "requested" immediately, even with no worker up) and
executed only by the worker. That is one implementation of the run loop, so a sync cannot behave
differently depending on who started it.

The loop re-reads the run status before every page, which is what makes cancel take effect within one
page instead of after the run finishes. Change detection is a content hash per
`(integrationId, entityType, externalId)`; a matching hash is recorded as `SKIPPED` without rewriting
the row.

## Secrets

`INTEGRATION_SECRET_KEY` (64 hex chars) encrypts credential bags and webhook signing secrets with
AES-256-GCM. It is **deliberately not** `NOTIFICATION_SECRET_KEY`: one leaked key must never decrypt
another class of secret, so a tenant's payment-gateway key cannot be used to read every notification
password. Both API and worker need the same value — the worker decrypts what the API encrypted.

Credentials are write-only. No endpoint returns a decrypted value: reads return the credential **key
names**, and a webhook signing secret is shown exactly once at creation/rotation.

## Failure log

Every failed attempt — outbound, inbound or sync — lands in `integration_failure` with a category,
`retryable`, provider code and redacted details. `GET /integrations/failures` filters by category,
integration and open/resolved; `POST /integrations/failures/:id/resolve` triages one. This is the
diagnostic surface: a 401 says "your credentials expired" instead of "it retried and failed".

## What is deliberately NOT here

- No provider SDK dependency. `http_json` uses stdlib `fetch`.
- No request DSL. `{{placeholder}}` interpolation in a human-reviewable string is enough for the long
  tail, and anything more expressive would still not cover vendor-specific signing.
- No UI-only feature: every action above is backed by a route, a table and business logic.