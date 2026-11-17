import { lazy } from 'react';
import * as Sentry from '@sentry/react';
import { appUpdatesDeferred, documentIsLeaving, markDocumentLeaving, recentDocumentReload, observePendingChunkNavigation, isSilentUpdateSensitivePath } from './appUpdateSafety.js';

const RETRY_PREFIX = 'oxs:lazy-retry:';
const RETRY_TTL_MS = 10 * 60 * 1000;
let automaticReloadStarted = false;

function canAutomaticallyReload(startedHref) {
  return typeof window !== 'undefined' && !automaticReloadStarted && !documentIsLeaving() && !recentDocumentReload()
    && window.navigator?.onLine !== false && !appUpdatesDeferred()
    && !isSilentUpdateSensitivePath(window.location.pathname)
    && (!startedHref || startedHref === window.location.href);
}

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
  if (!storage) return false;
  try {
    const value = String(Date.now());
    storage.setItem(key, value);
    return storage.getItem(key) === value;
  } catch {
    // Without a durable marker, a missing asset could cause a reload loop.
    return false;
  }
}

export function isChunkLoadError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|chunkloaderror|loading chunk|module script failed|mime type|load failed|unable to preload/.test(message);
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
  markDocumentLeaving();
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
    Sentry.captureException(error);
  });
}

// In-place retry delays before a chunk failure falls back to a full document
// reload. A deploy restart makes chunk fetches fail for a few seconds; an
// immediate reload lands straight in the outage and strands the user on the
// static trouble page, while a short in-place retry usually rides the blip
// out with no navigation and no state lost.
const DEFAULT_CHUNK_RETRY_DELAYS_MS = [1500, 3000];

function delay(ms) {
  // Non-browser harnesses may not provide timers; retry immediately there.
  if (typeof setTimeout !== 'function') return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  documentIsLeaving();
  const onUnhandledRejection = (event) => {
    let error = null;
    try {
      error = event?.reason;
    } catch {
      return;
    }
    if (!isChunkLoadError(error)) return;
    if (!canAutomaticallyReload() || hasFreshRetryMarker(GLOBAL_RELOAD_KEY) || !setRetryMarker(GLOBAL_RELOAD_KEY)) return;
    automaticReloadStarted = true;
    markDocumentLeaving();

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
  // Test and tuning hook: how long to wait between in-place retries of a
  // failed chunk import before giving up the document to a reload.
  const retryDelaysMs = Array.isArray(options.chunkRetryDelaysMs)
    ? options.chunkRetryDelaysMs
    : DEFAULT_CHUNK_RETRY_DELAYS_MS;
  documentIsLeaving();

  return lazy(async () => {
    const startedHref = typeof window === 'undefined' ? null : window.location.href;
    const stopObserving = observePendingChunkNavigation();
    try {
      // MITIGATION (Nov 16, PR #797 Track E): retry a failed chunk import
      // in place before reloading the document. The old code reloaded
      // immediately on the first failure; during a deploy restart that
      // reload fetched a 5xx document and the service worker served the
      // static trouble page, so a transient blip became a dead error page
      // for signup. A blip that heals within a few seconds now becomes a
      // slightly slow load instead. The reload below stays as the last
      // resort for a persistently missing chunk.
      let lastError = null;
      for (let attempt = 0; ; attempt += 1) {
        try {
          const module = await loader();
          // Keep the bounded attempt marker even when another lazy component
          // succeeds. Anonymous loaders can share a route key; clearing it here
          // could let a persistently missing sibling reload every new document.
          return module;
        } catch (error) {
          if (!isChunkLoadError(error)) throw error;
          lastError = error;
          const waitMs = retryDelaysMs[attempt];
          if (waitMs === undefined || documentIsLeaving()) break;
          await delay(waitMs);
          if (documentIsLeaving()
            || (startedHref && typeof window !== 'undefined' && window.location.href !== startedHref)) break;
        }
      }

      reportChunkFailure(lastError, name);
      const key = retryKey(name);
      if (canAutomaticallyReload(startedHref) && !hasFreshRetryMarker(key) && setRetryMarker(key)) {
        automaticReloadStarted = true;
        markDocumentLeaving();
        const url = new URL(window.location.href);
        url.searchParams.set('chunk-retry', 'auto');
        window.location.replace(url.toString());
        return new Promise(() => {});
      }

      throw lastError;
    } finally { stopObserving(); }
  });
}
