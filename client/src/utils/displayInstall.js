// "Add to Home Screen" install-prompt helpers for the public restaurant
// display pages. iPad Safari has no Fullscreen API, so the install path is
// how a wall tablet gets a chromeless standalone display. Pure helpers take
// injected browser values so they stay unit-testable.

export const DISPLAY_INSTALL_DISMISS_KEY =
  'oxsteed:display:install-prompt-dismissed:v1';

function safeStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
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
