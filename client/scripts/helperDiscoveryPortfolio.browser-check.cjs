const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {build}=require('esbuild'),{chromium}=require('playwright-core');
test('saved radius refreshes nearby jobs and consent supports private upload, approval, revocation and stale drafts',{timeout:60000},async()=>{
 const root=path.resolve(__dirname,'..'),en=JSON.parse(fs.readFileSync(path.join(root,'src/locales/en.json'))),ar=JSON.parse(fs.readFileSync(path.join(root,'src/locales/ar.json')));
 const bundle=await build({stdin:{resolveDir:root,loader:'jsx',contents:`
 import React from 'react';import{createRoot}from'react-dom/client';import{createInstance}from'i18next';import{I18nextProvider}from'react-i18next';
 import Discovery from './src/components/HelperDiscoverySettings';import Suitability from './src/components/JobSuitabilityPreview';import Consent from './src/components/JobPortfolioConsent';import useNearbyJobs from './src/hooks/useNearbyJobs';
 const i18n=createInstance();await i18n.init({lng:'en',resources:{en:{translation:${JSON.stringify(en)}},ar:{translation:${JSON.stringify(ar)}}},interpolation:{escapeValue:false}});
 window.arabic=async()=>{await i18n.changeLanguage('ar');document.documentElement.dir='rtl';};
 function Nearby(){const state=useNearbyJobs({enabled:true,city:'Springfield',state:'OH',accountId:'helper'});return <output data-testid="nearby">{state.status}:{state.jobs.map(j=>j.title).join(',')}</output>;}
 function App(){const[account,setAccount]=React.useState('helper');window.accountSwitch=()=>{window.account='customer';setAccount('customer');};return <I18nextProvider i18n={i18n}><div key={account}>{account==='helper'&&<><Discovery/><Nearby/><Suitability jobId="job"/></>}<Consent jobId="job"/></div></I18nextProvider>;}
 createRoot(document.getElementById('root')).render(<App/>);
 `},bundle:true,write:false,format:'esm',jsx:'automatic',loader:{'.css':'empty'},define:{'import.meta.env':'{}'},plugins:[{name:'discovery-fixtures',setup(p){const mocks={
 '../hooks/useAuth':`export const useAuth=()=>({user:{id:window.account||'helper'},hasHelperAccess:true});`,
 '../hooks/useAccessProjection':`export const ACCESS_CHANGED_EVENT='oxsteed:access-changed';`,
 '../utils/browserLocation':`export const getSharedBrowserLocation=async()=>({lat:39,lng:-83});`,
 '../api/axios':`
 window.preferences={opportunity_radius_miles:25,discovery_version:1};window.calls=[];window.requests=[];
 const fail=(status,code)=>{throw Object.assign(new Error(code),{response:{status,data:{code}}});};
 const deny=()=>{if(window.revoked)fail(403,'access_required');};
 export default {get:async(path,config)=>{deny();window.calls.push({path,config});
 if(path==='/helpers/me/discovery')return {data:{preferences:structuredClone(window.preferences)}};
 if(path==='/geo/reverse')return {data:{city:'Springfield',state:'OH'}};
 if(path==='/jobs')return {data:{jobs:[{id:'nearby',title:'Nearby work'}]}};
 if(path.includes('/suitability/'))return {data:{can_bid_now:true,schedule:'conflict',requirements:['Bring ladder'],required_skills:['Painting']}};
 if(path.includes('/portfolio-requests/'))return {data:{requests:structuredClone(window.requests),customer:window.account==='customer',can_request:window.account!=='customer'}};
 throw new Error(path);},put:async(path,body)=>{deny();window.calls.push({path,body});
 if(body.expectedVersion!==window.preferences.discovery_version)fail(409,'discovery_version_conflict');window.preferences={opportunity_radius_miles:body.opportunity_radius_miles,discovery_version:body.expectedVersion+1};return {data:{preferences:structuredClone(window.preferences)}};
 },post:async(path,body)=>{deny();window.calls.push({path,body:body instanceof FormData?'upload':body});
 if(path.endsWith('/upload'))return {data:{key:'portfolio-private/helper/job/photo.jpg'}};
 if(body.requestId){window.requests.push({id:'permission',caption:body.caption,media_url:'http://storage.test/image',status:'pending',version:1,events:[{status:'pending',created_at:'2030-01-01T00:00:00Z'}]});}
 else{const row=window.requests[0];if(row.version!==body.expectedVersion)fail(409,'portfolio_version_conflict');row.status=body.status;row.version++;row.events.push({status:body.status,created_at:'2030-01-02T00:00:00Z'});}
 return {data:{}};}};`
 };p.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'fixture'}:undefined);p.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'jsx',resolveDir:root}));}}]});
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{const page=await browser.newPage({viewport:{width:320,height:780}});page.setDefaultTimeout(7000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const css=fs.readFileSync(path.join(root,'src/components/HelperWorkPanel.css'),'utf8');
 await page.route('http://discovery.test/**',route=>new URL(route.request().url()).pathname==='/app.js'?route.fulfill({contentType:'text/javascript',body:bundle.outputFiles[0].text}):route.fulfill({contentType:'text/html',body:`<style>${css}</style><div id="root"></div><script type="module" src="/app.js"></script>`}));
 await page.goto('http://discovery.test');const d=en.helperDiscovery,s=en.helperSuitability,c=en.portfolioConsent;
 await page.getByText(s.schedule_conflict,{exact:true}).waitFor();await page.getByText('Bring ladder',{exact:true}).waitFor();
 await page.waitForFunction(()=>window.calls.some(c=>c.path==='/jobs'&&c.config.params.radius===25));
 await page.getByLabel(d.radius,{exact:true}).fill('60');await page.getByRole('button',{name:d.save,exact:true}).click();await page.getByText(d.saved,{exact:true}).waitFor();
 await page.waitForFunction(()=>window.calls.some(c=>c.path==='/jobs'&&c.config.params.radius===60));
 await page.evaluate(()=>window.preferences.discovery_version++);await page.getByLabel(d.radius,{exact:true}).fill('100');await page.getByRole('button',{name:d.save,exact:true}).click();await page.getByText(d.conflict,{exact:true}).waitFor();assert.equal(await page.getByLabel(d.radius,{exact:true}).inputValue(),'100');
 await page.getByRole('button',{name:d.reload,exact:true}).click();await page.waitForFunction(()=>document.querySelector('input[type=number]')?.value==='60');
 await page.getByLabel(c.url,{exact:true}).setInputFiles({name:'wall.png',mimeType:'image/png',buffer:Buffer.from('fixture')});await page.getByText(c.uploaded,{exact:true}).waitFor();
 await page.getByLabel(c.caption,{exact:true}).fill('Painted wall');await page.getByRole('button',{name:c.request,exact:true}).click();await page.getByText('Painted wall',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:c.approve,exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:c.withdraw,exact:true}).count(),1);
 await page.evaluate(()=>window.accountSwitch());await page.getByRole('button',{name:c.approve,exact:true}).click();await page.getByRole('button',{name:c.revoke,exact:true}).waitFor();
 await page.evaluate(()=>window.requests[0].version++);await page.getByRole('button',{name:c.revoke,exact:true}).click();await page.getByText(c.conflict,{exact:true}).waitFor();
 await page.getByRole('button',{name:c.reload,exact:true}).click();await page.getByRole('button',{name:c.revoke,exact:true}).click();await page.getByText(c.revoked,{exact:true}).first().waitFor();
 await page.evaluate(()=>window.arabic());await page.getByRole('heading',{name:ar.portfolioConsent.title,exact:true}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.dir),'rtl');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.evaluate(()=>{window.revoked=true;window.dispatchEvent(new Event('oxsteed:access-changed'));});await page.getByText(ar.portfolioConsent.loadError,{exact:true}).waitFor();assert.equal(await page.getByText('Painted wall',{exact:true}).count(),0);assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
