import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

function subject({ href = 'https://app.invalid/discover', online = true, brokenStorage = false, store = new Map() } = {}) {
  const win = new EventTarget(), reloads = [];
  const listenerSets = new Map();
  const add = win.addEventListener.bind(win), remove = win.removeEventListener.bind(win);
  win.addEventListener = (type, listener, ...args) => {
    if (!listenerSets.has(type)) listenerSets.set(type, new Set());
    listenerSets.get(type).add(listener); add(type, listener, ...args);
  };
  win.removeEventListener = (type, listener, ...args) => {
    listenerSets.get(type)?.delete(listener); remove(type, listener, ...args);
  };
  win.navigator = { onLine: online };
  win.location = { href, get pathname() { return new URL(this.href).pathname; }, replace: url => reloads.push(url) };
  Object.defineProperty(win, 'sessionStorage', { get() {
    if (brokenStorage) throw Error('Synthetic blocked storage');
    return { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) };
  } });
  function load(file, require) {
    const module = { exports: {} };
    const code = transformSync(fs.readFileSync(new URL(`../src/utils/${file}`, import.meta.url), 'utf8'), {
      format: 'cjs', define: { 'import.meta.env': JSON.stringify({ VITE_APP_VERSION: 'synthetic' }) },
    }).code;
    vm.runInNewContext(code, { module, exports: module.exports, require, window: win, URL, Date });
    return module.exports;
  }
  const safety = load('appUpdateSafety.js');
  const lazy = load('lazyWithRetry.js', name => {
    if (name === 'react') return { lazy: loader => loader };
    if (name === '@sentry/react') return { withScope: fn => fn({ setTag() {}, setExtra() {} }), captureException() {} };
    if (name === './appUpdateSafety.js') return safety;
    throw Error(`Unexpected fixture dependency ${name}`);
  });
  return { win, reloads, store, safety, listeners: type => listenerSets.get(type)?.size || 0, ...lazy };
}
const failure = () => Error('Importing a module script failed');
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test('unload and explicit worker reload fence failures from the departing document', async () => {
  for (const event of ['beforeunload', 'pagehide', 'explicit-update']) {
    const app = subject();
    let reject;
    const loading = app.lazyWithRetry(() => new Promise((_, fail) => { reject = fail; }))();
    const result = loading.catch(error => error);
    if (event === 'explicit-update') app.safety.markDocumentLeaving(); else app.win.dispatchEvent(new Event(event));
    reject(failure());
    await settle();
    assert.equal(app.reloads.length, 0, event);
    assert.match((await result).message, /module script/);
  }
});

test('an abandoned SPA route cannot reload the destination chosen afterward', async () => {
  const app = subject();
  let reject;
  const loading = app.lazyWithRetry(() => new Promise((_, fail) => { reject = fail; }))();
  const result = loading.catch(error => error);
  app.win.location.href = 'https://app.invalid/business/4/workspace';
  reject(failure());
  await settle();
  assert.equal(app.reloads.length, 0);
  assert.match((await result).message, /module script/);
});

test('a newly replaced document cannot immediately start a competing automatic reload', async () => {
  const before = subject();
  before.safety.markDocumentLeaving();
  const after = subject({ store: before.store });
  const result = after.lazyWithRetry(async () => { throw failure(); })().catch(error => error);
  await settle();
  assert.equal(after.reloads.length, 0);
  assert.match((await result).message, /module script/);
});

test('unload observation is shared by pending imports and released after they settle', async () => {
  const app = subject();
  let first, second;
  const one = app.lazyWithRetry(() => new Promise(resolve => { first = resolve; }))();
  const two = app.lazyWithRetry(() => new Promise(resolve => { second = resolve; }))();
  assert.equal(app.listeners('beforeunload'), 1);
  first({ default: null }); await one;
  assert.equal(app.listeners('beforeunload'), 1);
  second({ default: null }); await two;
  assert.equal(app.listeners('beforeunload'), 0);
});

test('offline, protected workflows and unavailable storage preserve the document for explicit recovery', async () => {
  for (const options of [{ online: false }, { brokenStorage: true }, { href: 'https://app.invalid/post-job' }, { href: 'https://app.invalid/restaurants/r/42' }, { guarded: true }]) {
    const app = subject(options);
    const release = options.guarded ? app.safety.deferAppUpdates() : () => {};
    const result = app.lazyWithRetry(async () => { throw failure(); })().catch(error => error);
    await settle();
    assert.equal(app.reloads.length, 0, JSON.stringify(options));
    assert.match((await result).message, /module script/);
    release();
  }
});

test('a safe missing chunk gets one durable attempt, shared with global failure handling', async () => {
  const app = subject();
  app.installGlobalChunkReload();
  void app.lazyWithRetry(async () => { throw failure(); })();
  await settle();
  assert.equal(app.reloads.length, 1);
  const event = new Event('unhandledrejection', { cancelable: true });
  Object.defineProperty(event, 'reason', { value: failure() });
  app.win.dispatchEvent(event);
  assert.equal(app.reloads.length, 1);
  const nextDocument = subject({ store: app.store });
  await assert.rejects(nextDocument.lazyWithRetry(async () => { throw failure(); })(), /module script/);
  assert.equal(nextDocument.reloads.length, 0);
});

test('a successful sibling cannot erase the failed-route attempt and create a reload loop', async () => {
  const app = subject();
  let finishSibling;
  const sibling = app.lazyWithRetry(() => new Promise(resolve => { finishSibling = resolve; }))();
  void app.lazyWithRetry(async () => { throw failure(); })();
  await settle();
  assert.equal(app.reloads.length, 1);
  finishSibling({ default: null }); await sibling;
  const next = subject({ store: app.store });
  const rejected = next.lazyWithRetry(async () => { throw failure(); })();
  // Attach the rejection handler immediately; a passing result must reject
  // into the existing recovery UI rather than leave a second reload pending.
  const result = rejected.then(() => null, error => error);
  await settle();
  assert.equal(next.reloads.length, 0);
  assert.match((await result).message, /module script/);
});

test('global imports respect the same offline, editing and departure guards', () => {
  for (const options of [{ online: false }, { brokenStorage: true }, { guarded: true }, { leaving: true }]) {
    const app = subject(options);
    app.installGlobalChunkReload();
    const release = options.guarded ? app.safety.deferAppUpdates() : () => {};
    if (options.leaving) app.win.dispatchEvent(new Event('pagehide'));
    const event = new Event('unhandledrejection', { cancelable: true });
    Object.defineProperty(event, 'reason', { value: failure() });
    app.win.dispatchEvent(event);
    assert.equal(app.reloads.length, 0);
    assert.equal(event.defaultPrevented, false);
    release();
  }
});

test('BFCache restore permits safe recovery and a user can explicitly reload without storage', async () => {
  const app = subject();
  app.lazyWithRetry(async () => ({ default: null }));
  app.win.dispatchEvent(new Event('pagehide'));
  const restored = new Event('pageshow'); Object.defineProperty(restored, 'persisted', { value: true });
  app.win.dispatchEvent(restored);
  void app.lazyWithRetry(async () => { throw failure(); })();
  await settle();
  assert.equal(app.reloads.length, 1);
  const restricted = subject({ brokenStorage: true });
  restricted.forceChunkReload();
  assert.match(restricted.reloads[0], /chunk-retry=manual/);
});
