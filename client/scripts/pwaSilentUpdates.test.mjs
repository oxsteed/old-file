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
  // lazyWithRetry shares the same safety instance, so the guarded-reload
  // markers behave exactly as they do in the app.
  const lazyModule = load('lazyWithRetry.js', (name) => {
    if (name === 'react') return { lazy: (fn) => fn };
    if (name === '@sentry/react') return { withScope: (fn) => fn({ setTag: () => {} }), captureException: () => {} };
    if (name === './appUpdateSafety.js') return safety;
    throw Error(`Unexpected fixture dependency ${name}`);
  });

  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    win, doc, location, history, registration, worker, sw,
    reloads, posted, updateCalls, versionFetches, intervals, timeouts,
    fireControllerChange, settle, safety, ...registrationModule, ...lazyModule,
    fireInterval: () => { for (const t of [...intervals]) t.fn(); },
    fireRegistrationEvent: (type) => {
      for (const fn of [...(regListeners.get(type) || [])]) fn();
    },
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

test('P1: the Credit page re-fetches on resume and on the balance nudge', () => {
  const page = fs.readFileSync(path.join(root, 'src/pages/food/OxsteedCreditPage.jsx'), 'utf8');
  // Same resume pattern as WalletPage (line 106 there).
  assert.match(page, /useAppResume\(\(\) => load\(\{ quiet: true \}\)\)/);
  assert.match(page, /import \{ CREDIT_BALANCE_EVENT \} from '\.\.\/\.\.\/lib\/realtime'/);
  assert.match(page, /socket\.on\(CREDIT_BALANCE_EVENT, handler\)/);
  assert.match(page, /socket\.off\(CREDIT_BALANCE_EVENT, handler\)/);
});

// ── P2: preload errors, replaceState, reconnect re-fetch ────────────────────

test('P2: vite:preloadError reloads once, guarded, and shares the marker with unhandledrejection', () => {
  const app = subject({ pathname: '/discover' });
  app.installGlobalChunkReload();
  const chunkError = () => new Error('Failed to fetch dynamically imported module');
  const preloadError = (error) => {
    const event = new Event('vite:preloadError', { cancelable: true });
    event.payload = error;
    app.win.dispatchEvent(event);
    return event;
  };

  // A non-chunk preload error is not a deploy staleness signal: no reload.
  const other = preloadError(new Error('Something else broke'));
  assert.equal(other.defaultPrevented, false);
  assert.equal(app.reloads.length, 0);

  // A chunk preload error reloads once, guarded, and prevents Vite's re-throw.
  const first = preloadError(chunkError());
  assert.equal(first.defaultPrevented, true);
  assert.equal(app.reloads.length, 1);
  assert.match(app.reloads[0], /chunk-retry=auto-global/);

  // A second preload error inside the marker window does not reload again.
  preloadError(chunkError());
  assert.equal(app.reloads.length, 1);

  // The unhandledrejection path shares the same marker: still no second reload.
  const rejection = new Event('unhandledrejection');
  rejection.reason = chunkError();
  app.win.dispatchEvent(rejection);
  assert.equal(app.reloads.length, 1);
});

test('P2: a waiting worker applies on history.replaceState too', async () => {
  // Same guarded setup as the pushState test: the worker waits while the
  // form is dirty, then applies once the page is clean and the app replaces
  // the history entry (redirects and tab switches that replace the entry).
  const dirtyInput = { tagName: 'INPUT', type: 'text', disabled: false, readOnly: false, value: 'Keep my draft', defaultValue: '' };
  const app = subject({ pathname: '/checkout', inputs: [dirtyInput] });
  app.registerServiceWorker();
  await app.settle();
  await app.settle();
  assert.equal(app.getWaitingWorker(), app.worker);
  assert.equal(app.posted.length, 0);
  app.location.href = 'https://app.invalid/discover';
  app.doc.querySelectorAll = () => [];
  app.win.history.replaceState({}, '', '/discover');
  assert.equal(app.posted.length, 1);
  assert.equal(app.posted[0].type, 'SKIP_WAITING');
  assert.equal(app.reloads.length, 0, 'reload waits for controllerchange');
  app.fireControllerChange();
  assert.equal(app.reloads.length, 1, 'the tab reloads onto the new worker once the controller changes');
});

test('P2: App re-fetches active queries after a socket reconnect', () => {
  const appJsx = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8');
  assert.match(appJsx, /import \{ subscribeSocketReconnect \} from '\.\/hooks\/useSocket'/);
  assert.match(appJsx, /subscribeSocketReconnect\(\(\) => queryClient\.invalidateQueries\(\)\)/);
});

test('P1: a worker that reaches waiting before updatefound is still tracked', async () => {
  // CI red (run 45595409891, pwaShell test 115): a fast install can reach
  // 'waiting' before the updatefound handler runs, so registration.installing
  // is already null, no statechange listener is ever attached, and the
  // module never tracks the waiting worker — the pushState quiet-apply path
  // then does nothing and the tab never reloads. The registration must be
  // checked directly when the handler runs, not only via statechange.
  const app = subject({ waiting: false });
  app.registerServiceWorker();
  await app.settle();
  await app.settle();
  assert.equal(app.getWaitingWorker(), null);
  // Simulate a user interaction so the silent window does not apply the
  // worker immediately; it must be tracked for quiet apply instead.
  app.win.dispatchEvent(new Event('input'));
  app.registration.waiting = app.worker;
  app.fireRegistrationEvent('updatefound');
  assert.equal(app.getWaitingWorker(), app.worker);
  assert.equal(app.posted.length, 0, 'tracked, not yet applied');
});
