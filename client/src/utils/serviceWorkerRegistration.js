import { appUpdatesDeferred, markDocumentLeaving, recentDocumentReload, isSilentUpdateSensitivePath, isUpdateSensitivePath } from './appUpdateSafety.js';

function reloadDocument() {
  markDocumentLeaving();
  window.location.reload();
}

const RECOVERY_KEY = 'oxsteed:i18n-bootstrap-recovery';

/**
 * Fallback release id when no build id was injected (local builds without a
 * release env or git). This is deliberately a single constant, never a
 * fingerprint of the served HTML: Vite injects route-specific modulepreload
 * links, so a DOM fingerprint differs per landing route and tab, and main
 * and admin then register different sw.js?v= URLs for one build, each
 * triggering a worker update on every switch between app and admin (M14).
 * The constant cannot break a deploy the way failing the production build
 * would (a build from a source tarball without git or release env still
 * has to ship); a deployment without an injected id still picks up a new
 * worker by byte change, since the browser re-checks sw.js on navigation
 * with updateViaCache 'none'. Production builds reliably resolve a real
 * id: the Dockerfile and docker-compose.coolify.yml pass COMMIT_SHA /
 * SOURCE_COMMIT / VITE_APP_VERSION into the build, and resolveBuildId in
 * vite.config.js also falls back to git HEAD.
 */
export const FALLBACK_RELEASE_ID = 'unversioned';
export function getAssetReleaseId() {
  return FALLBACK_RELEASE_ID;
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
// Public/read-only pages can move to an announced release after a short
// quiet period. Sensitive paths and pages with unfinished input remain
// protected by canApplyQuietly().
export const AUTO_APPLY_UPDATE_DELAY_MS = 30000;
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
  // races the next navigation, so keep it waiting instead.
  if (pageInteracted || Date.now() > silentUpdateDeadline || recentDocumentReload()) return false;
  const id = worker.scriptURL || 'waiting';
  // One silent attempt per worker per tab session: if the reload comes back
  // to the same waiting worker, keep it waiting for a quiet moment (no loops).
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
  scheduleQuietAutoUpdate();
  watchQuietMoments();
  updateListeners.forEach(listener => listener(worker));
}

// True when any visible field holds text the user typed and has not saved.
export function hasUnsavedInput(root = typeof document === 'undefined' ? null : document) {
  if (!root?.querySelectorAll) return false;
  return Array.from(root.querySelectorAll('input, textarea, select')).some((el) => {
    if (el.disabled || el.readOnly) return false;
    const type = (el.type || '').toLowerCase();
    if (['hidden', 'submit', 'button', 'reset', 'image', 'file', 'password', 'search'].includes(type)) return false;
    if (type === 'checkbox' || type === 'radio') return el.checked !== el.defaultChecked;
    if (el.tagName === 'SELECT') return Array.from(el.options || []).some(o => o.selected !== o.defaultSelected);
    return (el.value || '') !== (el.defaultValue || '');
  });
}

function canApplyQuietly(pathname) {
  return Boolean(waitingWorker)
    && !appUpdatesDeferred()
    && !isUpdateSensitivePath(pathname)
    && !isSilentUpdateSensitivePath(pathname)
    && !hasUnsavedInput();
}

let quietUpdateTimer = null;

function clearQuietUpdateTimer() {
  if (quietUpdateTimer === null) return;
  try { (window.clearTimeout || clearTimeout)(quietUpdateTimer); } catch { /* optional timer API */ }
  quietUpdateTimer = null;
}

/** Apply a waiting update when the current page is safe to replace. */
export function autoApplyWaitingUpdate() {
  try {
    if (!canApplyQuietly(window.location.pathname)) return false;
    return applyWorkerUpdate();
  } catch {
    return false;
  }
}

function scheduleQuietAutoUpdate() {
  if (quietUpdateTimer !== null || typeof window === 'undefined') return;
  try {
    if (!canApplyQuietly(window.location.pathname)) return;
  } catch {
    // A partial DOM (for example an embedded shell) should simply keep the
    // worker waiting rather than interrupting worker detection.
    return;
  }
  const schedule = window.setTimeout || setTimeout;
  quietUpdateTimer = schedule(() => {
    quietUpdateTimer = null;
    autoApplyWaitingUpdate();
  }, AUTO_APPLY_UPDATE_DELAY_MS);
  // Do not keep non-browser test runners alive solely for this best-effort
  // browser timer. Browsers ignore the Node-specific unref method.
  quietUpdateTimer?.unref?.();
}

/**
 * Apply a waiting update without asking, at moments the reload is invisible:
 * the next in-app navigation (the new page loads fresh instead of rendering
 * in place) or when the tab is hidden. Guarded workflows, sensitive paths and
 * pages with unsaved input keep the worker waiting instead.
 */
let quietWatchInstalled = false;
function watchQuietMoments() {
  if (quietWatchInstalled || typeof window === 'undefined' || typeof document === 'undefined') return;
  quietWatchInstalled = true;
  try { installQuietWatch(); } catch { /* The visible notice still works. */ }
}

function installQuietWatch() {
  const history = window.history;
  if (history && typeof history.pushState === 'function') {
    const originalPush = history.pushState.bind(history);
    history.pushState = function pushStateWithUpdate(...args) {
      const result = originalPush(...args);
      if (canApplyQuietly(window.location.pathname)) applyWorkerUpdate();
      return result;
    };
  }
  // PWA silent updates (D-446): in-app replaces (redirects, tab switches
  // that replace the entry) are quiet moments too, same as pushes.
  if (history && typeof history.replaceState === 'function') {
    const originalReplace = history.replaceState.bind(history);
    history.replaceState = function replaceStateWithUpdate(...args) {
      const result = originalReplace(...args);
      if (canApplyQuietly(window.location.pathname)) applyWorkerUpdate();
      return result;
    };
  }
  if (typeof document.addEventListener !== 'function') return;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && canApplyQuietly(window.location.pathname)) applyWorkerUpdate();
  });
}

export function applyWorkerUpdate() {
  if (!waitingWorker || appUpdatesDeferred() || isUpdateSensitivePath(window.location.pathname)) return false;
  clearQuietUpdateTimer();
  // Another tab may already have accepted this worker. This reload only ever
  // runs from the guarded quiet-apply paths (next navigation or hidden tab);
  // there is no user-facing prompt anymore.
  if (waitingWorker.state === 'activated') { reloadDocument(); return true; }
  navigator.serviceWorker.addEventListener('controllerchange', reloadDocument, { once: true });
  waitingWorker.postMessage({ type: 'SKIP_WAITING' });
  return true;
}

// PWA silent updates (D-444): open tabs discover a new release without
// waiting for a navigation. A cheap /api/version check runs on resume
// (visibilitychange/focus, throttled) and registration.update() runs on a
// 30-minute interval as a backstop, so a deploy reaches open tabs within
// 30 minutes. update() itself is a no-op when nothing changed.
export const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;
export const UPDATE_CHECK_THROTTLE_MS = 5 * 60 * 1000;
let updateChecksInstalled = false;
let lastUpdateCheckAt = 0;

async function checkForUpdate(registration) {
  const now = Date.now();
  if (now - lastUpdateCheckAt < UPDATE_CHECK_THROTTLE_MS) return;
  lastUpdateCheckAt = now;
  try {
    const res = await fetch('/api/version', { cache: 'no-store' });
    if (!res?.ok) return;
    const { buildId } = await res.json();
    const current = getServiceWorkerVersion();
    // An unversioned local build has nothing stable to compare against;
    // the interval backstop below still picks up a new worker by byte change.
    if (!buildId || !current || current === FALLBACK_RELEASE_ID) return;
    if (String(buildId) !== current) await registration.update();
  } catch {
    // The next resume or the interval retries; a failed check never prompts.
  }
}

function installUpdateChecks(registration) {
  if (updateChecksInstalled || typeof window === 'undefined' || typeof document === 'undefined') return;
  updateChecksInstalled = true;
  const check = () => { checkForUpdate(registration).catch(() => {}); };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
  window.addEventListener('focus', check);
  const interval = (window.setInterval || setInterval)(() => {
    registration.update().catch(() => {});
  }, UPDATE_CHECK_INTERVAL_MS);
  interval?.unref?.();
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
        // A fast install can reach 'waiting' before the updatefound handler
        // runs (or before this first call): registration.installing is
        // already null, the statechange listener above never fires, and
        // detectWaiting is never called again — so check the registration
        // directly too. Without this, a waiting worker the module never
        // tracks can never apply silently: the tab sits on the old release
        // until a manual refresh, and the pushState quiet-apply path does
        // nothing (CI: pwaShell test 115 timed out waiting for the reload
        // after navigating). The D-444 resume/interval update() calls hit
        // the same race.
        detectWaiting();
      };
      registration.addEventListener('updatefound', watchInstalling);
      watchInstalling();
      installUpdateChecks(registration);
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
