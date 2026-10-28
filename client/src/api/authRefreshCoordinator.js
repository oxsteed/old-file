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
    return null;
  }
}

function releaseFallbackLock(owner) {
  try {
    if (readFallbackLock()?.owner === owner) globalThis.localStorage?.removeItem(FALLBACK_LOCK_KEY);
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}

async function withStorageLock(operation, waitTimeoutMs) {
  const owner = newOwnerId();
  const deadline = Date.now() + waitTimeoutMs;

  while (Date.now() < deadline) {
    const current = readFallbackLock();
    if (!current || Number(current.expiresAt) <= Date.now()) {
      const lock = { owner, expiresAt: Date.now() + FALLBACK_LOCK_TTL_MS };
      const acquired = writeFallbackLock(lock);
      // Storage may be unavailable in privacy-restricted contexts. The
      // in-page refresh flight still coalesces callers in that case.
      if (acquired === null) return operation();
      if (acquired) {
        try {
          return await operation();
        } finally {
          releaseFallbackLock(owner);
        }
      }
    }
    await wait(FALLBACK_WAIT_MS);
  }

  // Never rotate concurrently just because another tab held the lock longer
  // than our wait. This is a retryable transport failure, not session expiry.
  const error = new Error('Refresh lock wait timed out.');
  error.code = 'AUTH_REFRESH_BUSY';
  throw error;
}

/**
 * Serialize refresh-token rotation across tabs without sharing token values.
 * Web Locks is preferred; localStorage is only a compatibility fallback.
 */
export function withCrossTabRefreshLock(operation, { waitTimeoutMs = FALLBACK_LOCK_TTL_MS } = {}) {
  if (!Number.isFinite(waitTimeoutMs) || waitTimeoutMs <= 0 || waitTimeoutMs > 2147483647) {
    throw new Error('Invalid refresh lock wait timeout.');
  }
  if (typeof navigator !== 'undefined' && typeof navigator.locks?.request === 'function') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), waitTimeoutMs);
    return (async () => {
      try {
        return await navigator.locks.request(REFRESH_LOCK_NAME, { mode: 'exclusive', signal: controller.signal }, () => {
          clearTimeout(timer);
          return operation();
        });
      } finally { clearTimeout(timer); }
    })();
  }
  if (typeof localStorage === 'undefined') return operation();
  return withStorageLock(operation, waitTimeoutMs);
}
