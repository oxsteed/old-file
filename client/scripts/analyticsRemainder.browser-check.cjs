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

test('evidence URLs, audited export revocation, query history, alert comparisons and currency-scoped business UI',async()=>{
  const api=`export default {get:async(url,opts={})=>{
    if(url.endsWith('/meta'))return{data:{metrics:[{name:'platform_revenue_cents',dimensions:[],filters:[],periods:['30d'],unit:'cents',periodSensitive:true}],rowCap:10000}};
    if(url.endsWith('/history'))return{data:{rows:[{id:'history-1',event_type:'evidence',metric_name:'platform_revenue_cents',success:true,created_at:'2026-10-19T12:00:00Z'}],hasMore:false}};
    if(url.includes('/settings/'))return{data:url.endsWith('metric-alert-rules')?{rules:[],metrics:[{name:'payout_failure_count',unit:'count',params:['period','comparison']}]}:{}};
    const c=opts.params.currencyCode||'USD';return{data:{accounts:['USD','JPY'],currency_code:c,summary:{revenue:c==='JPY'?'12345.00':'90071992547409.93',paid_invoices:1},monthly:[{month:'2026-10',revenue:'123.45',paid_invoices:1}],invoices:[{id:1,invoice_number:'PAID-001',revenue:c==='JPY'?'12345.00':'123.45'}],hasMore:false}};
  },post:async(url,body)=>{window.calls.push({url,body});if(body.export&&window.denyExport)throw{response:{data:{error:'Permission expired'}}};
    if(url.endsWith('metric-alert-rules'))return{data:{rule:{...body,id:'new-rule'}}};
    return{data:body.evidence?{query:{metric:body.metric,period:'30d'},evidence:true,offset:body.offset||0,summary:[{currency_code:'USD',revenue_cents:'12345'}],summaryColumns:['currency_code','revenue_cents'],rows:[{ledger_id:1,currency_code:'USD',amount_cents:'12345',source_type:'job_fee'}],columns:['ledger_id','currency_code','amount_cents','source_type'],rowCount:1,truncated:false,hasMore:false,durationMs:1}:{query:{metric:body.metric,period:'30d'},rows:[{currency_code:'USD',revenue_cents:'12345'}],columns:['currency_code','revenue_cents'],rowCount:1,truncated:false,durationMs:1}};
  }};`;
  const mocks={
    'react-i18next':`export function useTranslation(){return{i18n:{language:window.lang},t:window.translate}};`,
    '../../api/axios':api,
    '../../hooks/useAuth':`export const useAuth=()=>({user:{id:'admin',role:'super_admin'}});`,
    '../../utils/logger':`export default{warn(){},error(){}};`,
  };
  const bundled=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router-dom';import Query from './src/pages/admin/AdminQueryBuilderPage.jsx';import Settings from './src/pages/admin/AdminUserSettingsPage.jsx';import{BusinessAnalyticsTab as Business}from'./src/components/businessHub/BusinessAnalyticsTab.jsx';window.catalogs=${JSON.stringify(catalogs)};window.lang='en';window.calls=[];window.denyExport=false;window.view='query';window.translate=(key,o={})=>String(key.split('.').reduce((a,k)=>a?.[k],window.catalogs[window.lang])||o.defaultValue||key);const root=createRoot(document.getElementById('root'));window.render=()=>root.render(<BrowserRouter>{window.view==='query'?<Query/>:window.view==='settings'?<Settings key={window.lang}/>:<Business businessId={1} onInvoices={()=>{window.openedInvoices=true}}/>}</BrowserRouter>);window.render();`,resolveDir:root,loader:'jsx'},bundle:true,write:false,format:'esm',loader:{'.css':'empty'},plugins:[{name:'fixtures',setup(p){p.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);p.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'jsx'}));}}]});
  const css=['src/pages/admin/AdminQueryBuilderPage.css','src/pages/admin/AdminUserSettingsPage.css','src/styles/BusinessAnalyticsTab.css'].map(f=>fs.readFileSync(path.join(root,f),'utf8')).join('\n');
  const server=http.createServer((req,res)=>{if(req.url.startsWith('/app.js')){res.setHeader('Content-Type','text/javascript');return res.end(bundled.outputFiles[0].contents);}res.end(`<style>:root{--color-text:#162033;--color-text-muted:#46556b;--color-surface:#fff;--color-surface-2:#f5f7fb;--color-border:#cbd5e1;--color-primary:#b83f08;--app-bg:#fff;--card-bg:#f5f7fb;--app-text:#162033;--border-color:#cbd5e1}.dark{--color-text:#f3f5f9;--color-text-muted:#bac4d4;--color-surface:#111827;--color-surface-2:#1f2937;--color-border:#455167;--app-bg:#111827;--card-bg:#1f2937;--app-text:#f3f5f9;--border-color:#455167}*{box-sizing:border-box}body{margin:8px;font-family:Arial;background:var(--app-bg);color:var(--app-text)}${css}</style><div id="root"></div><script type="module" src="/app.js"></script>`);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try{
    browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const url=`http://127.0.0.1:${server.address().port}`;await page.goto(url);
    await page.locator('#qb-metric').selectOption('platform_revenue_cents');
    await page.getByRole('button',{name:catalogs.en.queryBuilder.run,exact:true}).click();
    await page.getByRole('button',{name:catalogs.en.analyticsCompletion.records,exact:true}).click();
    await page.getByText('job_fee',{exact:true}).waitFor();assert.equal(JSON.parse(new URL(page.url()).searchParams.get('q')).evidence,true);
    await page.reload();await page.getByText('job_fee',{exact:true}).waitFor();
    // Hardened deep links: unpermitted metric and malformed q fail closed with localized copy; history navigation restores evidence.
    const evidenceUrl=page.url();
    await page.goto(`${url}/?q=${encodeURIComponent(JSON.stringify({metric:'job_completion_rate_pct',period:'30d'}))}`);
    await page.getByRole('alert').filter({hasText:catalogs.en.queryBuilder.errorPermissionRequired}).waitFor();
    assert.equal(await page.evaluate(()=>window.calls.length),0);
    await page.goto(`${url}/?q=%7Bnot-json`);
    await page.getByRole('alert').filter({hasText:catalogs.en.queryBuilder.errorInvalidLink}).waitFor();
    await page.goBack();await page.goBack();assert.equal(page.url(),evidenceUrl);
    await page.getByText('job_fee',{exact:true}).waitFor();
    await page.getByRole('button',{name:catalogs.en.analyticsCompletion.loadHistory,exact:true}).click();
    await page.getByText(catalogs.en.analyticsCompletion.events.evidence,{exact:true}).waitFor();
    await page.evaluate(()=>{window.denyExport=true;});await page.getByRole('button',{name:catalogs.en.queryBuilder.exportCsv,exact:true}).click();
    await page.getByText('Permission expired',{exact:false}).waitFor();
    assert.equal(await page.evaluate(()=>window.calls.some(c=>c.body.export&&c.body.evidence)),true);
    await page.evaluate(()=>{window.view='business';window.render();});
    // The tab now defaults to the metrics-layer overview; switch to the invoice-revenue drill-through.
    await page.getByRole('button',{name:catalogs.en.businessAnalytics.invoiceRevenue,exact:true}).click();
    await page.getByText('$90,071,992,547,409.93',{exact:true}).waitFor();
    await page.getByLabel(catalogs.en.helperEarningsV2.currency,{exact:true}).selectOption('JPY');
    await page.getByText(/12,345/).first().waitFor();await page.getByRole('button',{name:'PAID-001'}).click();assert.equal(await page.evaluate(()=>window.openedInvoices),true);
    const shots=path.join(os.tmpdir(),'oxsteed-analytics-remainder');fs.mkdirSync(shots,{recursive:true});
    for(const view of ['query','business','settings'])for(const lang of ['en','fr','ar'])for(const dark of [false,true]){
      await page.evaluate(({view,lang,dark})=>{history.replaceState({},'',view==='settings'?'?tab=metric-alerts':'/');window.view=view;window.lang=lang;document.documentElement.dir=lang==='ar'?'rtl':'ltr';document.documentElement.classList.toggle('dark',dark);window.render();},{view,lang,dark});
      if(view==='settings'){
        const newRule=page.getByRole('button',{name:catalogs[lang].adminSettings.metricAlerts.newRule,exact:true});
        const ruleSelect=page.locator('.admin-settings-field select').first();
        await newRule.or(ruleSelect).first().waitFor();
        if(!(await ruleSelect.count())&&await newRule.count())await newRule.click();
        await ruleSelect.selectOption('payout_failure_count');
        await page.locator('#metric-comparison').selectOption('previous_period_pct');
      }
      for(const width of [320,390,1360]){await page.setViewportSize({width,height:1000});
        await page.waitForTimeout(30);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${view}/${lang}/${dark}/${width}`);
        if(width===390)await page.screenshot({path:path.join(shots,`${view}-${lang}-${dark?'dark':'light'}.png`),fullPage:true});}
    }
    assert.deepEqual(errors,[]);console.log(`Synthetic analytics remainder captures: ${shots}`);
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
