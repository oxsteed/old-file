import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { transformSync } from 'esbuild';

const root = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const repo = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');

test('account and business pages do not inherit helper work eligibility', () => {
  const require = createRequire(import.meta.url);
  const code = transformSync(root('src/components/ProtectedRoute.jsx'), {
    loader: 'jsx', format: 'cjs', jsx: 'automatic',
  }).code;
  let user;
  let pathname;
  let complete = false;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require(name) {
    if (name === 'react-router-dom') return { Navigate() {}, useLocation: () => ({ pathname }) };
    if (name === '../context/AuthContext') return { useAuth: () => ({ user, loading: false, isOnboardingComplete: complete }) };
    return require(name);
  } });
  const render = (props = {}) => {
    const result = module.exports.default({ children: 'allowed', ...props });
    return result === 'allowed' ? result : result.props.to;
  };
  const base = { role: 'helper', email_verified: true, didit_status: 'skipped', onboarding_completed: false };
  for (const mode of ['helper', 'business_owner', 'business_manager', 'business_employee']) {
    user = { ...base, default_mode: mode };
    for (pathname of ['/settings', '/settings/sessions', '/statements', '/helper-earnings/statements',
      '/business/statements', '/statements/document/accessible', '/support/escalation', '/business/4/workspace']) {
      assert.equal(render(), 'allowed', `${mode}: ${pathname}`);
    }
  }
  // Recovery must also work for users who have not skipped verification.
  user = { ...base, didit_status: 'pending' };
  for (pathname of ['/verify-identity', '/media/verification', '/media/verify-identity']) {
    assert.equal(render(), 'allowed');
    assert.equal(render({ requireOnboarded: true }), 'allowed');
  }
  pathname = '/work-only';
  user = base;
  assert.equal(render({ requireOnboarded: true }), '/helper-dashboard');
  complete = true;
  assert.equal(render({ requireOnboarded: true }), 'allowed');
  assert.equal(render({ requiredRole: 'admin' }), '/dashboard');
  user = { ...base, didit_enforcement_required: true };
  assert.equal(render(), '/verify-identity');
  user = { ...base, email_verified: false };
  assert.equal(render(), '/verify-email');
  user = null;
  assert.equal(render(), '/login');
});

test('main and admin route imports use resilient lazy loading', () => {
  assert.doesNotMatch(repo('client/src/App.jsx'), /const [A-Za-z0-9_]+ = lazy\(/);
  assert.doesNotMatch(repo('client/src/admin/AdminApp.jsx'), /const [A-Za-z0-9_]+ = lazy\(/);
  assert.match(repo('client/src/App.jsx'), /lazyWithRetry/);
  assert.match(repo('client/src/admin/AdminApp.jsx'), /lazyWithRetry/);
});

test('common route loaders are shared by prefetching and route definitions', () => {
  const loaders = root('src/utils/routePrefetch.js');
  const app = repo('client/src/App.jsx');
  for (const [name, route] of [
    ['logistics', 'routeLoaders.logistics'],
    ['restaurants', 'routeLoaders.restaurants'],
    ['qrGenerator', 'routeLoaders.qrGenerator'],
    ['careers', 'routeLoaders.careers'],
    ['jobs', 'routeLoaders.jobs'],
  ]) {
    assert.match(loaders, new RegExp(`\\b${name}: createLoader`));
    assert.match(app, new RegExp(route.replace('.', '\\.')), `${name} must use its shared loader`);
  }
});

test('prefetch links cover pointer, keyboard, and touch interactions', () => {
  const link = repo('client/src/components/PrefetchLink.jsx');
  assert.match(link, /onPointerEnter/);
  assert.match(link, /onFocus/);
  assert.match(link, /onTouchStart/);
  assert.match(link, /setTimeout/);
  assert.match(link, /clearTimeout/);
});

test('prefetching honors connection constraints and deduplicates loaders', () => {
  const source = root('src/utils/routePrefetch.js');
  assert.match(source, /saveData/);
  assert.match(source, /slow-2g/);
  assert.match(source, /routePromises/);
  assert.match(source, /routePromises\.has/);
});

test('service worker is release-versioned and does not cache arbitrary HTML navigations', () => {
  const sw = repo('client/public/sw.js');
  assert.match(sw, /searchParams\.get\('v'\)/);
  const start = sw.indexOf('async function navigationHandler');
  const end = sw.indexOf('// ── Web Push', start);
  const navigation = sw.slice(start, end);
  assert.doesNotMatch(navigation, /cache\.put/);
  assert.match(navigation, /caches\.match\('\/offline\.html'\)/);
});

function serviceWorker({ fetch: fetchImpl = async () => new Response('ok'), caches: cacheImpl = {} } = {}) {
  const listeners = new Map();
  const context = vm.createContext({
    URL, Response, Headers,
    fetch: fetchImpl,
    caches: { match: async () => undefined, open: async () => ({ put: async () => {} }), ...cacheImpl },
    self: {
      location: { href: 'https://oxsteed.com/sw.js?v=test', origin: 'https://oxsteed.com' },
      addEventListener: (name, callback) => listeners.set(name, callback),
    },
  });
  vm.runInContext(repo('client/public/sw.js'), context);
  return { context, listeners };
}

test('offline navigation always returns a Response even when cache is missing or unavailable', async () => {
  for (const match of [async () => undefined, async () => { throw new Error('cache unavailable'); }]) {
    const { context } = serviceWorker({ fetch: async () => { throw new Error('offline'); }, caches: { match } });
    const response = await context.navigationHandler({});
    assert.ok(response instanceof Response);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
});

test('authenticated API reads never cache or replay another account response', async () => {
  let cacheReads = 0;
  let cacheWrites = 0;
  const { listeners } = serviceWorker({
    fetch: async () => new Response('{"private":true}'),
    caches: { match: async () => { cacheReads += 1; return new Response('old account'); }, open: async () => { cacheWrites += 1; } },
  });
  let result;
  listeners.get('fetch')({ request: { url: 'https://oxsteed.com/api/auth/me', method: 'GET', mode: 'cors', headers: new Headers({ Authorization: 'Bearer synthetic' }) }, respondWith: value => { result = value; } });
  assert.equal(await (await result).text(), '{"private":true}');
  assert.equal(cacheReads, 0);
  assert.equal(cacheWrites, 0);
  const offline = serviceWorker({ fetch: async () => { throw new Error('offline'); }, caches: { match: async () => { cacheReads += 1; return new Response('old account'); } } });
  offline.listeners.get('fetch')({ request: { url: 'https://oxsteed.com/api/bookings', method: 'GET', mode: 'cors' }, respondWith: value => { result = value; } });
  assert.equal((await result).status, 503);
  assert.equal(cacheReads, 0);
});

test('socket handshakes and private uploads are not intercepted as HTML or cached assets', () => {
  const { listeners } = serviceWorker();
  for (const path of ['/socket.io/?transport=polling', '/uploads/private-proof.jpg', '/ready']) {
    let intercepted = false;
    listeners.get('fetch')({ request: { url: `https://oxsteed.com${path}`, method: 'GET', mode: 'cors' }, respondWith: () => { intercepted = true; } });
    assert.equal(intercepted, false, path);
  }
});

test('successful public asset requests survive storage failures and respect private cache control', async () => {
  for (const cacheControl of ['public', 'no-store', 'private']) {
    let writes = 0;
    const { context } = serviceWorker({
      fetch: async () => new Response('asset', { headers: { 'Cache-Control': cacheControl } }),
      caches: { open: async () => { writes += 1; throw new Error('quota'); } },
    });
    const response = await context.networkFirst({ headers: new Headers() }, 'static');
    assert.equal(await response.text(), 'asset');
    assert.equal(writes, cacheControl === 'public' ? 1 : 0);
  }
});

test('activation retires legacy API caches without deleting another application caches', async () => {
  const removed = [];
  let activation;
  // Only the test harness needs clients.claim; no page or credential state is used.
  const sw = serviceWorker({ caches: { keys: async () => ['oxsteed-api-old', 'oxsteed-static-old', 'oxsteed-static-test', 'other-app'], delete: async name => { removed.push(name); } } });
  sw.context.self.clients = { claim: async () => {} };
  sw.listeners.get('activate')({ waitUntil: promise => { activation = promise; } });
  await activation;
  assert.deepEqual(removed, ['oxsteed-api-old', 'oxsteed-static-old']);
});

test('missing assets are rejected before the SPA catch-all', () => {
  const server = repo('server/index.js');
  const missingAsset = server.indexOf("app.use('/assets', (req, res)");
  const catchAll = server.indexOf('app.use(createSpaFallback(clientDist))');
  assert.ok(missingAsset >= 0);
  assert.ok(catchAll > missingAsset);
  assert.match(server, /res\.status\(404\).*Asset not found/);
});

test('production builds emit an asset manifest and release version', () => {
  assert.match(repo('client/vite.config.js'), /manifest: true/);
  assert.match(repo('Dockerfile'), /VITE_APP_VERSION/);
  assert.match(repo('docker-compose.coolify.yml'), /VITE_APP_VERSION/);
});
