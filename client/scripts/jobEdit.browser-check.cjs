const test=require('node:test');const assert=require('node:assert/strict');const http=require('node:http');const fs=require('node:fs');const path=require('node:path');const{build}=require('esbuild');const{chromium}=require('playwright-core');
const root=path.resolve(__dirname,'..');
const catalogs=Object.fromEntries(['en','ar'].map(lang=>[lang,{translation:JSON.parse(fs.readFileSync(path.join(root,`src/locales/${lang}.json`)))}]));
// Job edit page: merge-patch payload, optimistic-concurrency recovery,
// localized field errors, locked fields after hiring, RTL layout.
test('job edit: changed-fields patch, conflict recovery, field errors, and RTL', {timeout:120_000},async()=>{
  const mocks={
    '../context/AuthContext':`import React from 'react';export const AuthContext=React.createContext({});export const useAuth=()=>React.useContext(AuthContext);`,
    '../api/tokenValidator':`export const withTokenValidation=async callback=>callback();`,
    '../api/axios':`export default {get:async(path)=>{const c=window.fixtureConfig;window.calls.push({method:'get',path});
        if(/^\\/jobs\\/[^/]+$/.test(path))return {data:{...window.baseJob,...c.job,id:path.split('/').at(-1)}};return {data:{data:null}};},
      patch:async(path,body,options={})=>{const c=window.fixtureConfig;window.calls.push({method:'patch',path,body,headers:options.headers||{}});
        if(c.patchError){const e=new Error('Synthetic');e.response={status:c.patchError.status,data:c.patchError.data};throw e;}
        return {data:{job:{...window.baseJob,...c.job,...body,version:5},changed_fields:Object.keys(body),bids_flagged_for_reconfirm:1},headers:{etag:'W/"job-j-v5"'}};},
      post:async()=>({data:{}}),put:async()=>({data:{}}),delete:async()=>({data:{}})};`,
    '../components/PageMeta':`export default()=>null;`,
    '../hooks/useSocket':`export const useSocket=()=>({socket:null});`,
    '../api/businesses':`export const redeemVortexToken=async()=>({});`,
    '../api/vortex':`export const previewVortexCode=async()=>({});export const redeemVortexCode=async()=>({});`,
    './PrefetchLink':`export {Link as default} from 'react-router-dom';`,
    './ModeSwitcher':`export default()=>null;`, './BusinessSwitcher':`export default()=>null;`,
    './LanguageSelector':`export default()=>null;`, './ThemeToggle':`export default()=>null;`, './OxSteedNetworkSwitcher':`export default()=>null;`,
  };
  const bundle=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{BrowserRouter,Routes,Route,useNavigate}from'react-router-dom';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{createInstance}from'i18next';import{I18nextProvider}from'react-i18next';import{AuthContext}from'../context/AuthContext';import{CookieConsentProvider}from'./src/context/CookieConsentContext.tsx';import JobEditPage from './src/pages/JobEditPage.jsx';
    const i18n=createInstance();await i18n.init({lng:'en',fallbackLng:'en',resources:${JSON.stringify(catalogs)},interpolation:{escapeValue:false}});
    window.baseJob={client_id:'1',status:'published',version:4,revision:1,bid_count:2,title:'Kitchen sink repair today',original_title:'Kitchen sink repair today',description:'Repair the kitchen sink and inspect the drain for leaks under the cabinet.',category_name:'Plumbing',budget_type:'fixed',budget_min_cents:11000,budget_max_cents:11000,urgency:'flexible',site_access:'easy',recurrence:'none',location_address:'1 Main St',location_city:'Springfield',location_state:'Ohio',location_zip:'45501',location_country:'US',notes:'Gate code 1234',private_notes:null,scheduled_start_at:null};
    window.calls=[];window.n=0;window.fixtureConfig={user:{id:'1',role:'customer'}};
    function Harness(){const[config,setConfig]=React.useState(window.fixtureConfig);const navigate=useNavigate();window.configure=async options=>{const next={user:{id:'1',role:'customer'},...options};window.fixtureConfig=next;await i18n.changeLanguage(next.language||'en');document.documentElement.dir=next.language==='ar'?'rtl':'ltr';setConfig(next);navigate('/jobs/job-'+(++window.n)+'/edit');await new Promise(requestAnimationFrame);};
      return <AuthContext.Provider value={{user:config.user,logout:()=>{}}}><Routes><Route path='/jobs/:id/edit' element={<JobEditPage/>}/><Route path='*' element={<p id='dest'>Destination fixture</p>}/></Routes></AuthContext.Provider>;
    }createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient()}><BrowserRouter><I18nextProvider i18n={i18n}><CookieConsentProvider><Harness/></CookieConsentProvider></I18nextProvider></BrowserRouter></QueryClientProvider>);`,resolveDir:root,loader:'jsx'},bundle:true,write:false,format:'esm',jsx:'automatic',loader:{'.css':'empty'},define:{'import.meta.env':'{}'},plugins:[{name:'job-edit-fixture',setup(plugin){plugin.onResolve({filter:/.*/},args=>args.path.endsWith('/api/axios')?{path:'../api/axios',namespace:'fixture'}:mocks[args.path]?{path:args.path,namespace:'fixture'}:undefined);plugin.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'jsx',resolveDir:root}));}}]});
  const css='*{box-sizing:border-box}body{margin:0}'+fs.readFileSync(path.join(root,'src/index.css'),'utf8').replace(/^@(?:import|config).*$/gm,'')+fs.readFileSync(path.join(root,'src/styles/JobDetailPage.css'),'utf8')+'.ox-navbar .ox-nav-desktop{display:none}';
  const server=http.createServer((req,res)=>{
    if(req.url==='/app.js'){res.setHeader('Content-Type','application/javascript');res.end(bundle.outputFiles[0].contents);}
    else if(req.url==='/style.css'){res.setHeader('Content-Type','text/css');res.end(css);}
    else res.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try{
    browser=await chromium.launch({headless:true,channel:'chrome'});const page=await browser.newPage();page.setDefaultTimeout(5000);const errors=[];page.on('pageerror',error=>{errors.push(error.message);console.error('Browser error:',error.message);});
    await page.goto(`http://127.0.0.1:${server.address().port}/jobs/initial/edit`);await page.waitForFunction(()=>window.configure);
    const configure=async config=>{await page.evaluate(c=>window.configure(c),config);};
    const field=name=>page.locator(`[id$="-${name}"]`).first();
    const lastPatch=()=>page.evaluate(()=>window.calls.filter(c=>c.method==='patch').at(-1));

    // 1. Prefill from original text; only changed fields are sent with the version.
    await configure({});await page.waitForTimeout(800);const title=page.getByLabel('Title *',{exact:true});await title.waitFor();
    assert.equal(await title.inputValue(),'Kitchen sink repair today');
    await page.getByText('Helpers have already bid',{exact:false}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Save changes'}).isDisabled(),true);
    await title.fill('Kitchen sink and faucet repair');await page.getByLabel('Budget',{exact:true}).fill('95.50');
    await page.getByText('These changes will ask every current bidder to reconfirm.').waitFor();
    await page.getByRole('button',{name:'Save changes'}).click();await page.locator('#dest').waitFor();
    const sent=await lastPatch();
    assert.deepEqual(sent.body,{title:'Kitchen sink and faucet repair',budget_min_cents:9550,budget_max_cents:9550,expected_version:4});
    assert.ok(sent.headers['Idempotency-Key']);

    // 2. Concurrent edit: conflict message, then reload restores the server copy.
    await configure({patchError:{status:409,data:{code:'version_conflict'}}});await page.getByLabel('Title *',{exact:true}).fill('Kitchen sink repair (updated)');
    await page.getByRole('button',{name:'Save changes'}).click();
    await page.getByText('Someone changed this job while you were editing.',{exact:false}).waitFor();
    const key1=(await lastPatch()).headers['Idempotency-Key'];
    await page.getByRole('button',{name:'Load the latest version'}).click();
    await page.waitForFunction(()=>document.querySelector('[id$="-title"]')?.value==='Kitchen sink repair today');
    await page.getByLabel('Title *',{exact:true}).fill('Kitchen sink repair (again)');await page.getByRole('button',{name:'Save changes'}).click();
    await page.getByText('Someone changed this job',{exact:false}).waitFor();
    assert.notEqual((await lastPatch()).headers['Idempotency-Key'],key1,'a new submit after a final error uses a new idempotency key');

    // 3. Server field codes are localized on the matching inputs.
    await configure({patchError:{status:422,data:{code:'validation_failed',fields:{location_city:'required',budget_max_cents:'budget_order'}}}});
    await page.getByLabel('Notes for helpers',{exact:true}).fill('Dog is friendly');await page.getByRole('button',{name:'Save changes'}).click();
    await page.getByText('This field is required.').waitFor();
    assert.equal(await page.getByLabel('City *',{exact:true}).getAttribute('aria-invalid'),'true');

    // 4. Client-side validation blocks a too-short title without a request.
    await configure({});const before=await page.evaluate(()=>window.calls.length);
    await page.getByLabel('Title *',{exact:true}).fill('short');await page.getByRole('button',{name:'Save changes'}).click();
    await page.getByText('This is too short.').waitFor();
    assert.equal(await page.evaluate(b=>window.calls.slice(b).filter(c=>c.method==='patch').length,before),0);

    // 5. After hiring, owners are sent to change orders; admins see price/scope locked.
    await configure({job:{status:'accepted',can_edit:false}});await page.getByText('Jobs can be edited until a helper is hired.',{exact:false}).waitFor();
    await configure({user:{id:'9',role:'admin'},job:{status:'accepted',can_edit:true}});await page.getByLabel('Title *',{exact:true}).waitFor();
    assert.equal(await page.getByLabel('Budget type',{exact:true}).isDisabled(),true);assert.equal(await page.getByLabel('Description *',{exact:true}).isDisabled(),true);

    // 6. Arabic renders right-to-left without horizontal overflow on small and large screens.
    await configure({language:'ar'});await page.getByRole('heading',{name:'عدّل مهمتك'}).waitFor();
    for(const width of [320,768,1360]){await page.setViewportSize({width,height:900});
      assert.equal(await page.evaluate(()=>document.documentElement.dir),'rtl');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`overflow ar ${width}`);}
    assert.deepEqual(errors,[]);
  }finally{await browser?.close();server.close();}
});
