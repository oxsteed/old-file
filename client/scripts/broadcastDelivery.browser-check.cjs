const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');
const root = path.resolve(__dirname, '..');
const langs = ['en', 'es', 'fr', 'ht', 'ar'];
const catalogs = Object.fromEntries(langs.map(l => [l, JSON.parse(fs.readFileSync(path.join(root, `src/locales/${l}.json`)))]));
const channels = {
  in_app: { sent: 120, failed: 0, skipped: 14, pending: 0, opened: 61, clicked: 0, openRatePct: 50.8, clickRatePct: null },
  push: { sent: 80, failed: 2, skipped: 52, pending: 3, opened: 9, clicked: 0, openRatePct: 11.3, clickRatePct: null },
  email: { sent: 1180, failed: 4, skipped: 30, pending: 0, opened: 402, clicked: 77, openRatePct: 34.1, clickRatePct: 6.5 },
};
const broadcasts = [
  { id: 1, subject: 'Spring sale on every haircut and beard trim this weekend only', channel: 'all', status: 'sent', recipient_count: 1214, delivery_tracked: true, delivery: { channels, unsubscribes: 6 } },
  { id: 2, subject: 'Old announcement', channel: 'email', status: 'sent', recipient_count: 40, delivery_tracked: false, delivery: null },
  { id: 3, subject: 'Draft', channel: 'push', status: 'draft', recipient_count: 12, delivery_tracked: false, delivery: null },
];

// Decision 1: broadcast delivery/open/click reporting and the channel choice
// in the business hub, 5 locales, 320px, light, RTL.
test('broadcast delivery stats render in 5 locales at 320px/RTL', async () => {
  const mocks = {
    'react-i18next': String.raw`export const useTranslation=()=>({i18n:{language:window.lang},t:(key,o={})=>{const value=key.split('.').reduce((a,k)=>a?.[k],window.catalogs[window.lang]);const s=typeof o==='string'?o:o.defaultValue;return String(value??s??key).replace(/\{\{(\w+)\}\}/g,(_,k)=>o[k]??'');}});`,
    '../../api/axios': `const api={get:async(url,o={})=>{window.calls.push([url,o.params]);if(url.endsWith('/report'))return{data:{days:30,channels:window.channels,unsubscribes:9}};if(url.endsWith('/broadcasts'))return{data:window.broadcasts};return{data:[]};},post:async(url,body)=>{window.calls.push([url,body]);if(url.endsWith('/send'))return{data:{status:'sending'}};return{data:{}};},delete:async()=>({data:{}})};export default api;`,
    'react-hot-toast': 'const toast={success:(m)=>window.toasts.push(m),error:(m)=>window.toasts.push(m)};export default toast;',
  };
  const bundle = await build({ stdin: {
    contents: `import React from 'react';import{createRoot}from'react-dom/client';import{MarketingTools}from'./src/components/businessHub/MarketingTools.jsx';
      window.catalogs=${JSON.stringify(catalogs)};window.channels=${JSON.stringify(channels)};window.broadcasts=${JSON.stringify(broadcasts)};window.lang='en';window.calls=[];window.toasts=[];window.confirm=()=>true;
      const root=createRoot(document.getElementById('root'));window.n=0;window.render=()=>root.render(<MarketingTools key={window.lang+(window.n++)} businessId={7}/>);window.render();`,
    resolveDir: root, loader: 'jsx',
  }, bundle: true, write: false, format: 'esm', loader: { '.css': 'empty' }, plugins: [{ name: 'mocks', setup(p) {
    p.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'mock' } : undefined);
    p.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'jsx' }));
  } }] });
  const server = http.createServer((req, res) => {
    if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(bundle.outputFiles[0].contents); }
    res.end('<style>:root{--card-bg:#fff;--border-color:#cbd5e1;--muted-text:#475569;--app-text:#0f172a}*{box-sizing:border-box}body{font-family:Arial;margin:0;background:#fff;color:#0f172a}</style><div id="root"></div><script type="module" src="/app.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ colorScheme: 'light' }), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewportSize({ width: 320, height: 1200 });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const shots = path.join(os.tmpdir(), 'oxsteed-broadcast-delivery'); fs.mkdirSync(shots, { recursive: true });
    for (const lang of langs) {
      const m = catalogs[lang].businessHub.marketing;
      await page.evaluate(l => { window.lang = l; window.calls = []; document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr'; document.documentElement.lang = l; window.render(); }, lang);
      const report = page.getByTestId('broadcast-report');
      await report.waitFor();
      await page.getByRole('heading', { name: m.delivery.reportTitle.replace('{{days}}', '30'), exact: true }).waitFor();
      assert.ok(await page.evaluate(() => window.calls.some(([u, p]) => u === '/businesses/7/broadcasts/report' && p?.days === 30)));
      const stats = page.getByTestId('broadcast-stats-1');
      await stats.waitFor();
      for (const ch of ['in_app', 'push', 'email']) {
        assert.equal(await stats.locator(`tr[data-channel="${ch}"] th`).first().evaluate(el => el.firstChild.textContent), m.channels[ch]);
      }
      const nf = new Intl.NumberFormat(lang);
      assert.equal(await stats.locator('tr[data-channel="email"] td').first().textContent(), nf.format(1180));
      const pct = new Intl.NumberFormat(lang, { style: 'percent', maximumFractionDigits: 1 }).format(0.065);
      assert.ok((await stats.locator('tr[data-channel="email"] td').nth(2).textContent()).includes(pct));
      assert.ok((await stats.textContent()).includes(m.delivery.unsubscribes.replace('{{count}}', '6')));
      assert.ok((await stats.textContent()).includes(m.delivery.pending.replace('{{count}}', '3')));
      await page.getByText(m.delivery.legacyUntracked, { exact: true }).waitFor();
      // Only the draft can be sent or deleted.
      assert.equal(await page.getByRole('button', { name: m.send, exact: true }).count(), 1);
      assert.equal(await page.getByRole('button', { name: m.deleteBroadcast, exact: true }).count(), 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `list ${lang}`);
      // Header cells never overflow into their neighbours.
      assert.equal(await stats.locator('thead th').evaluateAll(ths => ths.some(th => th.scrollWidth > th.clientWidth + 1)), false, `headers ${lang}`);
      if (lang === 'fr' || lang === 'ar') await page.screenshot({ path: path.join(shots, `broadcasts-${lang}-light-320.png`), fullPage: true });
      if (lang === 'ar') {
        assert.equal(await stats.evaluate(el => getComputedStyle(el).direction), 'rtl');
        assert.equal(await stats.locator('caption').evaluate(el => getComputedStyle(el).textAlign), 'start');
      }
      // Channel choice: email, push, in-app, all; SMS is gone.
      await page.getByRole('button', { name: m.newBroadcast }).click();
      const select = page.getByLabel(m.channel, { exact: true });
      assert.deepEqual(await select.locator('option').allTextContents(), [m.channels.email, m.channels.push, m.channels.in_app, m.channels.all]);
      assert.equal(await select.locator('option[value="sms"]').count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `form ${lang}`);
      await page.getByRole('button', { name: m.send, exact: true }).click();
      await page.waitForFunction(() => window.calls.some(([u]) => u === '/businesses/7/broadcasts/3/send'));
      await page.waitForFunction((msg) => window.toasts.includes(msg), m.toastBroadcastQueued);
    }
    assert.deepEqual(errors, []);
    console.log(`Broadcast delivery captures: ${shots}`);
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
});
