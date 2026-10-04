import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Production-ready PWA build for the student/faculty experience.
 *
 *  • Precaches the app shell + static assets so the SPA boots instantly and offline.
 *  • Adds a narrow, per-user NetworkFirst runtime cache for a safe allowlist of read-only
 *    self-service GETs, so those pages stay usable on a flaky connection. The cache is named
 *    separately (`college-erp-api-reads`) and is purged on logout by the app (see
 *    src/features/pwa/pwa.ts) — never a shared/global data cache.
 *  • Imports `push-sw.js` (from public/) into the generated worker for Web Push handling.
 */
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      // Registration is wired manually through virtual:pwa-register (see main.tsx) so the app can
      // surface an in-app "update available" affordance instead of silently reloading.
      injectRegister: null,
      includeAssets: ['favicon.svg', 'favicon-32x32.png', 'apple-touch-icon.png', 'offline.html'],
      manifest: {
        name: 'College ERP',
        short_name: 'College ERP',
        description: 'College ERP student, faculty and campus self-service — attendance, results, fees and digital ID.',
        theme_color: '#1e293b',
        background_color: '#f8fafc',
        display: 'standalone',
        orientation: 'portrait-primary',
        scope: '/',
        start_url: '/',
        categories: ['education', 'productivity'],
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Student dashboard', url: '/portal/dashboard' },
          { name: 'Attendance', url: '/portal/attendance' },
          { name: 'Faculty attendance', url: '/faculty/attendance' },
          { name: 'Notices', url: '/portal/notices' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2}'],
        // SPA shell for offline navigations; the denylist keeps API-ish paths out of the shell.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/push\//, /^\/sw\.js$/, /^\/push-sw\.js$/],
        importScripts: ['push-sw.js'],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: false,
        runtimeCaching: [
          {
            // Only GETs for the caller's own, read-only portal views. These are NetworkFirst, so
            // a fresh response always wins; the cache is the offline fallback, not the source.
            urlPattern: ({ url, request }) =>
              request.method === 'GET' &&
              /^\/student-portal\/(dashboard|id-card|attendance|timetable|courses|notices|fees|exams|results)$/.test(
                url.pathname,
              ),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'college-erp-api-reads',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url, request }) =>
              request.method === 'GET' &&
              /^\/faculty-portal\/(dashboard|courses|timetable|attendance\/sessions|marks)$/.test(url.pathname),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'college-erp-api-reads',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Same-origin static media (icons, uploaded images proxied through the app origin).
            urlPattern: ({ request, sameOrigin }) =>
              sameOrigin && ['style', 'script', 'worker', 'image', 'font'].includes(request.destination),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'college-erp-assets', expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 30 } },
          },
        ],
      },
      devOptions: {
        // Keep the worker out of the way of Vite HMR during development; `vite build` + preview is
        // how the PWA (manifest/SW/offline/push) is verified.
        enabled: false,
      },
    }),
  ],
  server: {
    port: 5173,
    host: true,
  },
});
