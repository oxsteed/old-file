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

function ignoreFailure(operation) {
  try { Promise.resolve(operation()).catch(() => {}); } catch { /* optional API */ }
}

export function setAppBadge(count) {
  if (!supportsAppBadge()) return;
  const value = Number(count);
  const n = Number.isFinite(value) ? Math.min(4294967295, Math.max(0, Math.floor(value))) : 0;
  ignoreFailure(() => n > 0 ? navigator.setAppBadge(n) :
    (typeof navigator.clearAppBadge === 'function' ? navigator.clearAppBadge() : navigator.setAppBadge(0)));
}

export function clearAppBadge() {
  if (!supportsAppBadge()) return;
  ignoreFailure(() => typeof navigator.clearAppBadge === 'function'
    ? navigator.clearAppBadge() : navigator.setAppBadge(0));
}
