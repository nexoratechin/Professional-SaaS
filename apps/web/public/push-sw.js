/* Native Web Push handlers, imported into the Workbox-generated service worker via
 * `workbox.importScripts` (see vite.config.ts). Workbox owns precaching/runtime caching; this
 * file only adds the push lifecycle listeners, which generateSW does not emit. */

self.addEventListener('push', (event) => {
  let payload = { title: 'College ERP', body: 'You have a new notification.', url: '/notifications' };
  try {
    if (event.data) {
      const parsed = event.data.json();
      payload = {
        title: parsed.title || payload.title,
        body: parsed.body || payload.body,
        url: parsed.url || payload.url,
        tag: parsed.tag,
      };
    }
  } catch {
    if (event.data) payload.body = event.data.text();
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/pwa-192x192.png',
      badge: '/favicon-32x32.png',
      tag: payload.tag || 'college-erp',
      data: { url: payload.url },
      renotify: false,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/notifications';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
      return undefined;
    }),
  );
});
