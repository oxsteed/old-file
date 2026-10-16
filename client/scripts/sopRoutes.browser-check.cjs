// SOP library route smoke test: renders the three new routes with mocked
// providers and verifies guest rendering, modal keyboard behavior, and
// checklist disclaimer text. Real SOP components, synthetic data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const SHELL =
  process.env.SOP_CHROME_PATH ||
  path.join(
    process.env.HOME || '/home/hatch',
    '.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell'
  );
// CI installs Chrome via browser-actions/setup-chrome; local dev uses the
// headless shell. SOP_CHROME_PATH overrides both (e.g. local runs).
async function launchBrowser() {
  if (process.env.SOP_CHROME_PATH || fs.existsSync(SHELL)) {
    return chromium.launch({ executablePath: process.env.SOP_CHROME_PATH || SHELL });
  }
  return chromium.launch({ channel: 'chrome' });
}

const mocks = {
  'react-i18next': `export const useTranslation = () => ({ t: (k) => k, i18n: { language: 'en' } }); export const initReactI18next = { type: '3rdParty', init: () => {} };`,
  '../../context/AuthContext': `import React from 'react'; export const useAuth = () => { const user=React.useSyncExternalStore(cb=>{window.addEventListener('sop-auth',cb);return()=>window.removeEventListener('sop-auth',cb)},()=>window.__sopAuth||null);return {user}; }; export default {useAuth};`,
  '../context/AuthContext': `import React from 'react'; export const useAuth = () => { const user=React.useSyncExternalStore(cb=>{window.addEventListener('sop-auth',cb);return()=>window.removeEventListener('sop-auth',cb)},()=>window.__sopAuth||null);return {user}; }; export default {useAuth};`,
  '../../components/PageMeta': `export default () => null;`,
  '../components/PageMeta': `export default () => null;`,

};

async function fixture() {
  const bundle = await build({
    stdin: {
      resolveDir: root,
      loader: 'jsx',
      contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { MemoryRouter, Routes, Route } from 'react-router-dom';
        import SopLibraryPage from './src/sop/pages/SopLibraryPage.jsx';
        import SopGuidePage from './src/sop/pages/SopGuidePage.jsx';
        import SopHandbookPage from './src/sop/pages/SopHandbookPage.jsx';
        import SopGuideButton from './src/sop/components/SopGuideButton.jsx';
        const route = window.__sopRoute || '/how-it-works/guides';
        function Harness() {
          return (
            <MemoryRouter initialEntries={[route]}>
              <Routes>
                <Route path="/how-it-works/guides" element={<SopLibraryPage />} />
                <Route path="/how-it-works/:area/:guideSlug" element={<SopGuidePage />} />
                <Route path="/how-it-works/handbooks/:role" element={<SopHandbookPage />} />
                <Route path="/post-job" element={<div><h1>Task page</h1><input aria-label="Unsaved task" defaultValue="Keep my draft"/><SopGuideButton /></div>} />
              </Routes>
            </MemoryRouter>
          );
        }
        createRoot(document.getElementById('root')).render(<Harness />);
        window.__sopReady = true;
      `,
    },
    bundle: true,
    write: false,
    outfile: 'app.js',
    jsx: 'automatic',
    define: { 'import.meta.env': '{}' },
    plugins: [{
      name: 'sop-fixture',
      setup(plugin) {
        plugin.onResolve({ filter: /.*/ }, (args) => {
          if (mocks[args.path]) return { path: args.path, namespace: 'fixture' };
          return undefined;
        });
        plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
          contents: mocks[args.path], loader: 'jsx', resolveDir: root,
        }));
        // Stub CSS imports
        plugin.onResolve({ filter: /\.css$/ }, (args) => ({ path: args.path, namespace: 'css-stub' }));
        plugin.onLoad({ filter: /.*/, namespace: 'css-stub' }, () => ({ contents: '', loader: 'js' }));
      },
    }],
  });
  const server = http.createServer((req, res) => {
    if (req.url === '/app.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(bundle.outputFiles.find((f) => f.path.endsWith('app.js')).contents);
      return;
    }
    res.setHeader('Content-Type', 'text/html');
    res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script>window.__sopRoute=${JSON.stringify(routeParam(req))};</script><script src="/app.js"></script></body></html>`);
  });
  await new Promise((r) => server.listen(0, r));
  return server;
}

function routeParam(req) {
  const m = req.url.match(/[?&]route=([^&]*)/);
  return m ? decodeURIComponent(m[1]) : '/how-it-works/guides';
}

test('SOP library routes render for guests', async (t) => {
  const server = await fixture();
  const port = server.address().port;
  const browser = await launchBrowser();
  t.after(async () => { await browser.close(); server.close(); });

  async function loadRoute(route) {
    const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
    t.after(async () => { await page.close().catch(() => {}); });
    await page.goto(`http://localhost:${port}/?route=${encodeURIComponent(route)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__sopReady, null, { timeout: 15000 });
    await page.waitForTimeout(1500);
    return page;
  }

  // 1. Library index
  let page = await loadRoute('/how-it-works/guides');
  const searchBox = await page.$('input[type="search"], input[placeholder]');
  assert.ok(searchBox, 'library search input renders');
  const cards = await page.$$('.sop-guide-card, a[href*="/how-it-works/"]');
  assert.ok(cards.length > 10, `library lists guides (found ${cards.length})`);
  await page.close();

  // 2. Guide page
  page = await loadRoute('/how-it-works/account/join-oxsteed');
  const badge = await page.$('.sop-badge-english');
  assert.ok(badge, 'guide page shows English badge');
  const guideBodyText = await page.textContent('body');
  const steps = await page.$$('ol li, [data-step], .sop-step');
  assert.ok(steps.length >= 1 || guideBodyText.length > 2000, 'guide page renders steps/content');
  // 5. Checklist disclaimer text on the guide page
  assert.ok(
    guideBodyText.includes('records your reading progress on this device only'),
    'checklist disclaimer text is present'
  );
  await page.close();

  // Progress is account scoped, even when switching accounts without navigation.
  page = await loadRoute('/how-it-works/account/sign-in');
  await page.waitForSelector('.sop-checklist input');
    await page.evaluate(()=>{window.__sopAuth={id:'one',default_mode:'helper'};window.dispatchEvent(new Event('sop-auth'));});
    await page.waitForTimeout(100);await page.check('.sop-checklist input');
    await page.evaluate(()=>{window.__sopAuth={id:'two',default_mode:'helper'};window.dispatchEvent(new Event('sop-auth'));});
    await page.waitForTimeout(100);assert.equal(await page.isChecked('.sop-checklist input'),false);
    await page.evaluate(()=>{window.__sopAuth={id:'one',default_mode:'helper'};window.dispatchEvent(new Event('sop-auth'));});
    await page.waitForTimeout(100);assert.equal(await page.isChecked('.sop-checklist input'),true);
  await page.close();

  // 3. Handbook page
  page = await loadRoute('/how-it-works/handbooks/customer');
  const hbText = await page.textContent('body');
  assert.ok(hbText.length > 1000, 'handbook page renders content');
  await page.close();

  // 4. Modal keyboard behavior via guide button
  page = await loadRoute('/post-job');
  const guideBtn = await page.$('.sop-guide-button');
  assert.ok(guideBtn, 'guide button renders on mapped task page');
  await guideBtn.click();
  await page.waitForTimeout(800);
  const modal = await page.$('[role="dialog"], [aria-modal="true"]');
  assert.ok(modal, 'guide modal opens');
  assert.ok(await page.$('.sop-step'), 'instructions render inside the contextual modal');
  assert.ok(await page.$('a[download][href$=".pdf?revision=1"]') || await page.$('a[download]'), 'PDF download available');
  assert.equal(await page.getAttribute('.sop-modal-actions a', 'target'), '_blank', 'full guide opens separately');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const modalAfter = await page.$('[role="dialog"], [aria-modal="true"]');
  assert.ok(!modalAfter, 'Escape closes the modal');
  assert.equal(await page.inputValue('[aria-label="Unsaved task"]'), 'Keep my draft');
  assert.equal(await page.evaluate(()=>document.activeElement?.classList.contains('sop-guide-button')),true,'focus returns to opener');
  await page.close();
});
