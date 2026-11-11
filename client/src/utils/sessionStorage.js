// Browser sessionStorage is optional. Privacy modes, embedded browsers, and
// storage policy failures can make the getter itself throw, so callers that
// use it for optional impersonation state must never block API connectivity.
export function readSessionStorage(key) {
  try {
    if (typeof globalThis === 'undefined' || !globalThis.sessionStorage) return null;
    return globalThis.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
