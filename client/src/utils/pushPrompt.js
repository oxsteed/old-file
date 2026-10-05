/**
 * pushPrompt.js — push permission soft-ask manager
 *
 * Cold browser permission prompts produce permanent denials. This module
 * shows a branded soft-ask card at value moments (after first order / bid)
 * naming the exact alerts, and only fires the native prompt on "Enable".
 *
 * Discipline mirrors pwaInstall.js: 14-day suppression, two-strike max,
 * never on page load. "Later" reschedules. On iOS the soft-ask pairs with
 * the install coach marks, since iOS web push requires installed state.
 */
import { trackEvent } from './analytics';
import { isIos, getLaunchMode } from './pwaInstall';

const STORAGE_KEY = 'oxsteed:push-softask';
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

export function subscribePushPrompt(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function pushPermissionState() {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission; // 'default' | 'granted' | 'denied'
}

export function canShowPushAsk() {
  if (pushPermissionState() !== 'default') return false;
  const state = readState();
  if ((state.dismissals || 0) >= MAX_DISMISSALS) return false;
  if (state.suppressedUntil && Date.now() < state.suppressedUntil) return false;
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

/**
 * Trigger the soft-ask after a value moment.
 * kind: 'food_order' | 'job_posted' | 'bid_received'
 * The install prompt takes precedence: if it is eligible to show,
 * the push ask waits for the next value moment.
 */
export function notifyPushMoment(kind, { installEligible = false } = {}) {
  if (typeof window === 'undefined') return false;
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return false;
  if (!canShowPushAsk()) return false;
  if (installEligible) return false;
  // iOS web push needs the installed PWA; the install coach marks own that moment.
  if (isIos() && getLaunchMode() === 'browser') return false;
  trackEvent('push_softask_shown', { trigger: kind, platform: isIos() ? 'ios' : 'other' });
  emit({ type: 'show', kind });
  return true;
}

export function dismissPushAsk() {
  trackEvent('push_softask_outcome', { outcome: 'dismissed_ui' });
  recordDismissal();
  emit({ type: 'hidden' });
}

export function resolvePushAsk(outcome) {
  // outcome: 'subscribed' | 'denied' | 'dismissed'
  trackEvent('push_softask_outcome', { outcome });
  if (outcome !== 'subscribed') recordDismissal();
  else writeState({ ...readState(), subscribed: true });
  emit({ type: 'hidden' });
}
