import { appUpdatesDeferred, markDocumentLeaving, recentDocumentReload, isSilentUpdateSensitivePath, isUpdateSensitivePath } from './appUpdateSafety.js';

function reloadDocument() {
  markDocumentLeaving();
  window.location.reload();
}

const RECOVERY_KEY = 'oxsteed:i18n-bootstrap-recovery';

function hashFingerprint(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

/**
 * Fallback release id when no build id was injected (local builds without a
 * release env or git). Only the entry module scripts written into the served
 * HTML are fingerprinted: their hashed names change whenever any chunk they
 * import changes. Runtime-injected tags (Vite's dynamic-import
 * `<link rel="modulepreload">`, lazy CSS) are route-specific and must never
 * feed the version, or every landing route and tab registers a "new" worker.
 */
export function getAssetReleaseId() {
  if (typeof document === 'undefined') return 'dev';
  const assets = Array.from(document.querySelectorAll('script[type="module"][src]'))
    .map((element) => element.getAttribute('src') || '')
    .map((value) => {
      try {
        return new URL(value, window.location.origin).pathname;
      } catch {
        return value;
      }
    })
    .filter((value) => value.includes('/assets/'))
    .sort();
  return assets.length ? `assets-${hashFingerprint(assets.join('|'))}` : 'dev';
}

/**
 * The service-worker version is one deterministic id per build, shared by
 * every route and both entries (index.html and admin.html). vite.config.js
 * injects import.meta.env.VITE_APP_BUILD_ID from the release env (VITE_APP_VERSION, Sentry
 * release, commit SHA) or git HEAD.
 */
export function getServiceWorkerVersion() {
  const env = import.meta.env || {};
  const configured = env.VITE_APP_BUILD_ID || env.VITE_APP_VERSION || env.VITE_SENTRY_RELEASE || '';
  return String(configured || getAssetReleaseId());
}

export function getServiceWorkerUrl() {
  return `/sw.js?v=${encodeURIComponent(getServiceWorkerVersion())}`;
}

// A waiting worker found this soon after load, before the user has touched
// the page, is applied silently: nothing can be lost and the reload is
// indistinguishable from the page still loading.
export const SILENT_UPDATE_WINDOW_MS = 10000;
const SILENT_UPDATE_KEY = 'oxsteed:sw-silent-update';
let pageInteracted = false;
let silentUpdateDeadline = 0;

function trackInteraction() {
  if (typeof window === 'undefined') return;
  const mark = () => {
    pageInteracted = true;
    ['pointerdown', 'keydown', 'input'].forEach((type) => window.removeEventListener(type, mark, true));
  };
  ['pointerdown', 'keydown', 'input'].forEach((type) => window.addEventListener(type, mark, true));
}

function readSilentUpdateMarker() {
  try { return sessionStorage.getItem(SILENT_UPDATE_KEY); } catch { return null; }
}

function writeSilentUpdateMarker(value) {
  try { sessionStorage.setItem(SILENT_UPDATE_KEY, value); return true; } catch { return false; }
}

function trySilentUpdate(worker) {
  if (appUpdatesDeferred() || isSilentUpdateSensitivePath(window.location.pathname)) return false;
  // Explicit refresh and chunk recovery already reloaded this tab. A waiting
  // worker can still be visible while activation catches up; reloading again
  // races the next navigation, so show the notice instead.
  if (pageInteracted || Date.now() > silentUpdateDeadline || recentDocumentReload()) return false;
  const id = worker.scriptURL || 'waiting';
  // One silent attempt per worker per tab session: if the reload comes back
  // to the same waiting worker, fall back to the visible notice (no loops).
  if (readSilentUpdateMarker() === id) return false;
  if (!writeSilentUpdateMarker(id)) return false;
  navigator.serviceWorker.addEventListener('controllerchange', reloadDocument, { once: true });
  worker.postMessage({ type: 'SKIP_WAITING' });
  return true;
}

let waitingWorker = null;
const updateListeners = new Set();
export const getWaitingWorker = () => waitingWorker;
export function subscribeWorkerUpdate(listener) {
  updateListeners.add(listener);
  return () => updateListeners.delete(listener);
}
function announceUpdate(worker) {
  if (waitingWorker === worker) return;
  if (trySilentUpdate(worker)) return;
  waitingWorker = worker;
  updateListeners.forEach(listener => listener(worker));
}

export function applyWorkerUpdate() {
  if (!waitingWorker || appUpdatesDeferred() || isUpdateSensitivePath(window.location.pathname)) return false;
  // Another tab may already have accepted this worker. Refresh this page
  // only when its own user presses the button.
  if (waitingWorker.state === 'activated') { reloadDocument(); return true; }
  // Only the page whose user requested the update reloads. Other tabs keep
  // their in-progress forms and are never forcibly reloaded on controllerchange.
  navigator.serviceWorker.addEventListener('controllerchange', reloadDocument, { once: true });
  waitingWorker.postMessage({ type: 'SKIP_WAITING' });
  return true;
}

export function registerServiceWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  trackInteraction();
  const register = () => {
    silentUpdateDeadline = Date.now() + SILENT_UPDATE_WINDOW_MS;
    try { localStorage.setItem('oxsteed:last-opened', String(Date.now())); } catch { /* optional */ }
    navigator.serviceWorker.register(getServiceWorkerUrl(), {
      updateViaCache: 'none',
    }).then(registration => {
      const detectWaiting = () => {
        if (registration.waiting && navigator.serviceWorker.controller) announceUpdate(registration.waiting);
      };
      detectWaiting();
      const watchInstalling = () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed') detectWaiting();
        });
      };
      registration.addEventListener('updatefound', watchInstalling);
      watchInstalling();
    }).catch(() => { /* The app works without a worker. */ });
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

function readRecoveryMarker() {
  try {
    return sessionStorage.getItem(RECOVERY_KEY);
  } catch {
    return null;
  }
}

function writeRecoveryMarker() {
  try {
    sessionStorage.setItem(RECOVERY_KEY, '1');
  } catch {
    // Continue with the visible recovery state when storage is unavailable.
  }
}

export function clearBootstrapRecoveryMarker() {
  try {
    sessionStorage.removeItem(RECOVERY_KEY);
  } catch {
    // Storage is optional.
  }
}

/** Recover once from a failed lazy module or locale load. */
export async function recoverFromBootstrapFailure() {
  if (readRecoveryMarker()) return false;
  writeRecoveryMarker();

  try {
    const registrations = await navigator.serviceWorker?.getRegistrations?.() || [];
    await Promise.all(registrations.map((registration) => registration.unregister()));
  } catch {
    // The retry is still useful without a service worker.
  }

  try {
    const cacheNames = typeof caches === 'undefined' ? [] : await caches.keys();
    await Promise.all(cacheNames
      .filter((name) => name.startsWith('oxsteed-static-') || name.startsWith('oxsteed-assets-') || name.startsWith('oxsteed-asset-meta-'))
      .map((name) => caches.delete(name)));
  } catch {
    // Cache storage may be unavailable or restricted.
  }

  return true;
}
