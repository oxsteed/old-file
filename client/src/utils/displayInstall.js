// "Add to Home Screen" install-prompt helpers for the public restaurant
// display pages. iPad Safari has no Fullscreen API, so the install path is
// how a wall tablet gets a chromeless standalone display. Pure helpers take
// injected browser values so they stay unit-testable.

export const DISPLAY_INSTALL_DISMISS_KEY =
  'oxsteed:display:install-prompt-dismissed:v1';
export const DISPLAY_INSTALL_DESTINATION_KEY =
  'oxsteed:display:install-destination:v1';

// Only real display routes are restorable: queue board, kiosk, and kitchen
// screens under /restaurants or /food. Anything else is never a restore
// target, so a stale or tampered value can never bounce the app elsewhere.
const DISPLAY_ROUTE_PATTERN = /^\/(restaurants|food)\/(queue|kiosk|kitchen)\/\d+$/;

function safeStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/**
 * True for a valid display route path, e.g. /restaurants/kitchen/42.
 */
export function isValidDisplayRoutePath(path) {
  return typeof path === 'string' && DISPLAY_ROUTE_PATTERN.test(path);
}

// Captures (displayType, restaurantId) from a display route path.
const DISPLAY_ROUTE_CAPTURE = /^\/(?:restaurants|food)\/(queue|kiosk|kitchen)\/(\d+)$/;

/**
 * Parses a display route path into { path, displayType, restaurantId }, or
 * null when the path is not a display route.
 */
export function parseDisplayRoutePath(path) {
  if (typeof path !== 'string') return null;
  const match = DISPLAY_ROUTE_CAPTURE.exec(path);
  if (!match) return null;
  return { path, displayType: match[1], restaurantId: match[2] };
}

/**
 * Builds the install-specific manifest URL used by display pages. The server
 * validates this path and returns a manifest whose start_url points directly
 * at the display, so iPad Home Screen installs do not depend on localStorage
 * being copied from Safari.
 */
export function displayManifestHref(path, baseHref = '/manifest.json') {
  if (!isValidDisplayRoutePath(path)) return baseHref;
  const separator = baseHref.includes('?') ? '&' : '?';
  return `${baseHref}${separator}display_start_url=${encodeURIComponent(path)}`;
}

/**
 * Persist where this installed display should land on next launch.
 * Returns true when saved; refuses (returns false) for invalid routes.
 * `restaurantId` and `displayType` ride along for future use but the
 * restore path itself is the authority.
 */
export function saveDisplayInstallDestination(
  { path, restaurantId, displayType } = {},
  storage = safeStorage(),
) {
  if (!isValidDisplayRoutePath(path)) return false;
  try {
    storage?.setItem(
      DISPLAY_INSTALL_DESTINATION_KEY,
      JSON.stringify({ path, restaurantId: restaurantId ?? null, displayType: displayType ?? null }),
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the saved destination, or null when absent, unparseable, or not a
 * valid display route.
 */
export function readDisplayInstallDestination(storage = safeStorage()) {
  try {
    const raw = storage?.getItem(DISPLAY_INSTALL_DESTINATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !isValidDisplayRoutePath(parsed.path)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Startup redirect decision: pure, injected values. Returns the destination
 * path to restore, or null when nothing should happen.
 *
 * Only redirects an installed standalone display that launched at a bare
 * start_url ('/' or '/restaurants') with a saved valid display route.
 * Never redirects in a regular browser tab, never to non-display routes.
 */
export function resolveDisplayInstallRedirect({ standalone, pathname, storage } = {}) {
  if (!standalone) return null;
  if (pathname !== '/' && pathname !== '/restaurants') return null;
  const saved = readDisplayInstallDestination(storage);
  return saved ? saved.path : null;
}

/**
 * True when the page already runs as an installed standalone app.
 * `matchMedia` and `standalone` are injected (real browser values in the
 * component, fakes in tests).
 */
export function detectDisplayStandalone({ matchMedia, standalone } = {}) {
  try {
    if (typeof matchMedia === 'function') {
      const query = matchMedia('(display-mode: standalone)');
      if (query && query.matches) return true;
    }
  } catch {
    // matchMedia can throw in some embedded webviews; fall through.
  }
  return standalone === true;
}

export function readInstallPromptDismissed(storage = safeStorage()) {
  try {
    return storage ? storage.getItem(DISPLAY_INSTALL_DISMISS_KEY) === '1' : false;
  } catch {
    return false;
  }
}

export function writeInstallPromptDismissed(storage = safeStorage()) {
  try {
    storage?.setItem(DISPLAY_INSTALL_DISMISS_KEY, '1');
  } catch {
    // Private browsing or disabled storage: the prompt just shows again.
  }
}

/**
 * Show the prompt once: never when already installed, never after the user
 * dismissed it. No nagging.
 */
export function shouldShowInstallPrompt({ dismissed, standalone }) {
  return !dismissed && !standalone;
}

/** iPadOS desktop user agents need touch detection; exclude iOS webviews. */
export function isIpadSafari({ userAgent = '', platform = '', maxTouchPoints = 0 } = {}) {
  const ipad = /iPad/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
  return ipad && /Safari/.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(userAgent);
}
