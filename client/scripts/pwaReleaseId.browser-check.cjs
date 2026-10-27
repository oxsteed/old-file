// Same deployment on different landing routes/tabs must register one
// service-worker URL and never show "A new version is available"; a real
// deployment found on a fresh, untouched load is applied silently.
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  http = require('node:http');
const { build } = require('esbuild'),
  { chromium } = require('playwright-core');
const root = path.resolve(__dirname, '..');

// Mimics Vite's dynamic-import preload helper: each route injects its own
// <link rel="modulepreload"> tags at runtime, before window load.
const entrySource = `import React from 'react';import{createRoot}from'react-dom/client';import Notice from './src/components/ServiceWorkerUpdateNotice';import{registerServiceWorker}from './src/utils/serviceWorkerRegistration';
const route=location.pathname.replace(/[^a-z]/gi,'')||'home';
for(const name of [route,route+'Vendor']){const l=document.createElement('link');l.rel='modulepreload';l.href='/assets/'+name+'-'+route.length+'.js';document.head.appendChild(l);}
registerServiceWorker();createRoot(document.getElementById('root')).render(<><input aria-label="Order notes"/><Notice/></>);`;

async function bundle(buildId) {
  const result = await build({
    stdin: { resolveDir: root, loader: 'jsx', contents: entrySource },
    bundle: true,
    write: false,
    format: 'esm',
    define: { 'import.meta.env': JSON.stringify({ VITE_APP_BUILD_ID: buildId }) },
    plugins: [{
      name: 'translations',
      setup(p) {
        p.onResolve({ filter: /^react-i18next$/ }, () => ({ path: 'i18n', namespace: 'fixture' }));
        p.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: `export const useTranslation=()=>({t:key=>({'pwaShell.refresh':'Refresh to update','pwaShell.later':'Later','pwaShell.updateReady':'A new version is available.'}[key]||key)});`,
        }));
      },
    }],
  });
  return result.outputFiles[0].contents;
}

test('one build registers one worker URL on every route; real deploys still update', { timeout: 90000 }, async () => {
  const builds = { 'build-1': await bundle('build-1'), 'build-2': await bundle('build-2') };
  let current = 'build-1';
  const swVersions = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('Cache-Control', 'no-store');
    if (url.pathname === '/sw.js') {
      swVersions.push(url.searchParams.get('v'));
      res.setHeader('Content-Type', 'text/javascript');
      return res.end(fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8'));
    }
    if (url.pathname === '/offline.html') return res.end('offline');
    const entry = url.pathname.match(/^\/assets\/index-(build-\d)\.js$/);
    if (entry) {
      res.setHeader('Content-Type', 'text/javascript');
      return res.end(builds[entry[1]]);
    }
    if (url.pathname.startsWith('/assets/')) {
      res.setHeader('Content-Type', 'text/javascript');
      return res.end('export {};');
    }
    res.setHeader('Content-Type', 'text/html');
    res.end(`<div id="root"></div><script type="module" src="/assets/index-${current}.js"></script>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const errors = [];
  const open = async (route) => {
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(origin + route);
    await page.waitForFunction(() => navigator.serviceWorker.controller);
    return page;
  };
  try {
    // First visit, then other landing routes in new tabs and an SPA-style reload.
    const home = await open('/');
    const job = await open('/jobs/42');
    const dashboard = await open('/dashboard');
    await job.reload();
    await job.waitForFunction(() => navigator.serviceWorker.controller);
    const preloads = await Promise.all([home, job, dashboard].map((p) => p.evaluate(() => [...document.querySelectorAll('link[rel=modulepreload]')].map((l) => l.href).join())));
    assert.equal(new Set(preloads).size, 3, 'fixture routes inject different preloads');
    await new Promise((r) => setTimeout(r, 1000));
    for (const page of [home, job, dashboard]) {
      const state = await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        return { url: reg.active.scriptURL, waiting: !!reg.waiting, installing: !!reg.installing };
      });
      assert.match(state.url, /\/sw\.js\?v=build-1$/);
      assert.equal(state.waiting, false);
      assert.equal(state.installing, false);
      assert.equal(await page.getByRole('status').count(), 0, 'no update notice on first visit or route change');
    }
    assert.deepEqual([...new Set(swVersions)], ['build-1']);

    // A real deployment: an untouched fresh tab applies it silently, once.
    await home.getByRole('textbox', { name: 'Order notes' }).fill('Keep my draft');
    await home.evaluate(() => (window.keepOpen = true));
    await job.close();
    await dashboard.close();
    current = 'build-2';
    const fresh = await context.newPage();
    fresh.on('pageerror', (e) => errors.push(e.message));
    let loads = 0;
    fresh.on('load', () => { loads += 1; });
    await fresh.goto(origin + '/jobs/7');
    // Poll across the silent reload (an in-flight evaluate dies with the old document).
    const deadline = Date.now() + 30000;
    let settled = null;
    while (Date.now() < deadline) {
      settled = await fresh.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        return {
          controller: navigator.serviceWorker.controller?.scriptURL || '',
          waiting: !!reg?.waiting,
          navigation: performance.getEntriesByType('navigation')[0]?.type,
          ready: document.readyState === 'complete',
        };
      }).catch(() => null);
      if (settled?.ready && settled.navigation === 'reload' && settled.controller.endsWith('v=build-2') && !settled.waiting) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.deepEqual(settled, { controller: `${origin}/sw.js?v=build-2`, waiting: false, navigation: 'reload', ready: true });
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(loads, 2, 'reloaded exactly once onto the new release');
    assert.equal(await fresh.getByRole('status').count(), 0);
    assert.equal(await fresh.evaluate(() => sessionStorage.getItem('oxsteed:sw-silent-update')), `${origin}/sw.js?v=build-2`);
    // The tab with a draft was never reloaded.
    assert.equal(await home.evaluate(() => window.keepOpen), true);
    assert.equal(await home.getByRole('textbox', { name: 'Order notes' }).inputValue(), 'Keep my draft');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
});
