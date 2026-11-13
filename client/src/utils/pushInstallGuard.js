/**
 * pushInstallGuard.js — iOS web-push install gate
 *
 * On iOS, web push requires an installed PWA. Prompting for permission
 * from a plain Safari tab resolves to denial, and iOS offers no re-prompt
 * (recovery is Settings-only), so one tap permanently loses that user's
 * push channel. The native prompt must never fire from iOS browser mode;
 * the install coach marks own that moment instead (same guard shape as
 * the soft-ask in pushPrompt.js).
 */
import { isIos, getLaunchMode } from './pwaInstall';

export function iosNeedsInstallForPush({ isIosDevice, launchMode } = {}) {
  const ios = isIosDevice ?? isIos();
  const mode = launchMode ?? getLaunchMode();
  return ios && mode === 'browser';
}

export function canRequestWebPushPermission(options) {
  return !iosNeedsInstallForPush(options);
}
