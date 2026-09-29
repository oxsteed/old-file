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
 * Hashed Vite assets are the deployment manifest for this page. Including
 * every current script/preload in the service-worker version prevents a
 * long-lived cache from mixing an old shell with new locale chunks.
 */
export function getAssetReleaseId() {
  if (typeof document === 'undefined') return 'dev';
  const assets = Array.from(document.querySelectorAll('script[src], link[rel="modulepreload"][href]'))
    .map((element) => element.src || element.href)
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

export function registerServiceWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  const configuredVersion = import.meta.env.VITE_APP_VERSION || import.meta.env.VITE_SENTRY_RELEASE;
  const version = configuredVersion
    ? `${configuredVersion}-${getAssetReleaseId()}`
    : getAssetReleaseId();
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(version)}`, {
      updateViaCache: 'none',
    }).catch(() => {
      // Service workers are an enhancement; the application remains usable.
    });
  }, { once: true });
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
      .filter((name) => name.startsWith('oxsteed-static-'))
      .map((name) => caches.delete(name)));
  } catch {
    // Cache storage may be unavailable or restricted.
  }

  return true;
}
