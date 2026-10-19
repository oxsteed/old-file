// Connection resilience for the public restaurant display feeds. Polls a
// `load` callback on a steady cadence while it succeeds; on failure it keeps
// rendering the last-known state and retries with exponential backoff
// (see utils/displayBackoff). Listens to online/offline events so a venue
// network drop shows an offline banner immediately and reconnects fast when
// the link returns. `load` must return a promise that rejects on failure.
import { useCallback, useEffect, useRef, useState } from 'react';
import { computeDisplayBackoffMs } from '../utils/displayBackoff';

export function useDisplayPoller(
  load,
  { intervalMs = 5000, enabled = true, manageOnlineEvents = true } = {},
) {
  const [offline, setOffline] = useState(
    typeof navigator !== 'undefined' ? !navigator.onLine : false,
  );
  const [failures, setFailures] = useState(0);
  const [lastOkAt, setLastOkAt] = useState(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const failuresRef = useRef(0);
  const timerRef = useRef(null);
  const mountedRef = useRef(true);
  const runOnceRef = useRef(null);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const scheduleNext = (delayMs) => {
    clearTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      runOnceRef.current?.();
    }, delayMs);
  };

  const runOnce = useCallback(async () => {
    clearTimer();
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      if (mountedRef.current) setOffline(true);
      scheduleNext(computeDisplayBackoffMs(Math.max(1, failuresRef.current)));
      return;
    }
    try {
      await loadRef.current();
      failuresRef.current = 0;
      if (mountedRef.current) {
        setFailures(0);
        setOffline(false);
        setLastOkAt(Date.now());
      }
      scheduleNext(intervalMs);
    } catch {
      failuresRef.current += 1;
      if (mountedRef.current) {
        setFailures(failuresRef.current);
        setOffline(true);
      }
      scheduleNext(computeDisplayBackoffMs(failuresRef.current));
    }
  }, [intervalMs]);
  runOnceRef.current = runOnce;

  useEffect(() => {
    mountedRef.current = true;
    if (!enabled) return undefined;
    runOnce();
    let onOnline;
    let onOffline;
    if (manageOnlineEvents && typeof window !== 'undefined') {
      onOnline = () => runOnceRef.current?.();
      onOffline = () => {
        clearTimer();
        setOffline(true);
      };
      window.addEventListener('online', onOnline);
      window.addEventListener('offline', onOffline);
    }
    return () => {
      mountedRef.current = false;
      clearTimer();
      if (onOnline) window.removeEventListener('online', onOnline);
      if (onOffline) window.removeEventListener('offline', onOffline);
    };
  }, [enabled, manageOnlineEvents, runOnce]);

  return { offline, failures, lastOkAt, retryNow: runOnce };
}
