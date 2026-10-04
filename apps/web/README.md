# @college-erp/web — PWA notes

The React/Vite frontend is an installable PWA for the student, parent and faculty experiences.
All business logic lives in the API; the PWA only renders and caches.

## What the PWA adds

| Capability | Implementation |
| --- | --- |
| Installable app | `vite-plugin-pwa` generates `manifest.webmanifest` + maskable/regular icons from `public/`. |
| App shell + offline navigation | Workbox precache of the Vite build, `navigateFallback: /index.html`. |
| Offline-friendly pages | A narrow `NetworkFirst` runtime cache (`college-erp-api-reads`) for the caller's own read-only portal/faculty GETs. Purged on logout by `features/pwa/pwa.ts#clearOfflineData`. |
| Cached static assets | Workbox precache + `StaleWhileRevalidate` for same-origin media. |
| Push notifications | Browser `PushSubscription` registered via `POST /push/subscribe`; the worker delivers PUSH notifications with native Web Push (VAPID). `public/push-sw.js` handles `push`/`notificationclick`. |
| Mobile navigation | `MobileTabBar` (portal/faculty) + the existing responsive top nav. |
| QR attendance | Faculty show a signed session check-in QR; students scan it in the portal (`features/pwa/qr-scanner.tsx`) and `POST /student-portal/attendance/check-in`. |
| Digital ID | `/portal/id-card` renders the student's QR (opaque per-student token); public verification lives at `/verify/student-id`. |
| Secure auth | Access token stays in memory; refresh token stays in the httpOnly cookie (unchanged). Offline caches are purged on logout. API responses are never cached by the service worker outside the documented allowlist. |

## Regenerating icons

```bash
node scripts/generate-icons.mjs
```

## Verifying the PWA locally

```bash
pnpm --filter @college-erp/web build
pnpm --filter @college-erp/web exec vite preview
```

The service worker is intentionally disabled in `vite dev` (HMR); use the build+preview path.

## Push setup

Generate a keypair once per environment and set the same values on the API and worker:

```bash
npx web-push generate-vapid-keys
# VAPID_PUBLIC_KEY=...
# VAPID_PRIVATE_KEY=...
# VAPID_SUBJECT=mailto:admin@example.com
```

Without keys, `GET /push/config` reports `enabled: false` and the in-app push toggle stays hidden.

## Production image

```bash
docker compose --profile prod up --build web-prod   # http://localhost:8080
```

Set `CORS_ORIGIN=http://localhost:8080` and build with `WEB_PROD_API_URL=https://api.example.com`
for a real deployment.
