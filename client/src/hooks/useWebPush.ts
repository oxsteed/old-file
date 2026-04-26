import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../api/axios';

/**
 * Self-hosted Web Push hook.
 *
 * Owns the lifecycle: feature detection → SW registration → permission →
 * VAPID subscribe → server upsert. Also handles `pushsubscriptionchange`
 * messages from the SW so we silently re-sync when the browser rotates
 * the endpoint.
 */

type PushPermission = 'default' | 'granted' | 'denied' | 'unsupported';

interface PublicKeyResponse {
  publicKey: string | null;
  enabled: boolean;
}

interface UseWebPushResult {
  isSupported: boolean;
  /** True once the page has finished its initial state probe. */
  ready: boolean;
  permission: PushPermission;
  isSubscribed: boolean;
  /** True iff the server has VAPID keys configured. */
  serverEnabled: boolean;
  loading: boolean;
  error: string | null;
  subscribe: (deviceLabel?: string) => Promise<boolean>;
  unsubscribe: () => Promise<boolean>;
  sendTest: () => Promise<boolean>;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function subscriptionToJSON(sub: PushSubscription) {
  // Spec method exists but TS lib types it as opaque — normalize ourselves.
  const json = sub.toJSON() as {
    endpoint?: string;
    expirationTime?: number | null;
    keys?: { p256dh?: string; auth?: string };
  };
  return {
    endpoint: json.endpoint || sub.endpoint,
    expirationTime: json.expirationTime ?? null,
    keys: {
      p256dh: json.keys?.p256dh || '',
      auth:   json.keys?.auth   || '',
    },
  };
}

export function useWebPush(): UseWebPushResult {
  const isSupported =
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window;

  const [permission, setPermission] = useState<PushPermission>(
    isSupported ? (Notification.permission as PushPermission) : 'unsupported'
  );
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [serverEnabled, setServerEnabled] = useState(false);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initRan = useRef(false);

  // Initial probe — fetch VAPID public key + check current subscription state.
  useEffect(() => {
    if (!isSupported || initRan.current) {
      if (!isSupported) setReady(true);
      return;
    }
    initRan.current = true;

    (async () => {
      try {
        const { data } = await api.get<PublicKeyResponse>('/notifications/webpush/public-key');
        setServerEnabled(!!data.enabled);
        setPublicKey(data.publicKey);

        const reg = await navigator.serviceWorker.ready;
        const existing = await reg.pushManager.getSubscription();
        setIsSubscribed(!!existing);
      } catch (err) {
        // Non-fatal — UI just shows the panel as disabled.
      } finally {
        setReady(true);
      }
    })();
  }, [isSupported]);

  // Re-subscribe path — SW broadcasts when the browser rotates the endpoint.
  useEffect(() => {
    if (!isSupported) return;
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'webpush:resubscribe') {
        // Best-effort: refresh state. The user may need to re-click subscribe
        // if the keys can't be silently rotated.
        navigator.serviceWorker.ready
          .then(reg => reg.pushManager.getSubscription())
          .then(sub => setIsSubscribed(!!sub))
          .catch(() => { /* ignore */ });
      }
    };
    navigator.serviceWorker.addEventListener('message', handler);
    return () => navigator.serviceWorker.removeEventListener('message', handler);
  }, [isSupported]);

  const subscribe = useCallback(async (deviceLabel?: string): Promise<boolean> => {
    if (!isSupported) return false;
    if (!publicKey) {
      setError('Push notifications are not configured on this server.');
      return false;
    }

    setLoading(true);
    setError(null);

    try {
      // Request OS permission (no-op if already granted).
      const perm = await Notification.requestPermission();
      setPermission(perm as PushPermission);
      if (perm !== 'granted') {
        setError('Permission denied');
        return false;
      }

      const reg = await navigator.serviceWorker.ready;

      // Reuse an existing subscription if the same VAPID key is already in use.
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      }

      const payload = subscriptionToJSON(sub);
      await api.post('/notifications/webpush/subscribe', {
        ...payload,
        deviceLabel: deviceLabel || (typeof navigator !== 'undefined' ? navigator.platform : null),
      });

      setIsSubscribed(true);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(msg);
      return false;
    } finally {
      setLoading(false);
    }
  }, [isSupported, publicKey]);

  const unsubscribe = useCallback(async (): Promise<boolean> => {
    if (!isSupported) return false;
    setLoading(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        // Tell the server first so we never lose track of it if browser
        // unsubscribe succeeds but the network call fails afterwards.
        await api.delete('/notifications/webpush/subscribe', { data: { endpoint } });
        await sub.unsubscribe();
      }
      setIsSubscribed(false);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(msg);
      return false;
    } finally {
      setLoading(false);
    }
  }, [isSupported]);

  const sendTest = useCallback(async (): Promise<boolean> => {
    setLoading(true);
    setError(null);
    try {
      await api.post('/notifications/webpush/test');
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(msg);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    isSupported,
    ready,
    permission,
    isSubscribed,
    serverEnabled,
    loading,
    error,
    subscribe,
    unsubscribe,
    sendTest,
  };
}

export default useWebPush;
