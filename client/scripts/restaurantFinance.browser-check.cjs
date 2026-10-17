const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {build} = require('esbuild');
const {chromium} = require('playwright-core');
const root = path.resolve(__dirname, '..');
const food = fs.readFileSync(path.join(root,'src/api/food.js'),'utf8');
const exportsList = [...food.matchAll(/export (?:const|function) (\w+)/g)].map(m=>m[1]);
const mock = `function reply(name,args){window.calls.push({name,args});const v=window.fx[name];if(v?.error){const err=new Error('synthetic error');err.response={status:v.status||503,data:{code:v.error}};return Promise.reject(err);}return Promise.resolve(v??[]);}\n` + exportsList.map(name=>name==='formatFoodMoney' ? `export const ${name}=(n,c='USD')=>new Intl.NumberFormat('en',{style:'currency',currency:c}).format(Number(n||0)/100);` : `export const ${name}=(...args)=>reply('${name}',args);`).join('\n');
const catalogs = Object.fromEntries(['en','fr','ar'].map(l=>[l,{translation:JSON.parse(fs.readFileSync(path.join(root,`src/locales/${l}.json`))),common:JSON.parse(fs.readFileSync(path.join(root,`src/i18n/locales/${l}/common.json`))),credit:JSON.parse(fs.readFileSync(path.join(root,`src/i18n/locales/${l}/credit.json`)))}]));
test('restaurant finances: unavailable versus empty, permissions, safeguards, and responsive layout', {timeout:180000}, async()=>{
 const bundle=await build({stdin:{resolveDir:root,loader:'jsx',contents:`import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';import i18n from'i18next';import{initReactI18next}from'react-i18next';import Workspace from'./src/pages/food/RestaurantFinanceWorkspace';i18n.use(initReactI18next).init({lng:'en',resources:window.catalogs,interpolation:{escapeValue:false}});window.i18n=i18n;window.render=(props)=>root.render(<MemoryRouter><Workspace key={props.restaurant.id} {...props}/></MemoryRouter>);const root=createRoot(document.getElementById('root'));`},bundle:true,write:false,outdir:'fixture',format:'esm',loader:{'.css':'css'},define:{'import.meta.env':'{}'},plugins:[{name:'finance-fixture',setup(b){b.onResolve({filter:/api\/food$/},()=>({path:'food',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:mock,loader:'js'}));}}]});
 const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text,css=bundle.outputFiles.find(f=>f.path.endsWith('.css')).text;
 const baseCss=fs.readFileSync(path.join(root,'src/styles/FoodPages.css'),'utf8');
 const server=http.createServer((req,res)=>{if(req.url==='/fixture.js'){res.setHeader('content-type','text/javascript');res.end(js);}else res.end(`<html><head><style>:root{--primary-color:#9a3412;--app-text:#142036;--muted-text:#475569;--card-bg:#fff;--border-color:#dbe3ef;--soft-bg:#f1f5f9}html{font-family:Arial;background:#f7f9fc}.dark{--primary-color:#fb923c;--app-text:#e2e8f0;--muted-text:#cbd5e1;--card-bg:#162133;--border-color:#475569;--soft-bg:#1e293b;background:#0b1220}body{margin:0}#root{max-width:1200px;margin:auto;padding:16px}*{box-sizing:border-box}${baseCss}\n${css}</style></head><body><div id="root"></div><script>window.catalogs=${JSON.stringify(catalogs)};window.fx={};window.calls=[];</script><script type="module" src="/fixture.js"></script></body></html>`);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
 const restaurant={id:2,business_id:3,currency_code:'USD',display_name:'Synthetic restaurant'};
 const base={getRestaurantPayoutStatus:{connected:false},getWalletPayoutBalance:{balanceCents:10000,currencyCode:'USD',minPayoutCents:2500,processorEnabled:false},listWalletPayouts:[],getRestaurantTopupEligibility:{eligibility:{status:'not_applied'}},listMerchantFoodWalletCreditRequests:[],getMerchantCreditApproval:[],getCreditReserveBalance:{},listCreditReserveLedger:[],getMerchantCreditExposure:{},listFoodRestaurantOxsteedCreditTransactions:{error:'credit_partner_not_found',status:404},listFoodRestaurantOxsteedCreditSettlements:{error:'credit_partner_not_found',status:404},getFoodRestaurantOxsteedCreditLedger:{error:'credit_partner_not_found',status:404}};
 let id=2;
 async function configure(overrides={},permissions={canManagePayouts:true,canManageCredit:true}){id++;await page.evaluate(({fx,props})=>{window.fx=fx;window.calls=[];window.render(props);},{fx:{...base,...overrides},props:{restaurant:{...restaurant,id},...permissions}});await page.waitForTimeout(150);}
 try{
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.render);
  await configure({getRestaurantPayoutStatus:{error:'feature_disabled'}});
  await page.getByText('Bank payout setup is unavailable',{exact:true}).waitFor();
  assert.equal(await page.getByText('Internal server error').count(),0);
  await page.getByText('Not enrolled as an OxSteed Credit partner',{exact:true}).waitFor();
  assert.equal(await page.getByText('No OxSteed Credit activity has posted for this restaurant.').count(),0);
  assert.equal(await page.getByRole('button',{name:'Download report'}).isEnabled(),false);
  assert.equal(await page.getByRole('button',{name:'Request payout',exact:true}).isEnabled(),false);
  await page.getByLabel(/Payout amount/).fill('30');
  assert.equal(await page.getByRole('button',{name:'Request payout',exact:true}).isEnabled(),false,'processor disabled fails closed');
  await configure({listMerchantFoodWalletCreditRequests:{error:'unavailable'}});
  await page.getByText('Customer credit requests could not be loaded.',{exact:false}).waitFor();
  assert.equal(await page.getByText('No credit requests to review',{exact:true}).count(),0);
  await configure({getWalletPayoutBalance:{...base.getWalletPayoutBalance,processorEnabled:true}});
  await page.getByLabel(/Payout amount/).fill('24');assert.equal(await page.getByRole('button',{name:'Request payout',exact:true}).isEnabled(),false);
  await page.getByLabel(/Payout amount/).fill('101');assert.equal(await page.getByRole('button',{name:'Request payout',exact:true}).isEnabled(),false);
  await page.getByLabel(/Payout amount/).fill('30');await page.getByRole('button',{name:'Request payout',exact:true}).click();
  const calls=await page.evaluate(()=>window.calls);assert.equal(calls.find(c=>c.name==='requestWalletPayout').args[1].amountCents,3000);assert.ok(calls.find(c=>c.name==='requestWalletPayout').args[2]);
  await configure({}, {canManagePayouts:false,canManageCredit:true});assert.equal(await page.getByRole('heading',{name:'Bank payouts',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Connect payouts',exact:true}).count(),0);
  await configure({getRestaurantPayoutStatus:{connected:true,status_verified:false,status_unavailable:true}});
  await page.getByText('Payout status could not be verified',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Continue onboarding'}).count(),0);
  await configure();
  fs.mkdirSync('/tmp/restaurant-finance-review',{recursive:true});
  for(const width of [320,390,768,1360,1600])for(const theme of ['light','dark'])for(const lang of ['en','fr','ar']){
   await page.setViewportSize({width,height:1000});await page.evaluate(async({theme,lang})=>{document.documentElement.className=theme==='dark'?'dark':'';document.documentElement.dir=lang==='ar'?'rtl':'ltr';await window.i18n.changeLanguage(lang);},{theme,lang});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`overflow ${width}/${theme}/${lang}`);
   if((width===390||width===1360)&&lang==='en')await page.screenshot({path:`/tmp/restaurant-finance-review/${width}-${theme}.png`,fullPage:true});
  }
  await page.evaluate(async()=>{await window.i18n.changeLanguage('en');document.documentElement.dir='ltr';});
  await page.getByRole('link',{name:'Customer credit Review requests, grants and refunds'}).click();
  assert.ok(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')==='Customer credit'));
  await configure({getRestaurantPayoutStatus:{error:'feature_disabled'}});
  await page.setViewportSize({width:1360,height:1000});
  await page.evaluate(()=>{document.documentElement.className='';window.scrollTo(0,0);});
  await page.getByText('Bank payout setup is unavailable',{exact:true}).waitFor();
  await page.screenshot({path:'/tmp/restaurant-finance-review/preview.png'});
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
