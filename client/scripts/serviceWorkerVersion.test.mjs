import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const moduleUrl = new URL('../src/utils/serviceWorkerRegistration.js', import.meta.url);
let importCount = 0;
const freshModule = () => import(`${moduleUrl.href}?case=${importCount += 1}`);

function element(tag, attrs) {
  return { tagName: tag, getAttribute: (name) => attrs[name] ?? null, ...attrs };
}

// A tiny DOM that answers the selectors the real browser would. Runtime
// Vite preloads are `link[rel=modulepreload]`; lazy CSS is `link[rel=stylesheet]`.
function fakeDocument(nodes) {
  return {
    readyState: 'complete',
    querySelectorAll(selector) {
      if (selector === 'script[type="module"][src]') return nodes.filter((n) => n.tagName === 'script' && n.type === 'module' && n.src);
      if (selector === 'script[src]') return nodes.filter((n) => n.tagName === 'script' && n.src);
      if (selector.includes('modulepreload')) return nodes.filter((n) => n.tagName === 'link' && n.rel === 'modulepreload');
      throw new Error(`unexpected selector ${selector}`);
    },
  };
}

const entry = element('script', { type: 'module', src: '/assets/index-Ab12Cd34.js' });
const staticPreload = element('link', { rel: 'modulepreload', href: '/assets/react-vendor-Zz11.js' });
const routes = {
  home: [entry, staticPreload, element('link', { rel: 'modulepreload', href: '/assets/HomePage-111.js' })],
  job: [entry, staticPreload, element('link', { rel: 'modulepreload', href: '/assets/JobDetail-222.js' }), element('link', { rel: 'modulepreload', href: '/assets/maplibre-vendor-333.js' })],
  dashboard: [entry, staticPreload, element('link', { rel: 'modulepreload', href: '/assets/Dashboard-444.js' })],
};

function withDom(nodes, run) {
  const saved = { document: globalThis.document, window: globalThis.window };
  globalThis.document = fakeDocument(nodes);
  globalThis.window = { location: { origin: 'https://oxsteed.com' } };
  try { return run(); } finally { Object.assign(globalThis, saved); }
}

test('the same build yields the same service-worker URL on every landing route', async () => {
  const mod = await freshModule();
  const urls = Object.values(routes).map((nodes) => withDom(nodes, () => mod.getServiceWorkerUrl()));
  assert.equal(new Set(urls).size, 1, urls.join(' vs '));
  assert.match(urls[0], /^\/sw\.js\?v=assets-[0-9a-f]+$/);
  const ids = Object.values(routes).map((nodes) => withDom(nodes, () => mod.getAssetReleaseId()));
  assert.equal(new Set(ids).size, 1);
});

test('a new entry bundle (a real deployment) changes the fallback version', async () => {
  const mod = await freshModule();
  const before = withDom(routes.home, () => mod.getServiceWorkerVersion());
  const after = withDom([element('script', { type: 'module', src: '/assets/index-Ef56Gh78.js' }), ...routes.home.slice(1)], () => mod.getServiceWorkerVersion());
  assert.notEqual(before, after);
  assert.equal(withDom([], () => mod.getServiceWorkerVersion()), 'dev');
});

test('production builds inject one build id for every entry and route', async () => {
  const config = fs.readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');
  assert.match(config, /__APP_BUILD_ID__: JSON\.stringify\(/);
  const { resolveBuildId } = await import(new URL('../vite.config.js', import.meta.url).href);
  assert.equal(resolveBuildId({ VITE_APP_VERSION: ' rel-1 ', COMMIT_SHA: 'abc' }, () => 'git'), 'rel-1');
  assert.equal(resolveBuildId({ COMMIT_SHA: 'abc123' }, () => 'git'), 'abc123');
  assert.equal(resolveBuildId({}, () => 'deadbeef'), 'deadbeef');
  assert.equal(resolveBuildId({}, () => ''), '');
});

function fakeServiceWorkerEnv({ marker = null } = {}) {
  const listeners = {};
  const posted = [];
  const announced = [];
  const store = new Map(marker ? [['oxsteed:sw-silent-update', marker]] : []);
  const worker = { scriptURL: 'https://oxsteed.com/sw.js?v=build-2', state: 'installed', postMessage: (msg) => posted.push(msg) };
  const registration = { waiting: worker, installing: null, addEventListener() {} };
  const saved = {};
  for (const key of ['window', 'document', 'navigator', 'sessionStorage', 'localStorage']) saved[key] = Object.getOwnPropertyDescriptor(globalThis, key);
  const define = (key, value) => Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  let reloads = 0;
  define('window', {
    location: { origin: 'https://oxsteed.com', reload: () => { reloads += 1; } },
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
    removeEventListener: (type, fn) => { listeners[type] = (listeners[type] || []).filter((f) => f !== fn); },
  });
  define('document', fakeDocument(routes.home));
  define('sessionStorage', { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) });
  define('localStorage', { setItem() {} });
  const swListeners = {};
  define('navigator', {
    serviceWorker: {
      controller: {},
      register: async () => registration,
      addEventListener: (type, fn) => { (swListeners[type] ||= []).push(fn); },
    },
  });
  return {
    posted, announced, store, worker,
    fire: (type) => (listeners[type] || []).slice().forEach((fn) => fn({ type })),
    controllerChange: () => (swListeners.controllerchange || []).forEach((fn) => fn()),
    reloads: () => reloads,
    restore() {
      for (const [key, desc] of Object.entries(saved)) {
        if (desc) Object.defineProperty(globalThis, key, desc); else delete globalThis[key];
      }
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test('a waiting worker found on a fresh, untouched load is applied silently once', async () => {
  const env = fakeServiceWorkerEnv();
  try {
    const mod = await freshModule();
    mod.subscribeWorkerUpdate((w) => env.announced.push(w));
    mod.registerServiceWorker();
    await settle();
    assert.deepEqual(env.posted, [{ type: 'SKIP_WAITING' }]);
    assert.deepEqual(env.announced, []);
    assert.equal(mod.getWaitingWorker(), null);
    assert.equal(env.store.get('oxsteed:sw-silent-update'), env.worker.scriptURL);
    env.controllerChange();
    assert.equal(env.reloads(), 1);
  } finally { env.restore(); }
});

test('the silent update never loops: a second attempt for the same worker shows the notice', async () => {
  const env = fakeServiceWorkerEnv({ marker: 'https://oxsteed.com/sw.js?v=build-2' });
  try {
    const mod = await freshModule();
    mod.subscribeWorkerUpdate((w) => env.announced.push(w));
    mod.registerServiceWorker();
    await settle();
    assert.deepEqual(env.posted, []);
    assert.deepEqual(env.announced, [env.worker]);
  } finally { env.restore(); }
});

test('once the user has interacted, an update shows the notice instead of reloading', async () => {
  const env = fakeServiceWorkerEnv();
  try {
    const mod = await freshModule();
    mod.subscribeWorkerUpdate((w) => env.announced.push(w));
    // Register listeners first, then the user types before the worker is found.
    const origRegister = navigator.serviceWorker.register;
    let release;
    navigator.serviceWorker.register = () => new Promise((resolve) => { release = () => resolve(origRegister()); });
    mod.registerServiceWorker();
    env.fire('input');
    release();
    await settle(); await settle();
    assert.deepEqual(env.posted, []);
    assert.deepEqual(env.announced, [env.worker]);
    assert.equal(env.reloads(), 0);
  } finally { env.restore(); }
});

test('the update notice stacks above the cookie banner instead of covering it', () => {
  const css = fs.readFileSync(new URL('../src/styles/PwaExperience.css', import.meta.url), 'utf8');
  const consent = fs.readFileSync(new URL('../src/components/CookieConsent.tsx', import.meta.url), 'utf8');
  assert.match(css, /\.pwa-update-notice\s*\{[^}]*var\(--cookie-banner-height, 0px\)/);
  assert.match(consent, /setProperty\('--cookie-banner-height'/);
  assert.match(consent, /removeProperty\('--cookie-banner-height'\)/);
  assert.match(consent, /ref=\{banner\} className="cookie-consent-banner"/);
});
