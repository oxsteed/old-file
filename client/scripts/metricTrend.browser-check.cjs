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
const meta = { metrics: [
  { name: 'job_completion_rate_pct', scope: 'regional', trend: true, dimensions: ['period'], filters: [], periods: ['30d'], unit: 'percent', periodSensitive: true, definition: 'Completed / decided jobs' },
  { name: 'platform_revenue_cents', scope: 'global', trend: true, dimensions: ['period'], filters: [], periods: ['30d'], unit: 'cents', periodSensitive: true, definition: 'Fees' },
], periods: ['30d'], rowCap: 10000 };

test('daily trend panel renders snapshot series, currency choice and empty state in 5 locales at 320px/RTL', async () => {
  const api = `const api={get:async(url,options={})=>{
    if(url.endsWith('/meta'))return{data:window.meta};
    if(url.endsWith('/trend')){window.trendCalls.push(options.params);const p=options.params;
      if(window.emptyTrend)return{data:{metric:p.metric,valueKind:'daily_cohort',currency:null,currencies:[],points:[],scope:{kind:'regional'},definitionChanged:false,lastComputedAt:null}};
      const money=p.metric==='platform_revenue_cents';
      const points=Array.from({length:30},(_,i)=>({date:'2026-09-'+String(i+1).padStart(2,'0'),value:i%7===3?null:String(money?(i*1250):(50+i)),components:{}}));
      return{data:{metric:p.metric,valueKind:'daily_cohort',currency:money?p.currency:null,currencies:money?['HTG','USD']:[],points,scope:{kind:money?'global':'regional'},definitionChanged:true,lastComputedAt:'2026-10-19T04:05:00Z'}};}
    return{data:{rows:[]}};},post:async()=>({data:{rows:[],columns:[],rowCount:0,durationMs:1}})};export default api;`;
  const mocks = {
    'react-i18next': String.raw`export const useTranslation=()=>({i18n:{language:window.lang},t:(key,o={})=>{const value=key.split('.').reduce((a,k)=>a?.[k],window.catalogs[window.lang]);return String(value||o.defaultValue||key).replace(/\{\{(\w+)\}\}/g,(_,k)=>o[k]??'');}});`,
    '../../api/axios': api,
    '../../hooks/useAuth': `export const useAuth=()=>({user:{id:'a',role:'admin'}});`,
    '../../utils/logger': 'export default {warn(){}};',
  };
  const bundle = await build({ stdin: {
    contents: `import React from 'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router-dom';import Query from './src/pages/admin/AdminQueryBuilderPage.jsx';window.catalogs=${JSON.stringify(catalogs)};window.meta=${JSON.stringify(meta)};window.lang='en';window.trendCalls=[];const root=createRoot(document.getElementById('root'));window.render=()=>root.render(<BrowserRouter><Query/></BrowserRouter>);window.render();`,
    resolveDir: root, loader: 'jsx',
  }, bundle: true, write: false, format: 'esm', loader: { '.css': 'empty' }, plugins: [{ name: 'mocks', setup(p) {
    p.onResolve({filter:/.*/}, args => mocks[args.path] ? { path: args.path, namespace: 'mock' } : undefined);
    p.onLoad({filter:/.*/,namespace:'mock'}, args => ({ contents:mocks[args.path],loader:'jsx' }));
  }}] });
  const css = ['src/pages/admin/AdminQueryBuilderPage.css', 'src/components/analytics/MetricTrendPanel.css'].map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
  const server = http.createServer((req,res) => {
    if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');return res.end(bundle.outputFiles[0].contents);}
    res.end(`<style>:root{--color-text:#162033;--color-text-muted:#46556b;--color-surface:#fff;--color-surface-2:#f5f7fb;--color-border:#cbd5e1;--color-primary:#b83f08}*{box-sizing:border-box}body{font-family:Arial;margin:8px;background:var(--color-surface)}${css}</style><div id="root"></div><script type="module" src="/app.js"></script>`);
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel:'chrome',headless:true });
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const shots = path.join(os.tmpdir(), 'oxsteed-metric-trend'); fs.mkdirSync(shots, { recursive: true });
    for (const lang of langs) {
      const q = catalogs[lang].queryBuilder;
      await page.setViewportSize({ width: 320, height: 900 });
      await page.evaluate(lang => { window.emptyTrend = false; window.lang = lang; document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'; window.render(); }, lang);
      await page.getByLabel(q.metricLabel, { exact: true }).selectOption('job_completion_rate_pct');
      await page.getByRole('heading', { name: q.trend.title, exact: true }).waitFor();
      await page.locator('.metric-trend-chart svg rect').first().waitFor();
      assert.equal(await page.locator('.metric-trend-chart svg rect').count(), 30);
      await page.getByText(q.trend.definitionChanged, { exact: true }).waitFor();
      assert.equal(await page.locator('.metric-trend .qb-region-scoped').count(), 1);
      assert.equal(await page.locator('#metric-trend-currency').count(), 0);
      await page.getByLabel(q.trend.daysLabel, { exact: true }).selectOption('180');
      await page.waitForFunction(() => window.trendCalls.at(-1)?.days === 180);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `trend ${lang}`);
      if (lang === 'fr' || lang === 'ar') await page.screenshot({ path: path.join(shots, `trend-${lang}-light-320.png`), fullPage: true });
      await page.getByLabel(q.metricLabel, { exact: true }).selectOption('platform_revenue_cents');
      await page.getByLabel(q.trend.currencyLabel, { exact: true }).selectOption('HTG');
      await page.waitForFunction(() => window.trendCalls.at(-1)?.currency === 'HTG' && window.trendCalls.at(-1)?.metric === 'platform_revenue_cents');
      assert.equal(await page.locator('.metric-trend .qb-region-scoped').count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `money ${lang}`);
      await page.evaluate(() => { window.emptyTrend = true; });
      await page.getByLabel(q.trend.daysLabel, { exact: true }).selectOption('30');
      await page.getByText(q.trend.empty, { exact: true }).waitFor();
      if (lang === 'ar') {
        assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.metric-trend')).direction), 'rtl');
      }
    }
    assert.deepEqual(errors, []);
    console.log(`Metric trend captures: ${shots}`);
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
});
