# Production observability

Structured logs, metrics, health probes, error tracking and alerting for the API and the worker.
Implemented by `@college-erp/observability` (a dependency-free shared package) with thin per-app
wiring — no new infrastructure services: everything rides on PostgreSQL, Redis and the existing
containers.

```
                 ┌────────────────────────── api (:3000) ─────────────────────────┐
  Prometheus ──▶ │ /metrics            Prometheus text registry                  │
  LB/K8s     ──▶ │ /health/live        liveness (no dependency I/O)              │
                 │ /health/ready       db+redis critical, storage+workers degrade│
                 │ alert engine (60s)  rules → SystemAlert rows → webhook        │
                 └───────────────────────────────────────────────────────────────┘
                        ▲ reads obs:win:* counters + obs:worker:heartbeat:*
                        │                 ▲
                 ┌──────┴─────────────────┴──────── worker (:3100) ──────────────┐
  Prometheus ──▶ │ /metrics           same registry, worker-side series         │
  Docker     ──▶ │ /health/live,ready Redis heartbeat + db/redis probes         │
                 │ queue-events bridge → metrics, queue_failures window, errors │
                 └──────────────────────────────────────────────────────────────┘
```

## 1. Structured logs + request IDs

- `StructuredLogger` (`packages/observability/src/logging/logger.ts`) writes one JSON object per
  line (`LOG_FORMAT=json`, production default) or compact text (dev default). Every record carries
  `level`, `time`, `service`, `version`, `environment`, `message` and any structured fields
  (`requestId`, `tenantId`, `tenantSlug`, `userId`, `jobId`, `queue`, `durationMs`, `error`).
- `warn`/`error` go to **stderr**; `info`/`debug` to **stdout** (split streams per container).
- The API and worker call `configureObservability()` before boot, then `app.useLogger()` routes
  every Nest internal log through the same pipeline — no `console.log` remains in either app.
- Request correlation already existed: `RequestIdMiddleware` reuses/creates `X-Request-Id`, echoes
  it on the response, and the exception envelope carries it. The same id appears in every log line
  and tracked error for that request.

## 2. Metrics (`/metrics`, Prometheus text v0.0.4)

Scrape targets: `api:3000/metrics` and `worker:3100/metrics`. Each process exposes its in-process
registry (this is the standard multi-process model — scrape every replica). Protect with
`METRICS_TOKEN` (`Authorization: Bearer <token>` or `X-Metrics-Token`) and/or an ingress rule;
`METRICS_ENABLED=false` disables the endpoint entirely.

| Metric | Type | Labels | Tracks |
|---|---|---|---|
| `college_erp_http_requests_total` | counter | method, route, status | API traffic |
| `college_erp_http_request_duration_seconds` | histogram | method, route, status_class | API latency |
| `college_erp_http_errors_total` | counter | status, route | API errors (4xx/5xx) |
| `college_erp_tenant_http_requests_total` | counter | tenant | Per-tenant traffic (**opt-in**: `METRICS_INCLUDE_TENANT_LABELS=true`) |
| `college_erp_db_query_duration_seconds` | histogram | model, operation | Database performance |
| `college_erp_db_queries_total` | counter | model, operation, result | DB errors |
| `college_erp_db_slow_queries_total` | counter | model, operation | Queries > `SLOW_QUERY_MS` |
| `college_erp_redis_up` / `_redis_events_total` / `_redis_ping_duration_seconds` | gauge/counter/histogram | – / type / result | Redis health |
| `college_erp_queue_jobs` / `_queue_backlog` | gauge | queue, state / queue | Queue depth |
| `college_erp_queue_jobs_processed_total` | counter | queue, result | Queue failures/completions |
| `college_erp_queue_job_duration_seconds` | histogram | queue | Job latency |
| `college_erp_queue_dead_letters_total` / `_queue_dead_letter_backlog` | counter / gauge | queue / – | DLQ |
| `college_erp_worker_heartbeat_timestamp_seconds`, `_worker_up`, `_workers_online`, `_workers_expected` | gauge | worker / – | Worker health |
| `college_erp_payments_total`, `_payment_failures_total` | counter | gateway,status / gateway,stage | Payment failures |
| `college_erp_notifications_total`, `_notification_failures_total` | counter | channel,outcome / channel,provider,terminal | Notification failures |
| `college_erp_storage_operations_total`, `_storage_operation_duration_seconds` | counter/histogram | operation,result / operation | Storage failures |
| `college_erp_auth_events_total` | counter | surface, result, reason | Authentication failures |
| `college_erp_usage_events_total`, `_usage_units_total` | counter | event_type | Tenant usage (metered) |
| `college_erp_errors_tracked_total` | counter | source, name | Error tracking |
| `college_erp_alerts_fired_total`, `_alerts_active` | counter/gauge | rule,severity / severity | Alerting |
| `college_erp_health_status`, `_health_check_duration_seconds` | gauge/histogram | check | System health |
| `college_erp_process_*`, `_event_loop_lag_seconds` | gauge | – | Runtime |
| `college_erp_build_info` | gauge | service, version, environment | Deploy identity |

Routes are normalized (`/students/:id`, never raw ids) to bound cardinality.

## 3. Health endpoints

| Endpoint | Purpose | Behavior |
|---|---|---|
| `GET /health` (API) | liveness + build info; backwards compatible | always 200 while the process runs; **no dependency I/O** |
| `GET /health/live` (API) | Kubernetes liveness | same as above |
| `GET /health/ready` (API) | traffic readiness | probes database + Redis (**critical** → 503), storage + worker fleet (**degrade** → 200 `degraded`) |
| `GET /health` / `/health/live` (worker, :3100) | liveness | 200 + `workerId` |
| `GET /health/ready` (worker, :3100) | worker readiness | db + redis probes, 503 when either is down |

Every probe is timeout-bounded (`HEALTH_CHECK_TIMEOUT_MS`) and recorded into
`college_erp_health_status` / `_health_check_duration_seconds`. Liveness never touches
dependencies on purpose: a database outage must not cause a restart storm.

Docker Compose now healthchecks both containers (`/health/live`), and the worker exposes `:3100`.

## 4. Error tracking

- Source: API `HttpExceptionFilter` (every 5xx, plus `unhandledRejection`/`uncaughtException` from
  `main.ts`) and worker (dead-letter moves, queue-event failures, process-level crashes).
- Dedupe: stable fingerprint = error name + normalized message + throw-site frame. The same bug is
  emitted to sinks **once per `dedupeMs` (60s)**; every occurrence still increments metrics and
  Redis windows.
- Sinks: structured log (always), `ERROR_TRACKING_WEBHOOK_URL` (Slack-compatible JSON), and the
  `system_error_events` ledger (one row per fingerprint with `count`, first/last seen) unless
  `ERROR_TRACKING_PERSIST=false`. Persistence is best-effort and never recurses.
- Operator views: `GET /platform/system/errors` (platform auth) and the observability overview.

## 5. Alerting

The API's `AlertingService` evaluates every rule from `packages/observability/src/alerts/rules.ts`
every `ALERT_EVAL_INTERVAL_MS` (60s). Signals come from health probes, queue gauges and Redis
time-window counters (`obs:win:*`), because payment/notification/storage/queue failures happen in
the worker process while evaluation happens in the API.

Lifecycle: firing evaluations upsert one open `system_alerts` row per (rule, scope); the first
replica to claim a Redis `SET NX` dispatches to `ALERT_WEBHOOK_URL` (repeat pages suppressed per
rule+scope for `ALERT_DEDUPE_MINUTES`); conditions that clear auto-resolve the row and clear the
dedupe key.

| Rule | Severity | Condition (defaults) |
|---|---|---|
| `dependency_database_down` | CRITICAL | db probe failing |
| `dependency_redis_down` | CRITICAL | Redis PING failing |
| `dependency_storage_down` | WARNING | S3/MinIO bucket probe failing |
| `dependency_latency_high` | WARNING | db ≥ 1000ms or Redis ≥ 250ms |
| `worker_offline` | CRITICAL / WARNING | 0 (or fewer than `WORKER_EXPECTED_REPLICAS`) heartbeat keys |
| `api_error_rate_high` | CRITICAL ≥5% / WARNING ≥2% | 5xx ratio over 15 min, min 50 requests |
| `queue_backlog_high` | WARNING | any queue backlog ≥ 1000 |
| `queue_failures_spike` | WARNING | ≥ 20 job failures / 15 min |
| `dead_letter_backlog` | WARNING | DLQ non-empty or any job moved / 15 min |
| `payment_failures_spike` | WARNING | ≥ 5 failures / 60 min |
| `notification_failures_spike` | WARNING | ≥ 20 terminal failures / 60 min |
| `storage_failures_spike` | WARNING | ≥ 5 failures / 60 min |
| `auth_failures_spike` | WARNING | ≥ 30 failed logins / 15 min |
| `suspicious_logins` | WARNING | ≥ 3 blocked suspicious logins / 15 min |
| `tracked_errors_spike` | WARNING | ≥ 10 tracked errors / 15 min |

Thresholds live in `ALERT_THRESHOLDS` (one source of truth) and are unit-tested in
`rules.spec.ts`. Operator endpoints (platform auth):

- `GET  /platform/system/observability` — health + queues + alerts + recent errors (one payload)
- `GET  /platform/system/alerts?status=&severity=`
- `POST /platform/system/alerts/:id/acknowledge` · `POST /platform/system/alerts/:id/resolve`
- `POST /platform/system/alerts/evaluate` — run one evaluation pass now

## 6. Environment variables

| Variable | Default | Notes |
|---|---|---|
| `LOG_FORMAT` | `json` in production, `text` elsewhere | |
| `METRICS_ENABLED` | `true` | set `false` to 404 `/metrics` |
| `METRICS_TOKEN` | unset (open) | **set in production** |
| `METRICS_INCLUDE_TENANT_LABELS` | `false` | per-tenant request counter (cardinality!) |
| `SLOW_QUERY_MS` | `500` | slow-query warning threshold |
| `HEALTH_CHECK_TIMEOUT_MS` | `3000` | per probe |
| `ALERTING_ENABLED` | `true` | evaluation loop |
| `ALERT_EVAL_INTERVAL_MS` | `60000` | |
| `ALERT_WEBHOOK_URL` | unset | Slack-compatible JSON |
| `ALERT_DEDUPE_MINUTES` | `15` | per rule+scope |
| `WORKER_EXPECTED_REPLICAS` | `1` | `0` disables the worker alert |
| `ERROR_TRACKING_ENABLED` | `true` | |
| `ERROR_TRACKING_WEBHOOK_URL` | unset | |
| `ERROR_TRACKING_PERSIST` | `true` | `system_error_events` ledger |
| `WORKER_HEALTH_ENABLED` / `WORKER_HEALTH_PORT` | `true` / `3100` | worker HTTP surface |
| `WORKER_HEARTBEAT_INTERVAL_MS` / `WORKER_HEARTBEAT_TTL_SECONDS` | `15000` / `45` | must both match the API's expectation |

## 7. Wiring a monitoring stack (example)

```yaml
# prometheus.yml (fragment)
scrape_configs:
  - job_name: college-erp-api
    metrics_path: /metrics
    authorization: { credentials: ${METRICS_TOKEN} }
    static_configs: [{ targets: ['api:3000'] }]
  - job_name: college-erp-worker
    metrics_path: /metrics
    authorization: { credentials: ${METRICS_TOKEN} }
    static_configs: [{ targets: ['worker:3100'] }]
```

Suggested first alerts on top of the exported series (belt-and-braces to the built-in engine):
`up == 0` per job, `rate(college_erp_http_request_duration_seconds_sum[5m]) /
rate(college_erp_http_request_duration_seconds_count[5m]) > 1`,
`college_erp_queue_dead_letter_backlog > 0`.

## 8. Runbook cheat-sheet

| Symptom | First look |
|---|---|
| API 5xx spike | `GET /platform/system/errors`, filter logs by `requestId`, `college_erp_db_slow_queries_total` |
| Slow requests | `college_erp_http_request_duration_seconds` by route, `college_erp_db_query_duration_seconds` by model |
| Async work stuck | `GET /platform/jobs/queues`, `college_erp_workers_online`, worker `/health/ready` |
| DLQ growing | `GET /platform/jobs?status=DEAD_LETTERED`, alert details, replay from queue |
| Payments failing | `college_erp_payment_failures_total{stage}`, `GET /platform/jobs?queue=payment-reconciliation` |
| Notifications not leaving | `college_erp_notification_failures_total{terminal}`, provider config, delivery logs |
| Redis degraded | `college_erp_redis_up`, `_redis_events_total`, `_redis_ping_duration_seconds` |
| Storage errors | `college_erp_storage_operations_total{result="error"}`, bucket probe in `/health/ready` |
| Possible credential stuffing | `college_erp_auth_events_total{result="failure"}`, `suspicious_logins` alert, `LoginEvent` rows |

## 9. Database additions

Migration `20261016000000_add_observability` adds:

- `system_alerts` (+ `AlertSeverity`, `AlertStatus` enums) — alert lifecycle/history.
- `system_error_events` — deduplicated error ledger (unique `fingerprint`, occurrence `count`).

Both are control-plane tables (no tenant scope), written through the platform Prisma client only.
