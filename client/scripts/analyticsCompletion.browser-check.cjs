const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');
const root = path.resolve(__dirname, '..');
const catalogs = Object.fromEntries(['en','fr','ar'].map(l => [l, JSON.parse(fs.readFileSync(path.join(root, `src/locales/${l}.json`)))]));
const meta = { metrics: [{ name: 'platform_revenue_cents', dimensions: ['period'], filters: [], periods: ['30d'], unit: 'cents', periodSensitive: true, definition: 'Recorded fees by currency' }], periods: ['30d'], rowCap: 10000 };

test('analytics money, earnings currency pages, account isolation and localized responsive layouts', async () => {
  const api = `const api={get:async(url,options={})=>{
    if(url.endsWith('/meta'))return{data:window.viewer.id==='first'?window.meta:{...window.meta,metrics:[]}};
    const currency=options.params?.currencyCode||'USD',offset=options.params?.offset||0;
    return{data:{accounts:[{currencyCode:'USD'},{currencyCode:'JPY'}],summary:{currencyCode:currency,completedJobs:25,unpricedJobs:1,lifetimeCents:currency==='JPY'?'9007199254740993':'2400',weekCents:100,monthCents:2400,availableCents:2200,pendingCents:200,paidCents:0},jobs:[{id:offset?'older':'job',title:window.viewer.id==='first'?(offset?'Older job':'First account job'):'Second account job',completedAt:'2026-10-01',amountCents:currency==='JPY'?1234:12345,payoutStatus:'earned'}],weekly:[{period:'2026-10-01',amountCents:1234}],monthly:[{period:'2026-10-01',amountCents:1234}],pagination:{total:25,hasMore:offset===0}}};
  },post:async(url,body)=>{window.calls.push({url,body});return{data:{rows:[{currency_code:'USD',revenue_cents:'9007199254740993'},{currency_code:'KWD',revenue_cents:'12345'}],columns:['currency_code','revenue_cents'],rowCount:2,truncated:false,durationMs:1}}}};export default api;`;
  const mocks = {
    'react-i18next': String.raw`export const useTranslation=()=>({i18n:{language:window.lang},t:(key,o={})=>{const value=key.split('.').reduce((a,k)=>a?.[k],window.catalogs[window.lang]);return String(value||o.defaultValue||key).replace(/\{\{(\w+)\}\}/g,(_,k)=>o[k]??'');}});`,
    '../../api/axios': api, '../api/axios': api,
    '../../hooks/useAuth': `export const useAuth=()=>({user:window.viewer});`,
    '../hooks/useAuth': `export const useAuth=()=>({user:window.viewer});`,
    '../../utils/logger': 'export default {warn(){}};',
  };
  const bundle = await build({ stdin: {
    contents: `import React from 'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router-dom';import Query from './src/pages/admin/AdminQueryBuilderPage.jsx';import Earnings from './src/components/HelperJobEarnings.jsx';window.catalogs=${JSON.stringify(catalogs)};window.meta=${JSON.stringify(meta)};window.lang='en';window.view='query';window.viewer={id:'first',role:'super_admin'};window.calls=[];const root=createRoot(document.getElementById('root'));window.render=()=>root.render(<BrowserRouter>{window.view==='query'?<Query/>:<Earnings/>}</BrowserRouter>);window.render();`,
    resolveDir: root, loader: 'jsx',
  }, bundle: true, write: false, format: 'esm', loader: { '.css': 'empty' }, plugins: [{ name: 'mocks', setup(p) {
    p.onResolve({filter:/.*/}, args => mocks[args.path] ? { path: args.path, namespace: 'mock' } : undefined);
    p.onLoad({filter:/.*/,namespace:'mock'}, args => ({ contents:mocks[args.path],loader:'jsx' }));
  }}] });
  const css = ['src/pages/admin/AdminQueryBuilderPage.css','src/components/HelperJobEarnings.css'].map(f => fs.readFileSync(path.join(root,f),'utf8')).join('\n');
  const server = http.createServer((req,res) => {
    if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');return res.end(bundle.outputFiles[0].contents);}
    res.end(`<style>:root{--color-text:#162033;--color-text-muted:#46556b;--color-surface:#fff;--color-surface-2:#f5f7fb;--color-border:#cbd5e1;--color-primary:#b83f08;--color-primary-bg:#fff1e9}.dark{--color-text:#f3f5f9;--color-text-muted:#bac4d4;--color-surface:#111827;--color-surface-2:#1f2937;--color-border:#455167;--color-primary:#ff9248;--color-primary-bg:#382016}*{box-sizing:border-box}body{font-family:Arial;margin:8px;background:var(--color-surface)}${css}</style><div id="root"></div><script type="module" src="/app.js"></script>`);
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel:'chrome',headless:true });
    const page=await browser.newPage(), errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    const url=`http://127.0.0.1:${server.address().port}`;
    await page.goto(url);
    await page.getByLabel(catalogs.en.queryBuilder.metricLabel,{exact:true}).selectOption('platform_revenue_cents');
    await page.locator('.qb-builder button').filter({hasText:/Run|Execute/}).last().click();
    await page.getByText('$90,071,992,547,409.93',{exact:true}).waitFor();
    await page.getByText(/12\.345/).waitFor();
    await page.evaluate(()=>{window.viewer={id:'second',role:'admin'};window.render();});
    await page.waitForFunction(()=>!document.body.textContent.includes('90,071,992,547,409.93'));
    assert.equal(await page.locator('#qb-metric option').count(),1);
    await page.evaluate(()=>{window.viewer={id:'first',role:'helper'};window.view='earnings';window.render();});
    await page.getByRole('link',{name:'First account job'}).waitFor();
    await page.getByLabel(catalogs.en.helperEarningsV2.currency,{exact:true}).selectOption('JPY');
    await page.getByText(/9,007,199,254,740,993/).waitFor();
    await page.getByRole('button',{name:catalogs.en.helperEarningsV2.next,exact:true}).click();
    await page.getByRole('link',{name:'Older job'}).waitFor();
    await page.evaluate(()=>{window.viewer={id:'second',role:'helper'};window.render();});
    await page.getByRole('link',{name:'Second account job'}).waitFor();
    assert.equal(await page.getByRole('link',{name:'Older job'}).count(),0);
    const shots=path.join(os.tmpdir(),'oxsteed-analytics-completion');fs.mkdirSync(shots,{recursive:true});
    for(const lang of ['en','fr','ar'])for(const dark of [false,true])for(const width of [320,390,768,1360,1600]){
      await page.setViewportSize({width,height:1000});
      await page.evaluate(({lang,dark})=>{window.lang=lang;document.documentElement.dir=lang==='ar'?'rtl':'ltr';document.documentElement.classList.toggle('dark',dark);window.render();},{lang,dark});
      await page.getByRole('heading',{name:catalogs[lang].helperDashboard.jobEarnings.title,exact:true}).waitFor();
      await page.waitForFunction(lang => document.querySelector('.helper-job-earnings')?.lang === lang, lang);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${lang}/${dark}/${width}`);
      if(width===390||width===1360)await page.screenshot({path:path.join(shots,`earnings-${lang}-${dark?'dark':'light'}-${width}.png`),fullPage:true});
    }
    assert.deepEqual(errors,[]);
    console.log(`Synthetic analytics captures: ${shots}`);
  } finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)); }
});
