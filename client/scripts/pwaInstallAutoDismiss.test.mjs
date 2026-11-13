// Mobile/PWA M3: the install prompt's 8s auto-dismiss must not burn one of
// the user's two lifetime install chances. Auto-hide only hides the banner;
// only an explicit "Not now" tap counts as a dismissal.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

register(new URL('./esmExtensionHooks.mjs', import.meta.url));

const root = path.dirname(fileURLToPath(import.meta.url));
const STORAGE_KEY = 'oxsteed:pwa-install';

function installMemoryStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
  };
  return store;
}

function readDismissals(store) {
  const raw = store.get(STORAGE_KEY);
  if (!raw) return 0;
  return JSON.parse(raw).dismissals || 0;
}

test('M3: auto-hide does not record a dismissal', async () => {
  const store = installMemoryStorage();
  const pwa = await import('../src/utils/pwaInstall.js');
  assert.equal(typeof pwa.hidePwaPrompt, 'function', 'pwaInstall must export hidePwaPrompt for the auto-hide path');
  assert.equal(pwa.canShowPrompt(), true);

  let seen = null;
  pwa.subscribePwaInstall((change) => { seen = change; });
  pwa.hidePwaPrompt();

  assert.equal(readDismissals(store), 0, 'auto-hide must not burn an install chance');
  assert.equal(pwa.canShowPrompt(), true, 'prompt must stay eligible after an auto-hide');
  assert.equal(seen?.type, 'hidden');
});

test('M3: explicit dismissal still records exactly one strike', async () => {
  const store = installMemoryStorage();
  const pwa = await import('../src/utils/pwaInstall.js');
  pwa.dismissPwaPrompt();
  assert.equal(readDismissals(store), 1, 'explicit "Not now" must count as a dismissal');
  assert.equal(pwa.canShowPrompt(), false, 'dismissal suppresses the prompt for 14 days');
});

test('M3: the 8s timer in PwaInstallPrompt hides instead of dismissing', () => {
  const src = fs.readFileSync(path.join(root, '../src/components/PwaInstallPrompt.jsx'), 'utf8');
  const timer = src.match(/setTimeout\(\(\) => \{([\s\S]*?)\}, AUTO_DISMISS_MS\)/);
  assert.ok(timer, 'PwaInstallPrompt must still auto-hide on a timer');
  assert.match(timer[1], /hidePwaPrompt\(\)/, 'auto-hide timer must call hidePwaPrompt');
  assert.doesNotMatch(timer[1], /dismissPwaPrompt\(\)/, 'auto-hide timer must not call dismissPwaPrompt');
  assert.match(src, /dismissPwaPrompt\(\)/, 'explicit "Not now" must still dismiss');
});
