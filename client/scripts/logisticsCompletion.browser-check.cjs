// Real Logistics components, synthetic users/orders/providers only.
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const http=require('node:http');
const {build}=require('esbuild');const {chromium}=require('playwright-core');
const root=path.resolve(__dirname,'..');
const apiNames=[...fs.readFileSync(path.join(root,'src/api/logistics.js'),'utf8').matchAll(/export const (\w+)/g)].map(m=>m[1]);
async function fixture(){
 const mocks={
 'react-i18next':`const translate=(key,options={})=>{const s=key.split('.').reduce((a,k)=>a?.[k],window.catalog);return String(typeof s==='string'?s:options.defaultValue??key).replace(/\\{\\{(\\w+)\\}\\}/g,(_,k)=>options[k]??'');};export const useTranslation=()=>({t:translate,i18n:{language:document.documentElement.lang}});`,
 '../../context/AuthContext':`import React,{createContext,useContext,useState} from 'react';const Context=createContext({});export const useAuth=()=>useContext(Context);export function AuthProvider({children}){const [user,setUser]=useState({id:'synthetic-admin',role:'admin'});window.switchUser=setUser;return <Context.Provider value={{user}}>{children}</Context.Provider>;}`,
 '../../api/logistics':apiNames.map(name=>`export const ${name}=(...args)=>window.fixtureApi('${name}',...args);`).join('\n'),
 '../../components/PageShell':`export default function PageShell({children}){return <><nav>OxSteed</nav><main>{children}</main><footer>OxSteed</footer></>}`,
 '../../components/PageMeta':`export default ()=>null;`,
 '@stripe/stripe-js':`export const loadStripe=async()=>null;`,
 '@stripe/react-stripe-js':`export const Elements=({children})=>children;export const CardElement=()=>null;export const useElements=()=>null;export const useStripe=()=>null;`,
 };
 const result=await build({stdin:{resolveDir:root,loader:'jsx',contents:`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{BrowserRouter,Routes,Route,Link}from'react-router-dom';import{AuthProvider}from'../../context/AuthContext';import Boundary from './src/components/logistics/LogisticsRouteBoundary';import Home from './src/pages/logistics/LogisticsHomePage';import Checkout from './src/pages/logistics/CheckoutPage';import Operations from './src/pages/logistics/OperationsFinancePage';import Allocation from './src/pages/logistics/AllocationDetailPage';import Organizer from './src/pages/logistics/OrganizerDashboardPage';import Guard from './src/components/logistics/UnsavedChangesGuard';function Form(){const [v,setV]=useState('');return <><input aria-label="Draft" value={v} onChange={e=>setV(e.target.value)}/><Guard when={!!v}/><Link to="/logistics">Leave</Link></>};createRoot(document.getElementById('root')).render(<AuthProvider><BrowserRouter><Boundary><Routes><Route path="/logistics" element={<Home/>}/><Route path="/logistics/checkout" element={<Checkout/>}/><Route path="/logistics/operations/finance" element={<Operations/>}/><Route path="/logistics/allocations/:id" element={<Allocation/>}/><Route path="/logistics/organizer" element={<Organizer/>}/><Route path="/logistics/form" element={<Form/>}/></Routes></Boundary></BrowserRouter></AuthProvider>);`},bundle:true,write:false,jsx:'automatic',define:{'import.meta':'{"env":{}}'},loader:{'.css':'empty'},plugins:[{name:'fixtures',setup(p){p.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'fixture'}:undefined);p.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'jsx',resolveDir:root}));}}]});
 const cssPaths=['index.css','styles/logistics/LogisticsHomePage.css','styles/logistics/LogisticsWorkspaces.css','styles/logistics/LogisticsCheckout.css','styles/logistics/LogisticsModal.css','styles/logistics/LogisticsOperations.css','styles/logistics/LogisticsStatusPill.css','components/logistics/LogisticsLayout.css','components/logistics/LogisticsNav.css','components/logistics/CampaignBrowser.css'];
 const css=cssPaths.map(p=>fs.readFileSync(path.join(root,'src',p),'utf8')).join('\n');
 const server=http.createServer((req,res)=>{if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(result.outputFiles[0].text);}else if(req.url==='/style.css'){res.setHeader('Content-Type','text/css');res.end(css);}else{res.setHeader('Content-Type','text/html');res.end('<link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/bundle.js"></script>');}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));return{server,url:`http://127.0.0.1:${server.address().port}`};
}
async function seed(page,lang='en',dark=false){const catalog=JSON.parse(fs.readFileSync(path.join(root,`src/i18n/locales/${lang}/common.json`),'utf8'));
 await page.addInitScript(({catalog,lang,dark})=>{window.catalog=catalog;document.addEventListener('DOMContentLoaded',()=>{document.documentElement.lang=lang;document.documentElement.dir=lang==='ar'?'rtl':'ltr';document.documentElement.classList.toggle('dark',dark);},{once:true});window.calls=[];window.quoteRows=[];window.contextDelay=0;
 const quote={id:1,reference:'SYNTHETIC',version:2,status:'accepted',currency:'USD',total_cents:15000,deposit_cents:4500,final_cents:10500,line_items:[{label:'Synthetic goods',amount_cents:15000}],pending_version:null,schedule:[{installment:'deposit',amount_cents:4500,outstanding_cents:1500,paid_cents:3000,status:'unpaid'},{installment:'final',amount_cents:10500,outstanding_cents:10500,paid_cents:0,status:'unpaid'}]};
 window.fixtureApi=async(name,...args)=>{window.calls.push({name,args});if(name==='getCheckoutContext'){const account=window.currentAccount||'first';await new Promise(r=>setTimeout(r,window.contextDelay));return{data:{subject:{kind:'purchase_order',id:1,reference:account,title:'Synthetic order',qty:2},quote,credit:{rail_enabled:true,eligible:true,balance_cents:100000},active_attempts:location.search.includes('resume=1')?[{id:91,installment:'deposit',method:'credit',status:'processing',amount_cents:1500,idempotency_key:'11111111-2222-4333-8555-555555555555'}]:window.activeAttempts||[]}};}
 if(name==='getDashboardCounts') {if(location.search.includes('counts_error=1')&&!window.countsRecovered)throw new Error('Synthetic count service unavailable');return {counts:{totalCampaigns:0,activeCampaigns:0,needingMomentum:0,committedUnits:0,openCommitments:0,handoffDeliveries:0,totalDeliveries:0,totalShipments:0}};}
 if(name==='listOrganizerCampaigns')return {orders:[]};if(name==='getMyParticipation'||name==='listDeliveries')return {data:[]};if(name==='listShipments')return {shipments:[]};
 if(name==='createPaymentAttempt')return{data:{attempt:{id:51,status:'succeeded',method:'credit',amount_cents:args[0].amount_cents,settled_at:new Date().toISOString()}}};
 if(name==='listCampaigns')return{items:[{id:7,title:'Synthetic campaign',lane_name:'Test lane',target_moq:100,current_committed_qty:50,status:'open',unit_landed_cost_usd:15}],total:1,orders:[{id:7,title:'Synthetic campaign',target_moq:100,current_committed_qty:50,status:'open',unit_landed_cost_usd:15}]};
 if(name==='getCampaign')return{data:{id:7,title:'Synthetic campaign',status:'open',target_moq:100,current_committed_qty:50}};
 if(name==='listLanes')return{data:[]};if(name==='getBusinessProcurementAccess')return{businesses:[]};
 if(name==='listLogisticsReconciliation'||name==='listLogisticsExceptions')return{data:{items:[]}};
 if(name==='listStaffQuotes')return{data:{quotes:window.quoteRows}};
 if(name==='createQuote'){window.quoteRows=[{...args[0],id:1,reference:'DRAFT',version:1,total_cents:1000,status:'draft'}];return{data:{quote:window.quoteRows[0]}};}
 if(name==='publishQuote'){window.quoteRows[0].status='active';return{data:{quote:window.quoteRows[0]}};}
 if(name==='getAllocation')return{data:{id:1,reference:'ALC-1',buyer_name:'Synthetic buyer',status:'pending',allocated_qty:2,warehouse_name:'Synthetic warehouse'}};
 return{data:{items:[]}};};},{catalog,lang,dark});
 return catalog;
}
test('Logistics responsive layouts, previews, quote actions, checkout delta and account isolation',{timeout:120000},async()=>{
 const f=await fixture();const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[];
 try{
  for(const lang of ['fr','ar'])for(const dark of [false,true])for(const width of [320,390,768,1360,1600]){
   const page=await browser.newPage({viewport:{width,height:1000}});page.on('pageerror',e=>errors.push(e.message));const catalog=await seed(page,lang,dark);
   for(const route of ['/logistics','/logistics/checkout?purchase_order_id=1','/logistics/operations/finance','/logistics/allocations/1']){
    await page.goto(f.url+route);
    const title=route.includes('checkout')?catalog.logistics.checkout.title:route.includes('operations')?catalog.logistics.staff.title:route.includes('allocations')?catalog.logistics.modal.allocationPreviewTitle:catalog.logistics.hub.title;
    await page.getByRole('heading',{name:title,exact:true}).first().waitFor({timeout:3000}).catch(async e=>{throw new Error(route+' '+await page.locator('body').innerText()+' '+errors.join(';'));});
    if(process.env.LOGISTICS_BROWSER_ARTIFACT_DIR && route.includes('operations') && ((width===320&&lang==='ar'&&dark)||(width===1360&&lang==='fr'&&!dark))){fs.mkdirSync(process.env.LOGISTICS_BROWSER_ARTIFACT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.LOGISTICS_BROWSER_ARTIFACT_DIR,`operations-${width}-${lang}-${dark?'dark':'light'}.png`),fullPage:true,animations:'disabled'});}
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,`${route} ${width} ${lang} overflow`);
    assert.equal(await page.evaluate(()=>[...document.querySelectorAll('.lx-btn-secondary')].some(el=>{const s=getComputedStyle(el);return s.color===s.backgroundColor;})),false,`${route} secondary action contrast`);
    assert.equal(/logistics\.[a-z]/.test(await page.locator('main').innerText()),false,`${route} untranslated label: ${await page.locator('main').innerText()}`);
   }
   await page.close();
  }
  const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));const c=await seed(page);
  await page.goto(f.url+'/logistics');await page.getByRole('button',{name:c.logistics.tables.preview,exact:true}).click();await page.getByRole('dialog').waitFor();await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.querySelector('[role=dialog]').contains(document.activeElement)),true);await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
  await page.goto(f.url+'/logistics/checkout?purchase_order_id=1');await page.getByRole('radio',{name:/OxSteed Credit/}).check();await page.getByRole('button',{name:c.logistics.checkout.confirm.continue}).click();await page.getByRole('checkbox').check();await page.getByRole('button',{name:/Confirm and pay/}).click();
  assert.equal(await page.evaluate(()=>window.calls.find(c=>c.name==='createPaymentAttempt').args[0].amount_cents),1500);
  await page.goto(f.url+'/logistics/operations/finance');const labels=c.logistics.staff;
  await page.getByLabel(labels.id,{exact:true}).fill('1');await page.getByLabel(labels.description,{exact:true}).fill('Synthetic goods');await page.getByLabel(labels.amount,{exact:true}).fill('10');await page.getByLabel(labels.deadline,{exact:true}).first().fill('2026-12-01T12:00');await page.getByLabel(labels.finalDeadline,{exact:true}).fill('2026-12-10T12:00');await page.getByLabel(c.logistics.checkout.sections.terms,{exact:true}).fill('Staff-reviewed refunds');await page.getByRole('button',{name:labels.save,exact:true}).click();await page.getByRole('button',{name:labels.publish,exact:true}).click();
  assert.equal(await page.evaluate(()=>window.quoteRows[0].status),'active');
  await page.goto(f.url+'/logistics/checkout?purchase_order_id=1&resume=1');await page.getByRole('button',{name:c.logistics.checkout.confirm.continue}).click();await page.getByRole('checkbox').check();await page.getByRole('button',{name:/Confirm and pay/}).click();
  assert.equal(await page.evaluate(()=>window.calls.find(c=>c.name==='createPaymentAttempt').args[1]),'11111111-2222-4333-8555-555555555555');
  await page.goto(f.url+'/logistics/form');await page.getByLabel('Draft').fill('Unsaved');await page.getByText('Leave',{exact:true}).click();await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');assert.equal(await page.getByLabel('Draft').inputValue(),'Unsaved');
  await page.evaluate(()=>window.switchUser({id:'second-account',role:'admin'}));await page.waitForFunction(()=>document.querySelector('[aria-label=Draft]')?.value==='');assert.equal(await page.getByLabel('Draft').inputValue(),'');
  await page.evaluate(()=>{window.currentAccount='old-account';window.contextDelay=300;window.history.pushState({},'', '/logistics/checkout?po_id=1');window.dispatchEvent(new PopStateEvent('popstate'));});
  await page.waitForFunction(()=>window.calls.some(c=>c.name==='getCheckoutContext'));
  await page.evaluate(()=>{window.currentAccount='new-account';window.switchUser({id:'third-account',role:'admin'});});
  await page.getByText('new-account',{exact:true}).waitFor();assert.equal(await page.getByText('old-account',{exact:true}).count(),0);
  await page.goto(f.url+'/logistics/organizer?counts_error=1');await page.getByRole('alert').getByRole('heading',{name:c.logistics.workspace.dataError.title}).waitFor();
  assert.equal(await page.locator('.lx-overview-strip').getByText(c.logistics.workspace.dataError.body,{exact:true}).count(),2);
  assert.equal(await page.locator('.lx-mini-list').innerText().then(s=>/0 campaigns|0 delivery/.test(s)),false);
  await page.evaluate(()=>window.countsRecovered=true);await page.getByRole('button',{name:c.logistics.workspace.dataError.retry,exact:true}).click();await page.getByRole('alert').waitFor({state:'detached'});
  await page.locator('.lx-overview-strip').getByRole('link',{name:c.logistics.campaigns.new.nextStepLabel,exact:true}).waitFor();
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(r=>f.server.close(r));}
});
