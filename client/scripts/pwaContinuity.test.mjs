import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {
  observeAppResume,
  connectionChanged,
  connectionSnapshot,
  observeApiConnection,
  subscribeAppResume,
  refreshResumedViews,
} from '../src/utils/pwaRuntime.js';
import { observeMobileViewport } from '../src/utils/mobileViewport.js';
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
test('resume events coalesce, recheck after backgrounding, and stop cleanly', async () => {
  const win = new EventTarget(),
    doc = new EventTarget();
  win.navigator = { onLine: true };
  doc.visibilityState = 'visible';
  let clock = 0,
    calls = 0,
    release;
  connectionChanged('online');
  const coordinator = observeAppResume(
    () => {
      calls++;
      return new Promise((resolve) => (release = resolve));
    },
    { win, doc, now: () => clock },
  );
  doc.visibilityState = 'hidden';
  doc.dispatchEvent(new Event('visibilitychange'));
  clock = 2000;
  doc.visibilityState = 'visible';
  doc.dispatchEvent(new Event('visibilitychange'));
  win.dispatchEvent(new Event('focus'));
  await tick();
  assert.equal(calls, 1);
  release();
  await tick();
  win.dispatchEvent(new Event('focus'));
  await tick();
  assert.equal(calls, 1);
  win.navigator.onLine = false;
  win.dispatchEvent(new Event('offline'));
  assert.equal(connectionSnapshot().status, 'offline');
  win.navigator.onLine = true;
  win.dispatchEvent(new Event('online'));
  await tick();
  assert.equal(calls, 2);
  release();
  await tick();
  coordinator.stop();
  clock += 6000;
  win.dispatchEvent(new Event('online'));
  assert.equal(calls, 2);
});
test('failed view refreshes do not prevent other read-only subscribers from recovering', async () => {
  let reads = 0;
  const off1 = subscribeAppResume(() => {
      throw Error('unavailable');
    }),
    off2 = subscribeAppResume(() => {
      reads++;
    });
  await refreshResumedViews();
  assert.equal(reads, 1);
  off1();
  off2();
  await refreshResumedViews();
  assert.equal(reads, 1);
});
test('API observation preserves errors and distinguishes unavailable API from expired login', async () => {
  let success, failure, ejected;
  const api = {
    interceptors: {
      response: {
        use: (a, b) => {
          success = a;
          failure = b;
          return 7;
        },
        eject: (id) => (ejected = id),
      },
    },
  };
  const stop = observeApiConnection(api);
  const response = { config: { method: 'get' }, data: {} };
  assert.equal(success(response), response);
  assert.ok(connectionSnapshot().lastSynced);
  const unavailable = { response: { status: 503 } };
  await assert.rejects(failure(unavailable), (error) => error === unavailable);
  assert.equal(connectionSnapshot().status, 'offline');
  const expired = { response: { status: 401 } };
  await assert.rejects(failure(expired), (error) => error === expired);
  assert.equal(connectionSnapshot().status, 'online');
  stop();
  assert.equal(ejected, 7);
});
test('keyboard geometry respects zoom, scrolls covered controls and removes listeners', () => {
  const win = new EventTarget(),
    viewport = new EventTarget(),
    doc = new EventTarget(),
    values = {};
  win.visualViewport = viewport;
  win.innerHeight = 800;
  win.requestAnimationFrame = (fn) => {
    fn();
    return 1;
  };
  win.cancelAnimationFrame = () => {};
  viewport.height = 500;
  viewport.offsetTop = 0;
  viewport.scale = 1;
  let scrolled = 0;
  doc.activeElement = {
    matches: () => true,
    getBoundingClientRect: () => ({ top: 600, bottom: 640 }),
    scrollIntoView: () => scrolled++,
  };
  const classes = new Set();
  doc.documentElement = {
    style: {
      setProperty: (key, value) => (values[key] = value),
      removeProperty: (key) => delete values[key],
    },
    classList: {
      toggle: (key, on) => (on ? classes.add(key) : classes.delete(key)),
      remove: (key) => classes.delete(key),
    },
  };
  const stop = observeMobileViewport(win, doc);
  assert.equal(values['--pwa-keyboard-inset'], '300px');
  assert.equal(scrolled, 1);
  viewport.scale = 1.5;
  viewport.dispatchEvent(new Event('resize'));
  assert.equal(values['--pwa-keyboard-inset'], '0px');
  stop();
  assert.equal(classes.size, 0);
  viewport.dispatchEvent(new Event('resize'));
  assert.equal(Object.keys(values).length, 0);
});
test('navigation state expires, has a size bound, and is cleared on account changes', async () => {
  const storage = new Map();
  const fake = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
    key: (index) => [...storage.keys()][index],
    get length() {
      return storage.size;
    },
  };
  const previous = globalThis.sessionStorage;
  globalThis.sessionStorage = fake;
  try {
    const memory = await import('../src/utils/navigationMemory.js?unit');
    memory.setNavigationAccount('one');
    memory.saveNavigationState('jobs', { query: 'plumbing', sort: 'newest' });
    assert.equal(memory.readNavigationState('jobs').query, 'plumbing');
    memory.saveNavigationState('large', { value: 'x'.repeat(33000) });
    assert.equal(memory.readNavigationState('large'), null);
    memory.setNavigationAccount('two');
    assert.equal(memory.readNavigationState('jobs'), null);
    memory.setNavigationAccount('one');
    assert.equal(memory.readNavigationState('jobs'), null);
  } finally {
    if (previous === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = previous;
  }
});
test('asset maintenance evicts old, excessive and oversized entries without touching another cache', async () => {
  const buckets = new Map(),
    listeners = {};
  const make = () => {
    const rows = new Map();
    return {
      rows,
      match: async (request) => rows.get(request.url)?.clone(),
      put: async (request, response) => rows.set(request.url, response.clone()),
      keys: async () => [...rows.keys()].map((url) => new Request(url)),
      delete: async (request) => rows.delete(request.url),
    };
  };
  const caches = {
    open: async (name) => {
      if (!buckets.has(name)) buckets.set(name, make());
      return buckets.get(name);
    },
  };
  const context = vm.createContext({
    URL,
    Request,
    Response,
    Headers,
    Date,
    Promise,
    caches,
    self: {
      location: {
        href: 'https://app.test/sw.js?v=unit',
        origin: 'https://app.test',
      },
      addEventListener: (name, handler) => (listeners[name] = handler),
    },
  });
  vm.runInContext(
    fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'),
    context,
  );
  const assets = await caches.open('oxsteed-assets-v2'),
    meta = await caches.open('oxsteed-asset-meta-v2'),
    other = await caches.open('other-app');
  const now = Date.now();
  for (let i = 0; i < 5; i++) {
    const request = new Request(`https://app.test/assets/chunk-${i}ABCDEFG.js`);
    await assets.put(request, new Response('asset'));
    await meta.put(
      request,
      new Response(JSON.stringify({ bytes: 20, lastUsed: now - i * 1000 })),
    );
  }
  const old = new Request('https://app.test/assets/old-ABCDEFGH.js');
  await assets.put(old, new Response('old'));
  await meta.put(old, new Response(JSON.stringify({ bytes: 1, lastUsed: 0 })));
  await other.put(old, new Response('other'));
  await context.pruneAssetCache(2, 45);
  assert.equal((await assets.keys()).length, 2);
  assert.equal((await meta.keys()).length, 2);
  assert.equal(await (await other.match(old)).text(), 'other');
  assert.ok(
    await assets.match(
      new Request('https://app.test/assets/chunk-0ABCDEFG.js'),
    ),
  );
});
