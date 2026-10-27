const guards = new Set();
const listeners = new Set();

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
