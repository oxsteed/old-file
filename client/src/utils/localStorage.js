// localStorage is an optional browser capability. Keep preference reads and
// writes from taking down application bootstrap in privacy-restricted or
// embedded browsers where the getter or methods can throw.
function getStorage() {
  try {
    return typeof globalThis !== 'undefined' && globalThis.localStorage
      ? globalThis.localStorage
      : null;
  } catch {
    return null;
  }
}

export function readLocalStorage(key) {
  try {
    return getStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeLocalStorage(key, value) {
  try {
    getStorage()?.setItem(key, value);
  } catch {
    // Preferences are progressive enhancement; callers remain usable.
  }
}

export function removeLocalStorage(key) {
  try {
    getStorage()?.removeItem(key);
  } catch {
    // Clearing optional legacy state must not break logout or refresh.
  }
}
