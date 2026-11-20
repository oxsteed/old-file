const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');
test('helper work preserves drafts, resolves conflicts, shares updates and clears revoked data in RTL', {timeout:60000}, async()=>{
 const root=path.resolve(__dirname,'..');
 const en=JSON.parse(fs.readFileSync(path.join(root,'src/locales/en.json')));
 const ar=JSON.parse(fs.readFileSync(path.join(root,'src/locales/ar.json')));
 const bundle=await build({stdin:{resolveDir:root,loader:'jsx',contents:`
 import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter} from 'react-router-dom';
 import {createInstance} from 'i18next';import {I18nextProvider} from 'react-i18next';import HelperWorkPanel,{JobWorkRecord} from './src/components/HelperWorkPanel';import BidDeadlineNotice from './src/components/BidDeadlineNotice';
 const i18n=createInstance();await i18n.init({lng:'en',resources:{en:{translation:${JSON.stringify(en)}},ar:{translation:${JSON.stringify(ar)}}},interpolation:{escapeValue:false}});
 window.setLanguage=async()=>{await i18n.changeLanguage('ar');document.documentElement.dir='rtl';};
 createRoot(document.getElementById('root')).render(<BrowserRouter><I18nextProvider i18n={i18n}>{location.search?<HelperWorkPanel/>:<><BidDeadlineNotice bid={{status:"pending",expires_at:"2000-01-01",job_id:"job-1"}}/><BidDeadlineNotice bid={{status:"pending",needs_reconfirm:true,job_id:"job-2"}}/><JobWorkRecord jobId="job-1"/></>}</I18nextProvider></BrowserRouter>);
 `},bundle:true,write:false,format:'esm',jsx:'automatic',loader:{'.css':'empty'},define:{'import.meta.env':'{}'},plugins:[{name:'work-fixtures',setup(plugin){
  const mocks={
   '../hooks/useAuth':`export const useAuth=()=>({user:{id:'helper'}});`,
   '../api/access':`export const accessAPI={listRequests:async()=>({requests:[{id:'request-1',capability:'helper.offer_services',status:'needs_information'}]})};`,
   '../api/axios':`window.calls=[];window.work={version:0,checklist:[],private_notes:'',handover:'',aftercare:''};window.templates=[];window.updates=[];
    const denied=()=>{if(window.revoked)throw Object.assign(new Error('revoked'),{response:{status:403,data:{code:'access_required'}}});};
    export default {
     get:async path=>{denied();if(window.delayWork&&path.includes('work-records')){window.delayWork=false;const prior={work:structuredClone(window.work),updates:structuredClone(window.updates),writable:true};await new Promise(resolve=>window.releaseWork=resolve);window.obsoleteReleased=true;return {data:prior};}return {data:path.endsWith('work-board')?{jobs:[{id:'job-1',title:'Repair gasket',status:'accepted'}]}:path.endsWith('work-templates')?{templates:structuredClone(window.templates)}:{work:structuredClone(window.work),updates:structuredClone(window.updates),writable:true}};},
     put:async(path,body)=>{denied();window.calls.push({path,body});if(window.conflict)throw Object.assign(new Error('conflict'),{response:{status:409,data:{code:'work_version_conflict'}}});window.work={...body,version:body.expectedVersion+1};return {data:{version:window.work.version}};},
     post:async(path,body)=>{denied();if(path.endsWith('work-templates')){const template={id:'t1',name:body.name,items:body.items.map(item=>({...item,done:false}))};window.templates.push(template);return {data:{template}};}const update={id:'u1',body:body.body,created_at:'2026-11-19T10:00:00Z'};window.updates=[update];return {data:{update}};},
     delete:async()=>{denied();window.templates=[];}
    };`
  };
  plugin.onResolve({filter:/.*/},args=>mocks[args.path]?{path:args.path,namespace:'fixture'}:undefined);
  plugin.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'jsx',resolveDir:root}));
 }}]});
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
  const page=await browser.newPage({viewport:{width:320,height:780}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('http://work.test/**',route=>new URL(route.request().url()).pathname==='/app.js'?route.fulfill({contentType:'text/javascript',body:bundle.outputFiles[0].text}):route.fulfill({contentType:'text/html',body:'<div id="root"></div><script type="module" src="/app.js"></script>'}));
  await page.goto('http://work.test/jobs/1');
  await page.getByText(en.helperWork.bidExpired,{exact:true}).waitFor();
  assert.equal(await page.getByRole('link',{name:en.helperWork.reviewChanges,exact:true}).getAttribute('href'),'/jobs/job-2');
  await page.getByLabel(en.helperWork.privateNotes,{exact:true}).fill('Private note retained on conflict');
  await page.getByLabel(en.helperWork.newTask,{exact:true}).fill('Bring replacement seal');
  await page.getByRole('button',{name:en.helperWork.add,exact:true}).click();
  await page.getByRole('checkbox',{name:'Bring replacement seal'}).check();
  await page.getByLabel(en.helperWork.handover,{exact:true}).fill('Seal fitted and checked');
  await page.getByLabel(en.helperWork.aftercare,{exact:true}).fill('Check for leaks tomorrow');
  await page.evaluate(()=>window.conflict=true);
  await page.getByRole('button',{name:en.helperWork.save,exact:true}).click();
  await page.getByText(en.helperWork.conflict,{exact:true}).waitFor();
  assert.equal(await page.getByLabel(en.helperWork.privateNotes,{exact:true}).inputValue(),'Private note retained on conflict');
  await page.evaluate(()=>window.conflict=false);
  await page.getByRole('button',{name:en.helperWork.save,exact:true}).click();
  await page.getByText(en.helperWork.saved,{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.work.checklist[0].done),true);
  await page.getByLabel(en.helperWork.templateName,{exact:true}).fill('Plumbing kit');
  await page.getByRole('button',{name:en.helperWork.saveTemplate,exact:true}).click();
  await page.getByRole('button',{name:en.helperWork.useTemplate+': Plumbing kit',exact:true}).click();
  assert.equal(await page.getByRole('checkbox',{name:'Bring replacement seal'}).isChecked(),false);
  await page.getByLabel(en.helperWork.sharedHelp,{exact:true}).fill('Replacement fitted');
  await page.getByRole('button',{name:en.helperWork.publish,exact:true}).click();
  await page.getByText('Replacement fitted',{exact:true}).waitFor();
  await page.evaluate(()=>window.setLanguage());
  await page.getByRole('heading',{name:ar.helperWork.recordTitle}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.dir),'rtl');
  await page.evaluate(()=>{window.delayWork=true;window.dispatchEvent(new Event('oxsteed:access-changed'));});
  await page.waitForFunction(()=>typeof window.releaseWork==='function');
  await page.evaluate(()=>{window.revoked=true;window.dispatchEvent(new Event('oxsteed:access-changed'));});
  await page.getByText(ar.helperWork.loadError,{exact:true}).waitFor();
  await page.evaluate(()=>window.releaseWork());
  await page.waitForFunction(()=>window.obsoleteReleased);
  await page.evaluate(()=>new Promise(requestAnimationFrame));
  assert.equal(await page.locator('textarea').count(),0);
  assert.equal(await page.getByText('Replacement fitted',{exact:true}).count(),0);
  await page.goto('http://work.test/jobs/1?board=1');
  await page.getByRole('link',{name:'Repair gasket',exact:true}).waitFor();
  assert.equal(await page.getByRole('link',{name:en.helperWork.answerQuestion,exact:true}).getAttribute('href'),'/settings/applications?request=request-1');
  await page.getByRole('button',{name:en.helperWork.openRecord,exact:true}).click();
  await page.getByLabel(en.helperWork.privateNotes,{exact:true}).waitFor();
  await page.evaluate(()=>{window.revoked=true;window.dispatchEvent(new Event('oxsteed:access-changed'));});
  await page.getByText(en.helperWork.loadError,{exact:true}).waitFor();
  assert.equal(await page.getByRole('link',{name:'Repair gasket',exact:true}).count(),0);
  assert.deepEqual(errors,[]);
 } finally {await browser.close();}
});
