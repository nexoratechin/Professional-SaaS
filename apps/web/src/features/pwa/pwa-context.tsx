import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyServiceWorkerUpdate,
  clearOfflineData as clearOfflineCaches,
  disablePush,
  enablePush,
  getExistingPushSubscription,
  initServiceWorker,
  isPushSupported,
  type InstallPromptEvent,
} from './pwa';

interface PwaContextValue {
  /** navigator.onLine — drives the offline banner and disabled-network affordances. */
  isOnline: boolean;
  /** An install prompt is available and not yet dismissed this session. */
  canInstall: boolean;
  /** A new service worker is waiting; applyUpdate() activates + reloads. */
  updateAvailable: boolean;
  offlineReady: boolean;
  pushSupported: boolean;
  pushSubscribed: boolean;
  promptInstall: () => Promise<void>;
  dismissInstall: () => void;
  applyUpdate: () => void;
  enablePushNotifications: (vapidPublicKey: string) => Promise<void>;
  disablePushNotifications: () => Promise<void>;
  refreshPushSubscription: () => Promise<void>;
  clearOfflineData: () => Promise<void>;
}

const PwaContext = createContext<PwaContextValue | null>(null);

const INSTALL_DISMISS_KEY = 'college_erp_install_dismissed';

export function PwaProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [installDismissed, setInstallDismissed] = useState(
    () => typeof localStorage !== 'undefined' && localStorage.getItem(INSTALL_DISMISS_KEY) === '1',
  );
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const pushSupported = isPushSupported();
  const dismissedRef = useRef(installDismissed);
  dismissedRef.current = installDismissed;

  // Register the service worker once and react to its lifecycle.
  useEffect(() => {
    initServiceWorker({
      onNeedRefresh: () => setUpdateAvailable(true),
      onOfflineReady: () => setOfflineReady(true),
    });
  }, []);

  // Connectivity + install prompt listeners.
  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      if (dismissedRef.current) return;
      setInstallEvent(event as InstallPromptEvent);
    };
    const onInstalled = () => setInstallEvent(null);

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  // Reflect the current browser push subscription (survives reloads).
  const refreshPushSubscription = useCallback(async () => {
    if (!pushSupported) {
      setPushSubscribed(false);
      return;
    }
    const subscription = await getExistingPushSubscription();
    setPushSubscribed(Boolean(subscription));
  }, [pushSupported]);

  useEffect(() => {
    void refreshPushSubscription();
  }, [refreshPushSubscription]);

  const promptInstall = useCallback(async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    await installEvent.userChoice.catch(() => undefined);
    setInstallEvent(null);
  }, [installEvent]);

  const dismissInstall = useCallback(() => {
    setInstallDismissed(true);
    setInstallEvent(null);
    try {
      localStorage.setItem(INSTALL_DISMISS_KEY, '1');
    } catch {
      // Private mode / storage disabled — dismissal simply won't persist.
    }
  }, []);

  const enablePushNotifications = useCallback(
    async (vapidPublicKey: string) => {
      await enablePush(vapidPublicKey);
      setPushSubscribed(true);
    },
    [],
  );

  const disablePushNotifications = useCallback(async () => {
    await disablePush();
    setPushSubscribed(false);
  }, []);

  const clearOfflineData = useCallback(async () => {
    await clearOfflineCaches();
  }, []);

  const value = useMemo<PwaContextValue>(
    () => ({
      isOnline,
      canInstall: Boolean(installEvent) && !installDismissed,
      updateAvailable,
      offlineReady,
      pushSupported,
      pushSubscribed,
      promptInstall,
      dismissInstall,
      applyUpdate: applyServiceWorkerUpdate,
      enablePushNotifications,
      disablePushNotifications,
      refreshPushSubscription,
      clearOfflineData,
    }),
    [
      isOnline,
      installEvent,
      installDismissed,
      updateAvailable,
      offlineReady,
      pushSupported,
      pushSubscribed,
      promptInstall,
      dismissInstall,
      enablePushNotifications,
      disablePushNotifications,
      refreshPushSubscription,
      clearOfflineData,
    ],
  );

  return <PwaContext.Provider value={value}>{children}</PwaContext.Provider>;
}

export function usePwa(): PwaContextValue {
  const ctx = useContext(PwaContext);
  if (!ctx) throw new Error('usePwa must be used within a PwaProvider');
  return ctx;
}
