const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {build}=require('esbuild');const {chromium}=require('playwright-core');
test('capacity settings persist, keep stale drafts, reload explicitly and clear after revocation',{timeout:60000},async()=>{
 const root=path.resolve(__dirname,'..'),en=JSON.parse(fs.readFileSync(path.join(root,'src/locales/en.json'))),ar=JSON.parse(fs.readFileSync(path.join(root,'src/locales/ar.json')));
 const bundle=await build({stdin:{resolveDir:root,loader:'jsx',contents:`
 import React from 'react';import {createRoot} from 'react-dom/client';import {createInstance} from 'i18next';import {I18nextProvider} from 'react-i18next';import HelperCapacitySettings from './src/components/HelperCapacitySettings';
 const i18n=createInstance();await i18n.init({lng:'en',resources:{en:{translation:${JSON.stringify(en)}},ar:{translation:${JSON.stringify(ar)}}},interpolation:{escapeValue:false}});window.arabic=async()=>{await i18n.changeLanguage('ar');document.documentElement.dir='rtl';};createRoot(document.getElementById('root')).render(<I18nextProvider i18n={i18n}><HelperCapacitySettings/></I18nextProvider>);
 `},bundle:true,write:false,format:'esm',jsx:'automatic',loader:{'.css':'empty'},define:{'import.meta.env':'{}'},plugins:[{name:'capacity-fixture',setup(plugin){const mocks={
 '../hooks/useAuth':`export const useAuth=()=>({user:{id:'helper'}});`,
 '../hooks/useAccessProjection':`export const ACCESS_CHANGED_EVENT='oxsteed:access-changed';`,
 '../api/axios':`window.policy={daily_job_limit:null,travel_buffer_minutes:0,booking_buffer_minutes:0,capacity_version:1};window.calls=[];
  const deny=()=>{if(window.revoked)throw Object.assign(new Error('revoked'),{response:{status:403}});};
  export default {get:async()=>{deny();return {data:{policy:structuredClone(window.policy)}};},put:async(path,body)=>{deny();window.calls.push(body);if(body.expectedVersion!==window.policy.capacity_version)throw Object.assign(new Error('stale'),{response:{status:409,data:{code:'capacity_version_conflict'}}});window.policy={daily_job_limit:body.daily_job_limit,travel_buffer_minutes:body.travel_buffer_minutes,booking_buffer_minutes:body.booking_buffer_minutes,capacity_version:body.expectedVersion+1};return {data:{policy:structuredClone(window.policy)}};}};`
 };plugin.onResolve({filter:/.*/},args=>mocks[args.path]?{path:args.path,namespace:'fixture'}:undefined);plugin.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'jsx',resolveDir:root}));}}]});
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{const page=await browser.newPage({viewport:{width:320,height:780}});page.setDefaultTimeout(7000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('http://capacity.test/**',route=>new URL(route.request().url()).pathname==='/app.js'?route.fulfill({contentType:'text/javascript',body:bundle.outputFiles[0].text}):route.fulfill({contentType:'text/html',body:'<div id="root"></div><script type="module" src="/app.js"></script>'}));
  await page.goto('http://capacity.test');const tr=en.helperCapacity;
  await page.getByLabel(tr.daily,{exact:true}).fill('2');await page.getByLabel(tr.travel,{exact:true}).fill('30');await page.getByRole('button',{name:tr.save,exact:true}).click();await page.getByText(tr.saved,{exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.calls[0]),{daily_job_limit:2,travel_buffer_minutes:30,booking_buffer_minutes:0,expectedVersion:1});
  await page.evaluate(()=>window.policy.capacity_version++);await page.getByLabel(tr.daily,{exact:true}).fill('5');await page.getByRole('button',{name:tr.save,exact:true}).click();await page.getByText(tr.conflict,{exact:true}).waitFor();assert.equal(await page.getByLabel(tr.daily,{exact:true}).inputValue(),'5');
  await page.getByRole('button',{name:tr.reload,exact:true}).click();await page.getByLabel(tr.daily,{exact:true}).waitFor();assert.equal(await page.getByLabel(tr.daily,{exact:true}).inputValue(),'2');
  await page.getByLabel(tr.daily,{exact:true}).fill('');await page.getByRole('button',{name:tr.save,exact:true}).click();await page.getByText(tr.saved,{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.policy.daily_job_limit),null);
  await page.evaluate(()=>window.arabic());await page.getByRole('heading',{name:ar.helperCapacity.title,exact:true}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.dir),'rtl');
  await page.evaluate(()=>{window.revoked=true;window.dispatchEvent(new Event('oxsteed:access-changed'));});await page.getByText(ar.helperCapacity.loadError,{exact:true}).waitFor();assert.equal(await page.locator('input').count(),0);assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
