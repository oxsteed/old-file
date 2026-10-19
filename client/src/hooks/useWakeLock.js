// Screen Wake Lock for the public restaurant display pages. Keeps a wall
// TV or tablet from sleeping while it shows the queue board, kiosk, or
// kitchen feed. The lock is released automatically by the OS when the tab
// hides, so we re-acquire on visibilitychange. Graceful no-op where the
// API is unsupported (iPad Safari).
import { useCallback, useEffect, useRef, useState } from 'react';

export function isWakeLockSupported(nav = typeof navigator !== 'undefined' ? navigator : undefined) {
  return Boolean(nav && 'wakeLock' in nav && typeof nav.wakeLock?.request === 'function');
}

export function useWakeLock(active) {
  const [held, setHeld] = useState(false);
  const [supported] = useState(() => isWakeLockSupported());
  const sentinelRef = useRef(null);

  const acquire = useCallback(async () => {
    if (!active || !isWakeLockSupported()) return;
    if (sentinelRef.current) return;
    try {
      const sentinel = await navigator.wakeLock.request('screen');
      sentinelRef.current = sentinel;
      setHeld(true);
      sentinel.addEventListener('release', () => {
        if (sentinelRef.current === sentinel) {
          sentinelRef.current = null;
          setHeld(false);
        }
      });
    } catch {
      // NotAllowedError when the page is hidden, or the OS denied the lock.
      setHeld(false);
    }
  }, [active]);

  const release = useCallback(async () => {
    const sentinel = sentinelRef.current;
    sentinelRef.current = null;
    setHeld(false);
    if (sentinel) {
      try {
        await sentinel.release();
      } catch {
        // Already released by the OS.
      }
    }
  }, []);

  useEffect(() => {
    if (!active) {
      release();
      return undefined;
    }
    acquire();
    const onVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        acquire();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      release();
    };
  }, [active, acquire, release]);

  return { held, supported };
}
