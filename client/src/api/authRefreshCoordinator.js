const REFRESH_LOCK_NAME = 'oxsteed-auth-refresh';
const FALLBACK_LOCK_KEY = 'oxs:auth-refresh-lock';
const FALLBACK_LOCK_TTL_MS = 30_000;
const FALLBACK_WAIT_MS = 50;

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
function newOwnerId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readFallbackLock() {
  try {
    const raw = globalThis.localStorage?.getItem(FALLBACK_LOCK_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeFallbackLock(lock) {
  try {
    globalThis.localStorage?.setItem(FALLBACK_LOCK_KEY, JSON.stringify(lock));
    return readFallbackLock()?.owner === lock.owner;
  } catch {
    return false;
  }
}

function releaseFallbackLock(owner) {
  try {
    if (readFallbackLock()?.owner === owner) globalThis.localStorage?.removeItem(FALLBACK_LOCK_KEY);
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}

async function withStorageLock(operation) {
  const owner = newOwnerId();
  const deadline = Date.now() + FALLBACK_LOCK_TTL_MS;

  while (Date.now() < deadline) {
    const current = readFallbackLock();
    if (!current || Number(current.expiresAt) <= Date.now()) {
      const lock = { owner, expiresAt: Date.now() + FALLBACK_LOCK_TTL_MS };
      if (writeFallbackLock(lock)) {
        try {
          return await operation();
        } finally {
          releaseFallbackLock(owner);
        }
      }
    }
    await wait(FALLBACK_WAIT_MS);
  }

  // A broken/stale storage implementation must not make authentication hang
  // forever. The server still validates and rotates the credential.
  return operation();
}

/**
 * Serialize refresh-token rotation across tabs without sharing token values.
 * Web Locks is preferred; localStorage is only a compatibility fallback.
 */
export function withCrossTabRefreshLock(operation) {
  if (typeof navigator !== 'undefined' && typeof navigator.locks?.request === 'function') {
    return navigator.locks.request(REFRESH_LOCK_NAME, { mode: 'exclusive' }, operation);
  }
  if (typeof localStorage === 'undefined') return operation();
  return withStorageLock(operation);
}
