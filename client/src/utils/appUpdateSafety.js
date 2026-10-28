const guards = new Set();
const listeners = new Set();
let departing = false;
let observedWindow = null;
let pendingChunks = 0;
const leaveDocument = () => { departing = true; };
const RELOAD_TRANSITION_KEY = 'oxsteed:app-reload-transition';
const RELOAD_TRANSITION_MS = 10000;

// An aborted import can reject while the old document is unloading. It must
// not replace the destination the user or service-worker update already chose.
export function documentIsLeaving() {
  const win = typeof window === 'undefined' ? null : window;
  if (win && typeof win.addEventListener === 'function' && observedWindow !== win) {
    observedWindow = win;
    departing = false;
    pendingChunks = 0;
    win.addEventListener('pagehide', leaveDocument);
    win.addEventListener('pageshow', event => { if (event.persisted) departing = false; });
  }
  return departing;
}

export function observePendingChunkNavigation() {
  documentIsLeaving();
  const win = observedWindow;
  if (!win) return () => {};
  if (++pendingChunks === 1) win.addEventListener('beforeunload', leaveDocument);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    // Unload observation is needed only while an import could be aborted.
    if (--pendingChunks === 0) win.removeEventListener('beforeunload', leaveDocument);
  };
}

export function markDocumentLeaving() {
  documentIsLeaving();
  departing = true;
  try { window.sessionStorage.setItem(RELOAD_TRANSITION_KEY, String(Date.now())); } catch { /* Optional across-document coordination. */ }
}

export function recentDocumentReload() {
  try {
    const at = Number(window.sessionStorage.getItem(RELOAD_TRANSITION_KEY));
    return Number.isFinite(at) && Date.now() - at >= 0 && Date.now() - at < RELOAD_TRANSITION_MS;
  } catch { return false; }
}

export const appUpdatesDeferred = () => guards.size > 0;
export const subscribeUpdateSafety = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

// Each mounted workflow owns its guard; one component cannot release another
// component's protection. No form values or private state enter this store.
export function deferAppUpdates() {
  const guard = {};
  guards.add(guard);
  listeners.forEach(listener => listener());
  return () => {
    if (!guards.delete(guard)) return;
    listeners.forEach(listener => listener());
  };
}

export function isUpdateSensitivePath(pathname = '') {
  return /^\/(?:checkout|cart|post-job|wallet|pay|qr-payments|agreements)(?:\/|$)/.test(pathname)
    || /(?:^|\/)(?:checkout|book)(?:\/|$)/.test(pathname)
    || /^\/(?:restaurants|food)\/(?:merchant|pos|kitchen|queue|kiosk|screens)(?:\/|$)/.test(pathname)
    || /^\/invoice\/p\//.test(pathname);
}

// A restaurant page can restore a cart before its UI has mounted. Never
// silently reload it during that startup window; its visible cart then owns
// an explicit guard while the customer is choosing or checking out.
export function isSilentUpdateSensitivePath(pathname = '') {
  return isUpdateSensitivePath(pathname)
    || /^\/(?:restaurants|food)\/r\/[^/]+(?:\/|$)/.test(pathname);
}
