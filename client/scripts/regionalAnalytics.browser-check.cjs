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
const meta = { metrics: [{ name: 'job_completion_rate_pct', scope: 'regional', dimensions: ['period'], filters: [], periods: ['30d'], unit: 'percent', periodSensitive: true, definition: 'Completed / decided jobs' }], periods: ['30d'], rowCap: 10000 };

test('regional analytics notice and fail-closed region errors are localized and fit at 320px and RTL', async () => {
  const api = `const api={get:async()=>({data:window.meta}),post:async(url,body)=>{
    if(window.fail){const e=new Error('x');e.response={status:403,data:{code:window.fail,error:'raw server text'}};throw e;}
    return{data:{rows:[{completed:2,decided:3,completion_rate_pct:66.67}],columns:['completed','decided','completion_rate_pct'],rowCount:1,truncated:false,durationMs:1,scope:{kind:'regional',regionIds:[4]}}};}};export default api;`;
  const mocks = {
    'react-i18next': String.raw`export const useTranslation=()=>({i18n:{language:window.lang},t:(key,o={})=>{const value=key.split('.').reduce((a,k)=>a?.[k],window.catalogs[window.lang]);return String(value||o.defaultValue||key).replace(/\{\{(\w+)\}\}/g,(_,k)=>o[k]??'');}});`,
    '../../api/axios': api,
    '../../hooks/useAuth': `export const useAuth=()=>({user:{id:'regional',role:'admin'}});`,
    '../../utils/logger': 'export default {warn(){}};',
  };
  const bundle = await build({ stdin: {
    contents: `import React from 'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router-dom';import Query from './src/pages/admin/AdminQueryBuilderPage.jsx';window.catalogs=${JSON.stringify(catalogs)};window.meta=${JSON.stringify(meta)};window.lang='en';const root=createRoot(document.getElementById('root'));window.render=()=>root.render(<BrowserRouter><Query/></BrowserRouter>);window.render();`,
    resolveDir: root, loader: 'jsx',
  }, bundle: true, write: false, format: 'esm', loader: { '.css': 'empty' }, plugins: [{ name: 'mocks', setup(p) {
    p.onResolve({filter:/.*/}, args => mocks[args.path] ? { path: args.path, namespace: 'mock' } : undefined);
    p.onLoad({filter:/.*/,namespace:'mock'}, args => ({ contents:mocks[args.path],loader:'jsx' }));
  }}] });
  const css = fs.readFileSync(path.join(root,'src/pages/admin/AdminQueryBuilderPage.css'),'utf8');
  const server = http.createServer((req,res) => {
    if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');return res.end(bundle.outputFiles[0].contents);}
    res.end(`<style>:root{--color-text:#162033;--color-text-muted:#46556b;--color-surface:#fff;--color-border:#cbd5e1;--color-primary:#b83f08}*{box-sizing:border-box}body{font-family:Arial;margin:8px;background:var(--color-surface)}${css}</style><div id="root"></div><script type="module" src="/app.js"></script>`);
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel:'chrome',headless:true });
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const shots = path.join(os.tmpdir(), 'oxsteed-regional-analytics'); fs.mkdirSync(shots, { recursive: true });
    for (const lang of langs) {
      await page.setViewportSize({ width: 320, height: 900 });
      await page.evaluate(lang => { window.fail = null; window.lang = lang; document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'; window.render(); }, lang);
      const q = catalogs[lang].queryBuilder;
      await page.getByLabel(q.metricLabel, { exact: true }).selectOption('job_completion_rate_pct');
      await page.locator('.qb-builder button').last().click();
      await page.getByText(q.regionScopedNotice, { exact: true }).waitFor();
      await page.getByText(q.regionScopedHint, { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `notice ${lang}`);
      if (lang === 'fr' || lang === 'ar') await page.screenshot({ path: path.join(shots, `regional-${lang}-light-320.png`), fullPage: true });
      for (const [code, key] of [['region_unknown', 'errorRegionUnknown'], ['region_scope_unsupported', 'errorRegionUnsupported']]) {
        await page.evaluate(code => { window.fail = code; }, code);
        await page.locator('.qb-builder button').last().click();
        await page.locator('[role="alert"], .qb-error').filter({ hasText: q[key] }).first().waitFor();
        assert.equal(await page.getByText('raw server text').count(), 0);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${code} ${lang}`);
      }
      if (lang === 'ar') assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.qb-page, main, #root > *')).direction), 'rtl');
    }
    assert.deepEqual(errors, []);
    console.log(`Regional analytics captures: ${shots}`);
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
});
