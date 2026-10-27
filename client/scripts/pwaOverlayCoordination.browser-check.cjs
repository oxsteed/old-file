const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');

test('updates defer to unfinished work and overlays, with notice clearance in both directions', { timeout: 60000 }, async () => {
  const root = path.resolve(__dirname, '..');
  const mocks = {
    'react-i18next': `export const useTranslation=()=>({t:key=>({'pwaShell.updateReady':'A new version is available.','pwaShell.later':'Later','pwaShell.refresh':'Refresh to update'}[key]||key),i18n:{language:'en'}});`,
    '@tanstack/react-query': `const client={invalidateQueries:async()=>{}};export const useQueryClient=()=>client;`,
    '../context/AuthContext': `const auth={user:{id:1},refreshUser:async()=>({id:1})};export const useAuth=()=>auth;`,
    '../api/axios': `export default {interceptors:{response:{use:()=>1,eject:()=>{}}}};`,
    '../utils/serviceWorkerRegistration': `
      import{appUpdatesDeferred}from'./src/utils/appUpdateSafety';
      let worker=null;const listeners=new Set();export const getWaitingWorker=()=>worker;
      export const subscribeWorkerUpdate=fn=>{listeners.add(fn);return()=>listeners.delete(fn)};
      export const applyWorkerUpdate=()=>{if(appUpdatesDeferred())return false;globalThis.updateCalls=(globalThis.updateCalls||0)+1;return true};
      window.offerUpdate=()=>{worker={};listeners.forEach(fn=>fn(worker))};
    `,
  };
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'jsx', contents: `
      import React,{useState}from'react';import{createRoot}from'react-dom/client';
      import{BrowserRouter,useNavigate,useLocation}from'react-router-dom';
      import Runtime from'./src/components/PwaRuntime';import Notice from'./src/components/ServiceWorkerUpdateNotice';
      import Consent from'./src/components/CookieConsent';import{CookieConsentContext}from'./src/context/CookieConsentContext';
      import{connectionChanged}from'./src/utils/pwaRuntime';
      function Harness(){const navigate=useNavigate(),{pathname}=useLocation();const[cookies,setCookies]=useState(false),[settings,setSettings]=useState(false),[modal,setModal]=useState(false),[cart,setCart]=useState(false);
        window.navigate=navigate;window.showCookies=setCookies;window.showModal=setModal;window.showCart=setCart;window.connectionChanged=connectionChanged;
        const consent={showBanner:cookies,showSettings:settings,preferences:null,openSettings:()=>setSettings(true),closeSettings:()=>setSettings(false),acceptAll:()=>{setCookies(false);setSettings(false)},rejectAll:()=>{setCookies(false);setSettings(false)},savePreferences:()=>{setCookies(false);setSettings(false)}};
        return <CookieConsentContext.Provider value={consent}><Runtime/><main><h1>Current page {pathname}</h1>
          {pathname==='/edit'&&<input aria-label="Unfinished notes"/>}<button>Done focusing</button>
          {cart&&<div className="rp-float-cart" data-update-defer="true" data-pwa-bottom-actions>Active restaurant cart</div>}
          <button data-pwa-support-launcher className="fixed bottom-20 end-4 sm:bottom-6 sm:end-6" style={{width:100,height:44}} onClick={()=>setModal(true)}>Assistant</button>
          {modal&&<section role="dialog" aria-modal="true"><h2>Support conversation</h2><button onClick={()=>setModal(false)}>Close conversation</button></section>}
        </main><Consent/><Notice/></CookieConsentContext.Provider>}
      createRoot(document.getElementById('root')).render(<BrowserRouter><Harness/></BrowserRouter>);
    ` },
    bundle: true, write: false, jsx: 'automatic', format: 'esm', loader: { '.css': 'empty' }, define: { 'import.meta.env': '{}' },
    plugins: [{ name: 'notice-fixture', setup(p) {
      p.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'fixture' } : undefined);
      p.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path], resolveDir: root }));
    } }],
  });
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'dist/.vite/manifest.json')));
  const css = new Set(), seen = new Set();
  function visit(key) { if (seen.has(key)) return; seen.add(key); const item = manifest[key]; if (!item) return; (item.imports || []).forEach(visit); (item.css || []).forEach(file => css.add(file)); }
  visit('index.html');
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].contents); }
    else if (pathname === '/notice.css') { res.setHeader('Content-Type', 'text/css'); res.end(fs.readFileSync(path.join(root, 'src/styles/PwaExperience.css'))); }
    else if (pathname.startsWith('/assets/')) {
      const file = path.join(root, 'dist', pathname);
      if (!fs.existsSync(file)) { res.statusCode = 404; res.end(); return; }
      res.setHeader('Content-Type', pathname.endsWith('.css') ? 'text/css' : 'application/octet-stream'); res.end(fs.readFileSync(file));
    } else { res.setHeader('Content-Type', 'text/html'); res.end(`<html><head><style>.rp-float-cart{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);height:48px;width:240px}</style>${[...css].map(file => `<link rel="stylesheet" href="/${file}">`).join('')}<link rel="stylesheet" href="/notice.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole('heading', { name: 'Current page /', exact: true }).waitFor();
    await page.evaluate(() => window.offerUpdate());
    const notice = page.locator('.pwa-update-notice');
    await notice.waitFor();
    for (const width of [320, 390, 1440]) for (const dir of ['ltr', 'rtl']) for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(({ dir, theme }) => { document.documentElement.dir = dir; document.documentElement.classList.toggle('dark', theme === 'dark'); }, { dir, theme });
      await page.waitForFunction(() => {
        const a = document.querySelector('.pwa-update-notice')?.getBoundingClientRect(), b = document.querySelector('[data-pwa-support-launcher]')?.getBoundingClientRect();
        return a && b && a.bottom <= b.top - 8;
      });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width} ${dir} ${theme}`);
      await page.evaluate(() => window.showCookies(true));
      await page.locator('.cookie-consent-banner').waitFor();
      await notice.waitFor({ state: 'detached' });
      await page.waitForFunction(() => document.querySelector('[data-pwa-support-launcher]').getBoundingClientRect().bottom <= document.querySelector('.cookie-consent-banner').getBoundingClientRect().top - 8);
      await page.getByRole('button', { name: 'cookieConsent.customize', exact: true }).click();
      await page.getByRole('dialog').waitFor();
      await notice.waitFor({ state: 'detached' });
      await page.getByRole('checkbox', { name: 'cookieConsent.analytics', exact: true }).check();
      await page.getByRole('button', { name: 'cookieConsent.rejectAll', exact: true }).click();
      await notice.waitFor();
      await page.waitForFunction(() => {
        const gap = document.querySelector('[data-pwa-support-launcher]').getBoundingClientRect().top - document.querySelector('.pwa-update-notice').getBoundingClientRect().bottom;
        return gap >= 8 && gap <= 24;
      });
    }
    await page.getByRole('button', { name: 'Assistant', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    await notice.waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Close conversation', exact: true }).click();
    await notice.waitFor();
    await page.evaluate(() => window.navigate('/checkout'));
    await page.getByRole('heading', { name: 'Current page /checkout', exact: true }).waitFor();
    await notice.waitFor({ state: 'detached' });
    await page.evaluate(() => window.navigate('/edit'));
    await page.getByRole('textbox', { name: 'Unfinished notes' }).fill('Keep this unfinished work');
    await page.getByRole('button', { name: 'Done focusing', exact: true }).click();
    assert.equal(await notice.count(), 0, 'blur does not release unfinished work');
    assert.equal(await page.getByRole('textbox', { name: 'Unfinished notes' }).inputValue(), 'Keep this unfinished work');
    await page.evaluate(() => window.navigate('/'));
    await notice.waitFor();
    await page.setViewportSize({ width: 390, height: 900 });
    await page.evaluate(() => window.showCart(true));
    await notice.waitFor({ state: 'detached' });
    await page.evaluate(() => window.connectionChanged('offline'));
    await page.locator('.pwa-connection-offline').waitFor();
    await notice.waitFor({ state: 'detached' });
    await page.locator('[data-pwa-support-launcher]').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.querySelector('.pwa-connection').getBoundingClientRect().bottom <= document.querySelector('.rp-float-cart').getBoundingClientRect().top - 8);
    await page.evaluate(() => window.showCookies(true));
    await page.locator('.cookie-consent-banner').waitFor();
    await page.waitForFunction(() => document.querySelector('.rp-float-cart').getBoundingClientRect().bottom <= document.querySelector('.cookie-consent-banner').getBoundingClientRect().top - 8);
    await page.getByRole('button', { name: 'cookieConsent.rejectAll', exact: true }).click();
    await page.getByRole('button', { name: 'pwaExperience.retry', exact: true }).click();
    await page.locator('.pwa-connection').waitFor({ state: 'detached' });
    assert.equal(await notice.count(), 0, 'cart remains protected after reconnect');
    await page.waitForFunction(() => document.querySelector('[data-pwa-support-launcher]').getBoundingClientRect().bottom <= document.querySelector('.rp-float-cart').getBoundingClientRect().top - 8);
    await page.evaluate(() => window.showCart(false));
    await notice.waitFor();
    assert.equal(await page.evaluate(() => window.updateCalls || 0), 0);
    await page.getByRole('button', { name: 'Later', exact: true }).click();
    await notice.waitFor({ state: 'detached' });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
