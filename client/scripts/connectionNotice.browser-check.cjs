const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');

test('connection notice stays quiet online and preserves retry and unfinished work', { timeout: 30000 }, async () => {
  const root = path.resolve(__dirname, '..');
  const mocks = {
    'react-i18next': `export const useTranslation=()=>({t:key=>key,i18n:{language:'en'}});`,
    '@tanstack/react-query': `const client={invalidateQueries:async()=>{}};export const useQueryClient=()=>client;`,
    'react-router-dom': `export const useLocation=()=>({pathname:globalThis.fixturePath||'/'});`,
    '../context/AuthContext': `const auth={user:{id:1},refreshUser:async()=>{globalThis.rechecks=(globalThis.rechecks||0)+1;return{id:1}}};export const useAuth=()=>auth;`,
    '../api/axios': `export default {interceptors:{response:{use:()=>1,eject:()=>{}}}};`,
  };
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'jsx', contents: `
      import React from 'react';import{createRoot}from'react-dom/client';
      import Runtime from './src/components/PwaRuntime';
      import{connectionChanged}from'./src/utils/pwaRuntime';
      const root=createRoot(document.getElementById('root'));
      function render(){root.render(<><input aria-label="Unfinished notes"/><Runtime/></>)}
      window.connectionChanged=connectionChanged;window.renderRoute=path=>{window.fixturePath=path;render()};render();
    ` },
    bundle: true, write: false, jsx: 'automatic', format: 'esm', loader: { '.css': 'empty' },
    plugins: [{ name: 'connection-fixture', setup(p) {
      p.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'fixture' } : undefined);
      p.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path] }));
    } }],
  });
  const server = http.createServer((req, res) => {
    if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].contents); }
    else if (req.url === '/style.css') { res.setHeader('Content-Type', 'text/css'); res.end(fs.readFileSync(path.join(root, 'src/styles/PwaExperience.css'))); }
    else res.end('<html><head><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const notes = page.getByRole('textbox', { name: 'Unfinished notes' });
    await notes.fill('Keep this work');
    assert.equal(await page.locator('.pwa-connection').count(), 0);
    assert.equal(await page.locator('html.pwa-connection-present').count(), 0);
    await page.evaluate(() => window.connectionChanged('offline'));
    await page.locator('.pwa-connection-offline').waitFor();
    assert.equal(await page.locator('html.pwa-connection-present').count(), 1);
    await page.getByRole('button', { name: 'pwaExperience.retry', exact: true }).click();
    await page.locator('.pwa-connection').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => window.rechecks), 1);
    assert.equal(await notes.inputValue(), 'Keep this work');
    assert.equal(await page.locator('html.pwa-connection-present').count(), 0);
    await page.evaluate(() => window.connectionChanged('reconnecting'));
    await page.locator('.pwa-connection-reconnecting').waitFor();
    await page.evaluate(() => window.renderRoute('/restaurants/screens/2/kitchen'));
    await page.locator('.pwa-connection').waitFor({ state: 'detached' });
    assert.equal(await page.locator('html.pwa-connection-present').count(), 0);
    await page.evaluate(() => window.renderRoute('/'));
    await page.locator('.pwa-connection-reconnecting').waitFor();
    await page.evaluate(() => window.connectionChanged('online', true));
    await page.locator('.pwa-connection').waitFor({ state: 'detached' });
    assert.equal(await notes.inputValue(), 'Keep this work');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
