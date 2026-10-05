/**
 * pwaInstall.js — PWA install prompt manager
 *
 * Owns the entire install funnel:
 *  - captures `beforeinstallprompt` (always preventDefault; Chrome's
 *    auto-banner never fires on its own)
 *  - tracks install eligibility, prompt outcomes, and installs via GA4
 *  - detects launch mode (standalone / iOS standalone / homescreen / browser)
 *  - enforces dismissal discipline: 14-day suppression, two-strike max
 *  - exposes `notifyMoneyMoment()` for value-moment triggers only
 *    (paid food order, posted job, wallet top-up). Never on page load.
 *
 * UI lives in components/PwaInstallPrompt.jsx, which subscribes to this module.
 */
import { trackEvent } from './analytics';

const STORAGE_KEY = 'oxsteed:pwa-install';
const SUPPRESS_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_DISMISSALS = 2;

function readState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function writeState(next) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage is a progressive enhancement */
  }
}

const listeners = new Set();
function emit(change) {
  listeners.forEach((fn) => {
    try {
      fn(change);
    } catch {
      /* a broken subscriber must not break the funnel */
    }
  });
}

export function subscribePwaInstall(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function isIos() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function getLaunchMode() {
  if (typeof window === 'undefined') return 'ssr';
  try {
    if (window.navigator && window.navigator.standalone === true) return 'ios_standalone';
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return 'standalone';
    const params = new URLSearchParams(window.location.search);
    if (params.get('utm_source') === 'pwa_install') return 'pwa_homescreen';
  } catch {
    /* fall through to browser */
  }
  return 'browser';
}

export function isPwaInstalled() {
  if (readState().installed) return true;
  const mode = getLaunchMode();
  return mode === 'standalone' || mode === 'ios_standalone';
}

function platformLabel() {
  return isIos() ? 'ios' : 'android_desktop';
}

export function canShowPrompt() {
  const state = readState();
  if (state.installed) return false;
  if ((state.dismissals || 0) >= MAX_DISMISSALS) return false;
  if (state.suppressedUntil && Date.now() < state.suppressedUntil) return false;
  return true;
}

let deferredPrompt = null;

export function hasNativePrompt() {
  return !!deferredPrompt;
}

export function initPwaInstall() {
  if (typeof window === 'undefined') return;
  trackEvent('pwa_session_start', { launch_mode: getLaunchMode(), platform: platformLabel() });

  window.addEventListener('beforeinstallprompt', (event) => {
    // Never let the browser banner fire on its own; we prompt at money moments.
    event.preventDefault();
    deferredPrompt = event;
    trackEvent('pwa_prompt_eligible', { platform: platformLabel() });
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    writeState({ ...readState(), installed: true });
    trackEvent('pwa_installed', { launch_mode: getLaunchMode(), platform: platformLabel() });
    emit({ type: 'installed' });
  });
}

/**
 * Trigger the install UI after a value moment.
 * kind: 'food_order' | 'job_posted' | 'wallet_topup'
 * Returns true when the UI was requested.
 */
export function notifyMoneyMoment(kind) {
  if (typeof window === 'undefined') return false;
  if (!canShowPrompt()) return false;
  const native = hasNativePrompt();
  const iosCandidate = isIos() && getLaunchMode() === 'browser';
  // iOS never fires beforeinstallprompt; the coach marks are its only path.
  if (!native && !iosCandidate) return false;
  trackEvent('pwa_prompt_shown', {
    trigger: kind,
    platform: platformLabel(),
    prompt_type: native ? 'native' : 'ios_coach',
  });
  emit({ type: 'show', kind, native });
  return true;
}

function recordDismissal() {
  const state = readState();
  writeState({
    ...state,
    dismissals: (state.dismissals || 0) + 1,
    suppressedUntil: Date.now() + SUPPRESS_MS,
  });
}

/** Fire the stashed native install prompt. Returns the userChoice outcome. */
export async function promptInstall() {
  const promptEvent = deferredPrompt;
  if (!promptEvent) return 'unavailable';
  try {
    promptEvent.prompt();
    const choice = await Promise.resolve(promptEvent.userChoice).catch(() => null);
    const outcome = (choice && choice.outcome) || 'dismissed';
    trackEvent('pwa_prompt_outcome', { outcome, platform: platformLabel() });
    deferredPrompt = null;
    if (outcome === 'accepted') {
      writeState({ ...readState(), installed: true });
    } else {
      recordDismissal();
    }
    emit({ type: 'hidden' });
    return outcome;
  } catch {
    deferredPrompt = null;
    recordDismissal();
    emit({ type: 'hidden' });
    return 'dismissed';
  }
}

export function dismissPwaPrompt() {
  trackEvent('pwa_prompt_outcome', { outcome: 'dismissed_ui', platform: platformLabel() });
  recordDismissal();
  emit({ type: 'hidden' });
}
