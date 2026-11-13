// Mobile/PWA M12: a single owner for the one-shot beforeinstallprompt
// event. pwaInstall.js owns the capture; DisplayInstallPrompt subscribes
// to its state instead of adding a second listener. The loser of the old
// race recorded a phantom dismissal in promptInstall's catch block.
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

function installWindowStub() {
  const listeners = new Map();
  globalThis.window = {
    location: { pathname: '/', search: '' },
    navigator: { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120', standalone: undefined },
    matchMedia: () => ({ matches: false }),
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
  };
  // Node 24 exposes a getter-only global navigator; define it instead.
  Object.defineProperty(globalThis, 'navigator', {
    value: globalThis.window.navigator,
    configurable: true,
    writable: true,
  });
  return listeners;
}

function readDismissals(store) {
  const raw = store.get(STORAGE_KEY);
  if (!raw) return 0;
  return JSON.parse(raw).dismissals || 0;
}

test('M12: capture notifies subscribers and state is readable', async () => {
  installMemoryStorage();
  const listeners = installWindowStub();
  const pwa = await import('../src/utils/pwaInstall.js');
  assert.equal(typeof pwa.getPwaInstallState, 'function', 'pwaInstall must expose getPwaInstallState');

  const seen = [];
  pwa.subscribePwaInstall((change) => seen.push(change));
  pwa.initPwaInstall();

  const fakeEvent = {
    preventDefault() { this.defaultPrevented = true; },
    prompt() {},
    userChoice: Promise.resolve({ outcome: 'accepted' }),
  };
  listeners.get('beforeinstallprompt')(fakeEvent);
  assert.equal(fakeEvent.defaultPrevented, true, 'native banner must stay suppressed');
  assert.equal(pwa.hasNativePrompt(), true);
  assert.equal(pwa.getPwaInstallState().hasNativePrompt, true);
  assert.equal(pwa.getPwaInstallState().canShowPrompt, true);
  assert.ok(seen.some((c) => c.type === 'eligible'), 'subscribers must learn the prompt became available');
});

test('M12: a consumed prompt event is not a dismissal', async () => {
  const store = installMemoryStorage();
  const listeners = installWindowStub();
  const pwa = await import('../src/utils/pwaInstall.js');
  pwa.initPwaInstall();

  // The event was already consumed by another flow: prompt() throws.
  const consumedEvent = {
    preventDefault() {},
    prompt() { throw new Error('prompt already consumed'); },
    userChoice: Promise.resolve({ outcome: 'dismissed' }),
  };
  listeners.get('beforeinstallprompt')(consumedEvent);
  const outcome = await pwa.promptInstall();

  assert.equal(outcome, 'unavailable', 'a throwing prompt must report unavailable, not a user dismissal');
  assert.equal(readDismissals(store), 0, 'a phantom dismissal must not burn an install chance');
  assert.equal(pwa.canShowPrompt(), true, 'funnel must stay eligible after a consumed event');
});

test('M12: DisplayInstallPrompt subscribes instead of capturing the event', () => {
  const src = fs.readFileSync(path.join(root, '../src/components/DisplayInstallPrompt.jsx'), 'utf8');
  assert.doesNotMatch(src, /addEventListener\('beforeinstallprompt'/, 'display prompt must not add its own beforeinstallprompt listener');
  assert.doesNotMatch(src, /setDeferredPrompt\(event\)/, 'display prompt must not stash its own copy of the event');
  assert.match(src, /subscribePwaInstall/, 'display prompt must subscribe to pwaInstall state');
  assert.match(src, /hasNativePrompt\(\)/, 'display prompt must read native availability from pwaInstall');
  assert.match(src, /promptInstall\(\)/, 'display prompt must fire the shared promptInstall');
  const pwaSrc = fs.readFileSync(path.join(root, '../src/utils/pwaInstall.js'), 'utf8');
  const catchBlock = pwaSrc.match(/catch \{([\s\S]*?)\}\n\}/);
  assert.ok(catchBlock, 'promptInstall must still handle a throwing prompt');
  assert.doesNotMatch(catchBlock[1], /recordDismissal/, 'promptInstall catch must not record a dismissal');
});
