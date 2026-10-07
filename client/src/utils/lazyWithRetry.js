import { lazy } from 'react';
import * as Sentry from '@sentry/react';

const RETRY_PREFIX = 'oxs:lazy-retry:';
const RETRY_TTL_MS = 10 * 60 * 1000;

function getRelease() {
  return import.meta.env.VITE_APP_VERSION
    || import.meta.env.VITE_SENTRY_RELEASE
    || 'unknown';
}

function getPathname() {
  return typeof window !== 'undefined' ? window.location.pathname : 'unknown';
}

function safeSessionStorage() {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

function retryKey(name) {
  return `${RETRY_PREFIX}${getRelease()}:${getPathname()}:${name}`;
}

function hasFreshRetryMarker(key) {
  const storage = safeSessionStorage();
  if (!storage) return false;
  try {
    const value = Number(storage.getItem(key));
    if (!Number.isFinite(value) || Date.now() - value > RETRY_TTL_MS) {
      storage.removeItem(key);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function setRetryMarker(key) {
  const storage = safeSessionStorage();
  if (!storage) return;
  try {
    storage.setItem(key, String(Date.now()));
  } catch {
    // Storage can be unavailable in private browsing.
  }
}

function clearRetryMarker(key) {
  const storage = safeSessionStorage();
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // Ignore storage failures.
  }
}

export function isChunkLoadError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|chunkloaderror|loading chunk|module script failed|mime type|load failed/.test(message);
}

export function forceChunkReload() {
  const storage = safeSessionStorage();
  if (storage) {
    try {
      for (let index = storage.length - 1; index >= 0; index -= 1) {
        const key = storage.key(index);
        if (key?.startsWith(RETRY_PREFIX)) storage.removeItem(key);
      }
    } catch {
      // Ignore storage failures.
    }
  }

  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.set('chunk-retry', 'manual');
  window.location.replace(url.toString());
}

function reportChunkFailure(error, name) {
  Sentry.withScope((scope) => {
    scope.setTag('failure_type', 'lazy_chunk_load');
    scope.setTag('route', getPathname());
    scope.setTag('chunk_name', name);
    scope.setTag('release', getRelease());
    scope.setExtra('asset_url', typeof window !== 'undefined' ? window.location.href : null);
    Sentry.captureException(error);
  });
}

const GLOBAL_RELOAD_KEY = 'oxs:chunk-reload:global';

/**
 * installGlobalChunkReload — catches chunk-load failures from dynamic
 * import() calls that never pass through React.lazy (i18n locale chunks,
 * on-demand panel imports, etc.) and reloads the page once, guarded by a
 * sessionStorage timestamp so a persistently missing chunk cannot loop.
 * Sentry OXSTEED-FRONTEND-1A/17/18/19 class.
 */
export function installGlobalChunkReload() {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  const onUnhandledRejection = (event) => {
    let error = null;
    try {
      error = event?.reason;
    } catch {
      return;
    }
    if (!isChunkLoadError(error)) return;

    const storage = safeSessionStorage();
    let shouldReload = true;
    if (storage) {
      try {
        const last = Number(storage.getItem(GLOBAL_RELOAD_KEY));
        if (Number.isFinite(last) && Date.now() - last < RETRY_TTL_MS) {
          shouldReload = false;
        } else {
          storage.setItem(GLOBAL_RELOAD_KEY, String(Date.now()));
        }
      } catch {
        // Storage unavailable; allow the single reload attempt.
      }
    }
    if (!shouldReload) return;

    try {
      if (typeof event?.preventDefault === 'function') event.preventDefault();
    } catch {
      // Continue with the reload even if preventDefault fails.
    }
    Sentry.withScope((scope) => {
      scope.setTag('failure_type', 'global_chunk_load');
      scope.setTag('route', getPathname());
      scope.setTag('release', getRelease());
      Sentry.captureException(error);
    });
    const url = new URL(window.location.href);
    url.searchParams.set('chunk-retry', 'auto-global');
    window.location.replace(url.toString());
  };
  window.addEventListener('unhandledrejection', onUnhandledRejection);
}

export function lazyWithRetry(loader, options = {}) {
  const name = options.name || loader.name || 'route';

  return lazy(async () => {
    try {
      const module = await loader();
      clearRetryMarker(retryKey(name));
      return module;
    } catch (error) {
      if (!isChunkLoadError(error)) throw error;

      reportChunkFailure(error, name);
      const key = retryKey(name);
      if (!hasFreshRetryMarker(key) && typeof window !== 'undefined') {
        setRetryMarker(key);
        const url = new URL(window.location.href);
        url.searchParams.set('chunk-retry', 'auto');
        window.location.replace(url.toString());
        return new Promise(() => {});
      }

      throw error;
    }
  });
}
