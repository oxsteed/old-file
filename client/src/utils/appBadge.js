/**
 * appBadge.js — home-screen badge counts via the Badging API
 *
 * Shows a persistent "money waiting" nudge on the installed app icon
 * without spending push-permission budget. Feature-detected; no-ops
 * where unsupported. Note: Chrome on Android auto-badges from
 * notifications and ignores setAppBadge — this targets iOS 16.4+
 * and desktop PWAs.
 */

export function supportsAppBadge() {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.setAppBadge === 'function'
  );
}

export function setAppBadge(count) {
  if (!supportsAppBadge()) return;
  try {
    const n = Math.max(0, Math.floor(Number(count) || 0));
    if (n > 0) navigator.setAppBadge(n);
    else if (typeof navigator.clearAppBadge === 'function') navigator.clearAppBadge();
  } catch {
    /* badges are a progressive enhancement */
  }
}

export function clearAppBadge() {
  if (!supportsAppBadge()) return;
  try {
    if (typeof navigator.clearAppBadge === 'function') navigator.clearAppBadge();
    else navigator.setAppBadge(0);
  } catch {
    /* ignore */
  }
}
