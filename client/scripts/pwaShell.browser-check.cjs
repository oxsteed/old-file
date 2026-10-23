const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  http = require('node:http');
const { build } = require('esbuild'),
  { chromium } = require('playwright-core');
const root = path.resolve(__dirname, '..');
test(
  'PWA survives offline, receives photos and updates only after explicit refresh',
  { timeout: 90000 },
  async () => {
    const bundle = await build({
      stdin: {
        resolveDir: root,
        loader: 'jsx',
        contents: `import React from 'react';import{createRoot}from'react-dom/client';import Notice from './src/components/ServiceWorkerUpdateNotice';import{registerServiceWorker}from './src/utils/serviceWorkerRegistration';import{takeSharedJobDraft}from './src/utils/sharedJobDraft';window.takeShare=takeSharedJobDraft;registerServiceWorker();createRoot(document.getElementById('root')).render(<><input aria-label="Order notes"/><Notice/></>);`,
      },
      bundle: true,
      write: false,
      format: 'esm',
      define: { 'import.meta.env': '{}' },
      plugins: [
        {
          name: 'translations',
          setup(p) {
            p.onResolve({ filter: /^react-i18next$/ }, () => ({
              path: 'i18n',
              namespace: 'fixture',
            }));
            p.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
              contents: `export const useTranslation=()=>({t:key=>key==='pwaShell.refresh'?'Refresh to update':key});`,
            }));
          },
        },
      ],
    });
    let release = 1;
    const requests = {};
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
      requests[url.pathname] = (requests[url.pathname] || 0) + 1;
      res.setHeader('Cache-Control', 'no-store');
      if (url.pathname === '/sw.js') {
        res.setHeader('Content-Type', 'text/javascript');
        return res.end(
          fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8') +
            '\n// release ' +
            release,
        );
      }
      if (url.pathname === '/app.js') {
        res.setHeader('Content-Type', 'text/javascript');
        return res.end(bundle.outputFiles[0].contents);
      }
      if (url.pathname === '/offline.html') {
        res.setHeader('Content-Type', 'text/html');
        return res.end(fs.readFileSync(path.join(root, 'public/offline.html')));
      }
      if (url.pathname.startsWith('/assets/')) {
        res.setHeader('Cache-Control', 'public, max-age=0');
        return res.end('asset');
      }
      if (url.pathname.startsWith('/api/')) {
        res.setHeader('Content-Type', 'application/json');
        return res.end('{"fresh":true}');
      }
      res.setHeader('Content-Type', 'text/html');
      res.end(
        '<div id="root"></div><script type="module" src="/app.js"></script>',
      );
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const browser = await chromium.launch({
        channel: 'chrome',
        headless: true,
      }),
      context = await browser.newContext(),
      page = await context.newPage();
    const origin = `http://127.0.0.1:${server.address().port}`,
      errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    try {
      await page.goto(origin);
      await page.waitForFunction(() => navigator.serviceWorker.controller);
      await page.evaluate(async () => {
        await fetch('/assets/main-ABcd1234.js');
        await fetch('/assets/main-ABcd1234.js');
      });
      assert.equal(requests['/assets/main-ABcd1234.js'], 1);
      await page.evaluate(() =>
        navigator.serviceWorker.controller.postMessage({
          type: 'precache',
          urls: [
            '/assets/idle-QWER1234.js',
            '/api/private.jpg',
            'https://outside.invalid/a.js',
          ],
        }),
      );
      await page.waitForFunction(
        async () =>
          !!(await (
            await caches.open('oxsteed-assets-v1')
          ).match('/assets/idle-QWER1234.js')),
      );
      assert.equal(requests['/api/private.jpg'], undefined);
      await page.evaluate(async () => {
        await fetch('/api/orders');
        await fetch('/api/orders');
      });
      assert.equal(requests['/api/orders'], 2);
      const id = await page.evaluate(async () => {
        const form = new FormData();
        form.append(
          'images',
          new File(['image'], 'repair.png', { type: 'image/png' }),
        );
        form.append('title', 'Repair the kitchen faucet');
        return new URL(
          (
            await fetch('/post-job/share-target', {
              method: 'POST',
              body: form,
            })
          ).url,
        ).searchParams.get('share');
      });
      assert.match(id, /^[a-f0-9-]{36}$/);
      const shared = await page.evaluate(async (id) => {
        const a = window.takeShare(id),
          b = window.takeShare(id),
          draft = await a;
        return { same: a === b, title: draft.title, name: draft.files[0].name };
      }, id);
      assert.deepEqual(shared, {
        same: true,
        title: 'Repair the kitchen faucet',
        name: 'repair.png',
      });
      const invalid = await page.evaluate(async () => {
        const form = new FormData();
        form.append('images', new File(['x'], 'x.txt', { type: 'text/plain' }));
        return (
          await fetch('/post-job/share-target', { method: 'POST', body: form })
        ).url;
      });
      assert.ok(invalid.includes('share_error=invalid'));
      const second = await context.newPage();
      await second.goto(origin);
      await second
        .getByRole('textbox', { name: 'Order notes' })
        .fill('Other checkout');
      await second.evaluate(() => (window.keepOpen = true));
      await page
        .getByRole('textbox', { name: 'Order notes' })
        .fill('Leave checkout open');
      release = 2;
      await page.evaluate(
        async () =>
          await (await navigator.serviceWorker.getRegistration()).update(),
      );
      await page.getByRole('button', { name: 'Refresh to update' }).waitFor();
      assert.equal(
        await page.getByRole('textbox', { name: 'Order notes' }).inputValue(),
        'Leave checkout open',
      );
      await Promise.all([
        page.waitForEvent('load'),
        page.getByRole('button', { name: 'Refresh to update' }).click(),
      ]);
      assert.equal(
        await page.getByRole('textbox', { name: 'Order notes' }).inputValue(),
        '',
      );
      assert.equal(
        await second.getByRole('textbox', { name: 'Order notes' }).inputValue(),
        'Other checkout',
      );
      assert.equal(await second.evaluate(() => window.keepOpen), true);
      await Promise.all([
        second.waitForEvent('load'),
        second.getByRole('button', { name: 'Refresh to update' }).click(),
      ]);
      assert.equal(await second.getByRole('textbox', { name: 'Order notes' }).inputValue(), '');
      await second.close();
      await context.setOffline(true);
      assert.equal(
        await page.evaluate(
          async () => await (await fetch('/assets/idle-QWER1234.js')).text(),
        ),
        'asset',
      );
      assert.equal(
        await page.evaluate(async () => (await fetch('/api/orders')).status),
        503,
      );
      await page.goto(origin + '/unopened-route');
      await page.getByRole('button', { name: 'Reconnect' }).waitFor();
      assert.match(
        await page.locator('#last-opened').innerText(),
        /Last opened:/,
      );
      await context.setOffline(false);
      await Promise.all([
        page.waitForEvent('load'),
        page.getByRole('button', { name: 'Reconnect' }).click(),
      ]);
      await page.getByRole('textbox', { name: 'Order notes' }).waitFor();
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await new Promise((r) => server.close(r));
    }
  },
);
