const listeners = new Set();
let snapshot = {
  status:
    typeof navigator !== 'undefined' && navigator.onLine === false
      ? 'offline'
      : 'online',
  lastSynced: null,
};
const statusListeners = new Set();
export const connectionSnapshot = () => snapshot;
export const subscribeConnection = (listener) => {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
};
export function connectionChanged(status, synced = false) {
  snapshot = { status, lastSynced: synced ? Date.now() : snapshot.lastSynced };
  statusListeners.forEach((listener) => listener());
}
export const subscribeAppResume = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export async function refreshResumedViews() {
  await Promise.allSettled(
    [...listeners].map((listener) => Promise.resolve().then(listener)),
  );
}

/** One lifecycle coordinator for the app; events coalesce and never replay writes. */
export function observeAppResume(
  refresh,
  {
    win = window,
    doc = document,
    now = Date.now,
    minimumAway = 1000,
    cooldown = 5000,
  } = {},
) {
  let away = now(),
    last = -Infinity,
    pending = null,
    stopped = false;
  const run = (force = false) => {
    if (
      stopped ||
      doc.visibilityState === 'hidden' ||
      win.navigator.onLine === false
    )
      return Promise.resolve();
    if (pending) return pending;
    if (
      (!force && now() - away < minimumAway) ||
      (now() - last < cooldown && snapshot.status === 'online')
    )
      return Promise.resolve();
    last = now();
    pending = Promise.resolve()
      .then(refresh)
      .catch(() => {})
      .finally(() => {
        pending = null;
      });
    return pending;
  };
  const visibility = () => {
    if (doc.visibilityState === 'hidden') away = now();
    else run(snapshot.status !== 'online');
  };
  const blur = () => {
    away = now();
  };
  const focus = () => run(snapshot.status !== 'online');
  const online = () => run(true);
  const offline = () => connectionChanged('offline');
  const pageshow = (event) => {
    if (event.persisted) run(true);
  };
  doc.addEventListener('visibilitychange', visibility);
  for (const [event, handler] of [
    ['blur', blur],
    ['focus', focus],
    ['online', online],
    ['offline', offline],
    ['pageshow', pageshow],
  ])
    win.addEventListener(event, handler);
  return {
    retry: () => {
      last = -Infinity;
      return run(true);
    },
    stop: () => {
      stopped = true;
      doc.removeEventListener('visibilitychange', visibility);
      for (const [event, handler] of [
        ['blur', blur],
        ['focus', focus],
        ['online', online],
        ['offline', offline],
        ['pageshow', pageshow],
      ])
        win.removeEventListener(event, handler);
    },
  };
}

/** Transparent observation: preserve the existing cookie-refresh interceptor. */
export function observeApiConnection(api) {
  const id = api.interceptors.response.use(
    (response) => {
      connectionChanged(
        'online',
        response.config?.method?.toLowerCase() === 'get',
      );
      return response;
    },
    (error) => {
      if (error.code !== 'ERR_CANCELED')
        connectionChanged(
          error.response &&
            error.response.status < 500 &&
            navigator.onLine !== false
            ? 'online'
            : 'offline',
        );
      return Promise.reject(error);
    },
  );
  return () => api.interceptors.response.eject(id);
}
