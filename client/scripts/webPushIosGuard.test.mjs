// Mobile/PWA M7: subscribe() must never fire the native push permission
// prompt from an iOS Safari tab, where web push requires an installed PWA
// and a denial is permanent (no re-prompt). iOS browser mode shows the
// install coach marks instead.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

register(new URL('./esmExtensionHooks.mjs', import.meta.url));

const root = path.dirname(fileURLToPath(import.meta.url));

test('M7: iOS browser mode needs install first; installed iOS and other platforms do not', async () => {
  const guard = await import('../src/utils/pushInstallGuard.js');
  assert.equal(guard.iosNeedsInstallForPush({ isIosDevice: true, launchMode: 'browser' }), true);
  assert.equal(guard.iosNeedsInstallForPush({ isIosDevice: true, launchMode: 'standalone' }), false);
  assert.equal(guard.iosNeedsInstallForPush({ isIosDevice: true, launchMode: 'ios_standalone' }), false);
  assert.equal(guard.iosNeedsInstallForPush({ isIosDevice: false, launchMode: 'browser' }), false);
  assert.equal(guard.canRequestWebPushPermission({ isIosDevice: true, launchMode: 'browser' }), false);
  assert.equal(guard.canRequestWebPushPermission({ isIosDevice: false, launchMode: 'browser' }), true);
});

test('M7: subscribe() checks the install gate before requesting permission', () => {
  const src = fs.readFileSync(path.join(root, '../src/hooks/useWebPush.ts'), 'utf8');
  const subscribe = src.match(/const subscribe = useCallback\(async[\s\S]*?\}, \[isSupported, publicKey\]\)/);
  assert.ok(subscribe, 'useWebPush must still define subscribe()');
  assert.match(subscribe[0], /iosNeedsInstallForPush/, 'subscribe() must consult the iOS install gate');
  assert.ok(
    subscribe[0].indexOf('iosNeedsInstallForPush') < subscribe[0].indexOf('Notification.requestPermission'),
    'the install gate must run before Notification.requestPermission()',
  );
  assert.match(src, /needsInstallForPush/, 'the hook must expose needsInstallForPush to the UI');
});

test('M7: settings show install coach marks instead of the toggle on iOS Safari', () => {
  const src = fs.readFileSync(path.join(root, '../src/components/NotificationPreferences.jsx'), 'utf8');
  assert.match(src, /needsInstallForPush/, 'BrowserPushPanel must read needsInstallForPush');
  assert.match(src, /iosInstallRequired/, 'panel must show the install-first explanation');
  assert.match(src, /pwa\.iosStep1/, 'panel must show the iOS install coach-mark steps');
  for (const lang of ['en', 'es', 'fr', 'ht', 'ar']) {
    const locales = JSON.parse(fs.readFileSync(path.join(root, `../src/locales/${lang}.json`), 'utf8'));
    assert.ok(locales.notifications?.webPush?.iosInstallRequired, `missing notifications.webPush.iosInstallRequired in ${lang}`);
    assert.ok(locales.pwa?.iosTitle, `missing pwa.iosTitle in ${lang}`);
  }
});
