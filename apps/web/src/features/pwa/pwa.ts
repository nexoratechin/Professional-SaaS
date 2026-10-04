import { registerSW } from 'virtual:pwa-register';
import { apiFetch } from '../../lib/http';

/** Workbox runtime cache for the safe allowlist of per-user API reads (see vite.config.ts). */
export const API_READ_CACHE = 'college-erp-api-reads';

export interface ServiceWorkerEvents {
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
  onRegistered?: (registration: ServiceWorkerRegistration | undefined) => void;
  onError?: (error: unknown) => void;
}

let updateServiceWorker: ((reloadPage?: boolean) => Promise<void>) | null = null;

/** Registers the generated service worker and wires its lifecycle callbacks. Idempotent. */
export function initServiceWorker(events: ServiceWorkerEvents = {}): void {
  if (updateServiceWorker) return;
  updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh: events.onNeedRefresh,
    onOfflineReady: events.onOfflineReady,
    onRegisteredSW: (_url, registration) => events.onRegistered?.(registration),
    onRegisterError: (error) => events.onError?.(error),
  });
}

export function applyServiceWorkerUpdate(): void {
  void updateServiceWorker?.(true);
}

/** True when the browser can show installability/notification UI. */
export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

async function activeRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

export async function getExistingPushSubscription(): Promise<PushSubscription | null> {
  const registration = await activeRegistration();
  if (!registration) return null;
  try {
    return await registration.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/** VAPID keys arrive base64url; PushManager wants a Uint8Array backed by a real ArrayBuffer. */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const output = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

/** Requests permission (if needed), subscribes this browser, and registers it with the API. */
export async function enablePush(vapidPublicKey: string): Promise<void> {
  if (!isPushSupported()) throw new Error('Push notifications are not supported on this device.');
  if (Notification.permission === 'denied') {
    throw new Error('Notifications are blocked. Enable them in your browser/site settings and try again.');
  }
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted.');

  const registration = await activeRegistration();
  if (!registration) throw new Error('The app service worker is not ready yet. Reload and try again.');

  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    }));

  await apiFetch('/push/subscribe', {
    method: 'POST',
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  });
}

/** Removes the server-side device row first, then drops the browser subscription. */
export async function disablePush(): Promise<void> {
  const registration = await activeRegistration();
  const subscription = registration ? await registration.pushManager.getSubscription() : null;
  if (!subscription) return;
  await apiFetch('/push/unsubscribe', {
    method: 'POST',
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  }).catch(() => undefined);
  await subscription.unsubscribe().catch(() => undefined);
}

/**
 * Purges all caches the PWA owns. Called on logout/tenant change so a shared device never serves
 * one user's cached self-service reads to the next — the allowlist is small, but it is per-user.
 */
export async function clearOfflineData(): Promise<void> {
  if (typeof caches === 'undefined') return;
  const names = await caches.keys();
  await Promise.all(
    names
      .filter((name) => name.startsWith('college-erp-'))
      .map((name) => caches.delete(name)),
  );
}

export interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}
