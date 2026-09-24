import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const repo = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');

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
    assert.match(app, new RegExp(route.replace('.', '\\.'), `${name} must use its shared loader`));
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

test('missing assets are rejected before the SPA catch-all', () => {
  const server = repo('server/index.js');
  const missingAsset = server.indexOf("app.use('/assets', (req, res)");
  const catchAll = server.indexOf("app.get('*'");
  assert.ok(missingAsset >= 0);
  assert.ok(catchAll > missingAsset);
  assert.match(server, /res\.status\(404\).*Asset not found/);
});

test('production builds emit an asset manifest and release version', () => {
  assert.match(repo('client/vite.config.js'), /manifest: true/);
  assert.match(repo('Dockerfile'), /VITE_APP_VERSION/);
  assert.match(repo('docker-compose.coolify.yml'), /VITE_APP_VERSION/);
});
