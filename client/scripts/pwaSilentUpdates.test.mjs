// PWA silent updates (PR #809): no refresh prompt, ever; waiting workers
// apply on the next in-app navigation or when the tab is hidden, guarded by
// appUpdateSafety; open tabs discover new versions via registration.update()
// on resume and on a 30-minute interval.
//
// Run: node --test scripts/pwaSilentUpdates.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function storageFake(store = new Map()) {
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
}

function subject({
  pathname = '/discover',
  inputs = [],
  buildId = 'test-build-1',
  versionBuildId = 'test-build-2',
  waiting = true,
} = {}) {
  const win = new EventTarget();
  const doc = new EventTarget();
  const store = new Map();
  const sessionStore = new Map();
  const reloads = [];
  const posted = [];
  const updateCalls = [];
  const versionFetches = [];
  const intervals = [];
  const timeouts = [];
  let timerId = 0;

  const location = {
    href: `https://app.invalid${pathname}`,
    get pathname() { return new URL(this.href).pathname; },
    reload: () => reloads.push(location.href),
    replace: (url) => reloads.push(String(url)),
  };
  const history = {
    pushState: (_state, _title, url) => {
      if (url) location.href = new URL(url, location.href).href;
    },
    replaceState: (_state, _title, url) => {
      if (url) location.href = new URL(url, location.href).href;
    },
  };
  win.location = location;
  win.history = history;
  win.sessionStorage = storageFake(sessionStore);
  win.localStorage = storageFake(store);
  win.setTimeout = (fn, ms) => { const id = ++timerId; timeouts.push({ id, fn, ms }); return id; };
  win.clearTimeout = (id) => { const i = timeouts.findIndex((t) => t.id === id); if (i >= 0) timeouts.splice(i, 1); };
  win.setInterval = (fn, ms) => { const id = ++timerId; intervals.push({ id, fn, ms }); return id; };
  win.clearInterval = (id) => { const i = intervals.findIndex((t) => t.id === id); if (i >= 0) intervals.splice(i, 1); };
  win.navigator = { onLine: true };
  Object.defineProperty(doc, 'readyState', { value: 'complete' });
  Object.defineProperty(doc, 'visibilityState', { value: 'visible', writable: true, configurable: true });
  doc.querySelectorAll = () => inputs;

  const swListeners = new Map();
  const sw = {
    controller: {},
    addEventListener: (type, fn) => {
      if (!swListeners.has(type)) swListeners.set(type, new Set());
      swListeners.get(type).add(fn);
    },
    removeEventListener: (type, fn) => swListeners.get(type)?.delete(fn),
    register: async () => registration,
  };
  win.navigator.serviceWorker = sw;
  const fireControllerChange = () => {
    for (const fn of [...(swListeners.get('controllerchange') || [])]) fn();
  };

  const worker = {
    scriptURL: 'https://app.invalid/sw.js?v=test-build-1',
    state: 'waiting',
    postMessage: (msg) => posted.push(msg),
  };
  const regListeners = new Map();
  const registration = {
    waiting: waiting ? worker : null,
    installing: null,
    addEventListener: (type, fn) => {
      if (!regListeners.has(type)) regListeners.set(type, new Set());
      regListeners.get(type).add(fn);
    },
    update: async () => { updateCalls.push(Date.now()); return registration; },
  };
  sw.register = async () => registration;

  const fetchFake = async (url) => {
    versionFetches.push(String(url));
    return { ok: true, json: async () => ({ buildId: versionBuildId }) };
  };

  const context = {
    window: win,
    document: doc,
    navigator: win.navigator,
    location,
    sessionStorage: win.sessionStorage,
    localStorage: win.localStorage,
    setTimeout: win.setTimeout,
    clearTimeout: win.clearTimeout,
    setInterval: win.setInterval,
    clearInterval: win.clearInterval,
    fetch: fetchFake,
    URL,
    Date,
    Event,
  };

  function load(file, require) {
    const module = { exports: {} };
    const code = transformSync(fs.readFileSync(new URL(`../src/utils/${file}`, import.meta.url), 'utf8'), {
      format: 'cjs',
      define: { 'import.meta.env': JSON.stringify({ VITE_APP_BUILD_ID: buildId }) },
    }).code;
    vm.runInNewContext(code, { module, exports: module.exports, require, ...context });
    return module.exports;
  }
  const safety = load('appUpdateSafety.js');
  const registrationModule = load('serviceWorkerRegistration.js', (name) => {
    if (name === './appUpdateSafety.js') return safety;
    throw Error(`Unexpected fixture dependency ${name}`);
  });

  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    win, doc, location, history, registration, worker, sw,
    reloads, posted, updateCalls, versionFetches, intervals, timeouts,
    fireControllerChange, settle, ...registrationModule,
    fireInterval: () => { for (const t of [...intervals]) t.fn(); },
    dispatchVisibility: (state) => {
      doc.visibilityState = state;
      doc.dispatchEvent(new Event('visibilitychange'));
    },
    dispatchFocus: () => win.dispatchEvent(new Event('focus')),
  };
}

// ── P0: the refresh prompt is gone ──────────────────────────────────────────

test('P0: the update notice component, its mounts and its strings are gone', () => {
  assert.equal(fs.existsSync(path.join(root, 'src/components/ServiceWorkerUpdateNotice.jsx')), false);
  for (const entry of ['src/main.jsx', 'src/admin/main.jsx']) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, entry), 'utf8'), /ServiceWorkerUpdateNotice/);
  }
  const removed = ['updateReady', 'later', 'refresh', 'updating'];
  for (const lang of ['en', 'es', 'fr', 'ht', 'ar']) {
    const catalog = JSON.parse(fs.readFileSync(path.join(root, `src/locales/${lang}.json`), 'utf8'));
    assert.deepEqual(Object.keys(catalog.pwaShell).sort(), ['shareError', 'sharedReady']);
    for (const key of removed) assert.equal(`pwaShell.${key}` in catalog, false, `${lang} still has ${key}`);
  }
  // No source file still references the notice or its strings (this test
  // file itself is the exception: it asserts the removal).
  const self = fileURLToPath(import.meta.url);
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'generated' ? [] : walk(p);
    return [p];
  });
  for (const file of [...walk(path.join(root, 'src')), ...walk(path.join(root, 'scripts'))]) {
    if (file === self) continue;
    if (!/\.(jsx?|mjs|cjs)$/.test(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /ServiceWorkerUpdateNotice/, file);
    assert.doesNotMatch(text, /pwaShell\.(updateReady|later|refresh|updating)/, file);
  }
});

test('P0: a waiting worker on a guarded page shows no banner and applies after navigating away', async () => {
  const dirtyInput = { tagName: 'INPUT', type: 'text', disabled: false, readOnly: false, value: 'Keep my draft', defaultValue: '' };
  const app = subject({ pathname: '/checkout', inputs: [dirtyInput] });
  app.registerServiceWorker();
  await app.settle();
  await app.settle();
  // The waiting worker is tracked but nothing reloads and nothing is posted
  // while the page is guarded (sensitive path + unsaved input).
  assert.equal(app.getWaitingWorker(), app.worker);
  assert.equal(app.reloads.length, 0);
  assert.equal(app.posted.length, 0);

  // Leaving the guarded form: the new page has no dirty input, and the
  // in-app navigation applies the waiting worker silently.
  app.location.href = 'https://app.invalid/discover';
  app.doc.querySelectorAll = () => [];
  app.win.history.pushState({}, '', '/discover');
  assert.equal(app.posted.length, 1);
  assert.equal(app.posted[0].type, 'SKIP_WAITING');
  assert.equal(app.reloads.length, 0, 'reload waits for controllerchange');
  app.fireControllerChange();
  assert.equal(app.reloads.length, 1, 'the tab reloads onto the new worker once the controller changes');
});

test('P0: a waiting worker on a guarded page applies when the tab is hidden', async () => {
  const dirtyInput = { tagName: 'INPUT', type: 'text', disabled: false, readOnly: false, value: 'Keep my draft', defaultValue: '' };
  const app = subject({ pathname: '/checkout', inputs: [dirtyInput] });
  app.registerServiceWorker();
  await app.settle();
  await app.settle();
  assert.equal(app.getWaitingWorker(), app.worker);
  assert.equal(app.posted.length, 0);
  // The tab hides while still guarded: nothing applies.
  app.dispatchVisibility('hidden');
  assert.equal(app.posted.length, 0);
  // The user saves (input clean) and the tab hides again: the worker applies.
  app.doc.querySelectorAll = () => [];
  app.location.href = 'https://app.invalid/discover';
  app.dispatchVisibility('hidden');
  assert.equal(app.posted.length, 1);
  assert.equal(app.posted[0].type, 'SKIP_WAITING');
  app.fireControllerChange();
  assert.equal(app.reloads.length, 1);
});

// ── P1: open tabs find new versions ─────────────────────────────────────────

test('P1: update() is called on resume when the server build differs', async () => {
  const app = subject({ waiting: false, versionBuildId: 'test-build-2' });
  app.registerServiceWorker();
  await app.settle();
  await app.settle();
  assert.equal(app.updateCalls.length, 0);
  app.dispatchVisibility('visible');
  await app.settle();
  await app.settle();
  assert.deepEqual(app.versionFetches, ['/api/version']);
  assert.equal(app.updateCalls.length, 1, 'a different server build triggers registration.update()');
  // A second resume inside the throttle window does not check again.
  app.dispatchFocus();
  await app.settle();
  await app.settle();
  assert.equal(app.versionFetches.length, 1);
  assert.equal(app.updateCalls.length, 1);
});

test('P1: no update() when the server build matches', async () => {
  const app = subject({ waiting: false, versionBuildId: 'test-build-1' });
  app.registerServiceWorker();
  await app.settle();
  await app.settle();
  app.dispatchVisibility('visible');
  await app.settle();
  await app.settle();
  assert.equal(app.versionFetches.length, 1);
  assert.equal(app.updateCalls.length, 0);
});

test('P1: update() runs on the 30-minute interval as a backstop', async () => {
  const app = subject({ waiting: false });
  app.registerServiceWorker();
  await app.settle();
  await app.settle();
  assert.equal(app.intervals.length, 1);
  assert.equal(app.intervals[0].ms, 30 * 60 * 1000);
  assert.equal(app.updateCalls.length, 0);
  app.fireInterval();
  assert.equal(app.updateCalls.length, 1);
});
