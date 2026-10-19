// Synthetic browser check for the Growth Center durable link performance tab.
// Run: node --test scripts/promotionPerformance.browser-check.cjs (needs Chrome).
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const {build}=require('esbuild');
const {chromium}=require('playwright-core');
const root=path.resolve(__dirname,'..');
const catalogs=Object.fromEntries(['en','fr','ar'].map(l=>[l,JSON.parse(fs.readFileSync(path.join(root,`src/locales/${l}.json`)))]));

test('promote performance tab: server-backed totals, states, window switch, 320px and RTL layout',async()=>{
  const api=`export default {get:async(url,opts={})=>{
    window.calls.push({url,params:opts.params});
    if(window.mode==='forbidden')throw{response:{status:403}};
    if(window.mode==='error'&&!window.retried){window.retried=true;throw{response:{status:500}};}
    if(window.mode==='empty')return{data:{days:opts.params.days,totals:{shares:0,visits:0,visits_per_share:null},sources:[],campaigns:[]}};
    return{data:{days:opts.params.days,totals:{shares:12,visits:1234567,visits_per_share:102880.58},
      sources:[{source:'facebook_marketplace_long_source_name',shares:8,visits:1200000,visits_per_share:150000,mediums:[{medium:'social',shares:5,visits:1100000},{medium:null,shares:3,visits:100000}]},{source:'email',shares:4,visits:34567,visits_per_share:8641.75,mediums:[{medium:'email',shares:4,visits:34567}]}],
      campaigns:[{campaign:'Rentrée d’automne — offre parrainage très longue 2026',shares:6,visits:900000},{campaign:'عرض الخريف',shares:2,visits:5}]}};
  },post:async()=>({data:{}})};`;
  const noop=`export default function X({children}){return children??null};export const PageShell=X;`;
  const mocks={
    'react-i18next':`export function useTranslation(){return{i18n:{language:window.lang},t:window.translate}};`,
    '../api/axios':api,
    '../context/AuthContext':`export const useAuth=()=>({user:{id:'u1',role:'helper'}});`,
    '../api/businesses':`export const listBusinesses=async()=>[];`,
    '../api/helpers':`export const getHelperProfileQrPngUrl=()=>'';`,
    'react-hot-toast':`export default {success(){},error(){}};`,
    '../components/PageMeta':noop,
    '../components/PageShell':noop,
  };
  const entry=`import React from 'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router-dom';import{PerformanceTab}from'./src/pages/PromotePage.jsx';
window.catalogs=${JSON.stringify(catalogs)};window.lang='en';window.calls=[];window.mode='ok';window.target={businessId:null};
window.translate=(key,o={})=>{const raw=key.split('.').reduce((a,k)=>a?.[k],window.catalogs[window.lang]);const s=typeof raw==='string'?raw:(o.defaultValue||key);return s.replace(/{{\\s*(\\w+)\\s*}}/g,(m,k)=>o[k]!=null?String(o[k]):m);};
const root=createRoot(document.getElementById('root'));window.render=()=>root.render(<BrowserRouter><div className="promote-page"><PerformanceTab key={window.lang+window.mode+(window.target.businessId||'h')} target={window.target}/></div></BrowserRouter>);window.render();`;
  const bundled=await build({stdin:{contents:entry,resolveDir:root,loader:'jsx'},bundle:true,write:false,format:'esm',loader:{'.css':'empty'},plugins:[{name:'fixtures',setup(p){p.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);p.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'jsx'}));}}]});
  const css=fs.readFileSync(path.join(root,'src/styles/PromotePage.css'),'utf8');
  const server=http.createServer((req,res)=>{if(req.url.startsWith('/app.js')){res.setHeader('Content-Type','text/javascript');return res.end(bundled.outputFiles[0].contents);}res.end(`<style>:root{--app-bg:#fff;--card-bg:#f5f7fb;--app-text:#162033;--muted-text:#46556b;--border-color:#cbd5e1}.dark{--app-bg:#111827;--card-bg:#1f2937;--app-text:#f3f5f9;--muted-text:#bac4d4;--border-color:#455167}*{box-sizing:border-box}body{margin:8px;font-family:Arial;background:var(--app-bg);color:var(--app-text)}${css}</style><div id="root"></div><script type="module" src="/app.js"></script>`);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try{
    browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const en=catalogs.en.promotePage.performance;
    await page.getByText('1,234,567',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.calls[0].url),'/promotion-analytics/performance');
    assert.equal(await page.evaluate(()=>window.calls[0].params.days),30);
    // Interpolated copy, not raw {{placeholders}}.
    assert.equal(await page.locator('text=/\\{\\{/').count(),0);
    await page.getByText('8 shares · 1,200,000 visits · 150,000 per share',{exact:true}).waitFor();
    await page.getByText(en.noMedium,{exact:false}).first().waitFor();
    // Window switch re-queries with the selected window; keyboard reachable.
    const select=page.getByLabel(en.windowLabel,{exact:true});
    await select.focus();await select.selectOption('90');
    await page.waitForFunction(()=>window.calls.at(-1).params.days===90);
    // Business target uses the manager-gated business endpoint.
    await page.evaluate(()=>{window.target={businessId:42};window.render();});
    await page.waitForFunction(()=>window.calls.at(-1).url==='/businesses/42/promotion-performance');
    // Forbidden, empty and retryable error states.
    await page.evaluate(()=>{window.mode='forbidden';window.render();});
    await page.getByRole('alert').filter({hasText:en.forbidden}).waitFor();
    await page.evaluate(()=>{window.mode='empty';window.render();});
    await page.getByText(en.empty,{exact:true}).waitFor();
    await page.evaluate(()=>{window.mode='error';window.retried=false;window.render();});
    await page.getByRole('button',{name:en.retry}).click();
    await page.getByText('1,234,567',{exact:true}).waitFor();
    await page.evaluate(()=>{window.mode='ok';window.target={businessId:null};window.render();});
    const shots=path.join(os.tmpdir(),'oxsteed-promotion-performance');fs.mkdirSync(shots,{recursive:true});
    for(const lang of ['en','fr','ar'])for(const dark of [false,true]){
      await page.evaluate(({lang,dark})=>{window.lang=lang;document.documentElement.dir=lang==='ar'?'rtl':'ltr';document.documentElement.lang=lang;document.documentElement.classList.toggle('dark',dark);window.render();},{lang,dark});
      await page.getByText(catalogs[lang].promotePage.performance.heading,{exact:true}).waitFor();
      await page.locator('.promote-perf-campaign-list li').first().waitFor();
      for(const width of [320,390,1360]){await page.setViewportSize({width,height:1000});
        await page.waitForTimeout(30);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${lang}/${dark}/${width}`);
        if(width===320||width===390)await page.screenshot({path:path.join(shots,`perf-${lang}-${dark?'dark':'light'}-${width}.png`),fullPage:true});}
    }
    assert.deepEqual(errors,[]);console.log(`Synthetic promotion performance captures: ${shots}`);
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
