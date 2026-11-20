const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {build}=require('esbuild');const {chromium}=require('playwright-core');
test('itemized quote builder, templates, counterproposal, revision and acceptance remain usable in RTL',{timeout:90000},async()=>{
 const root=path.resolve(__dirname,'..');const en=JSON.parse(fs.readFileSync(path.join(root,'src/locales/en.json'))),ar=JSON.parse(fs.readFileSync(path.join(root,'src/locales/ar.json')));
 const bundle=await build({stdin:{resolveDir:root,loader:'jsx',contents:`
 import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter} from 'react-router-dom';import {createInstance} from 'i18next';import {I18nextProvider} from 'react-i18next';
 import JobQuoteWorkspace from './src/components/JobQuoteWorkspace';import {Context} from '../hooks/useAuth';
 const i18n=createInstance();await i18n.init({lng:'en',resources:{en:{translation:${JSON.stringify(en)}},ar:{translation:${JSON.stringify(ar)}}},interpolation:{escapeValue:false}});
 window.setLanguage=async()=>{await i18n.changeLanguage('ar');document.documentElement.dir='rtl';};
 function Harness(){const[actor,setActor]=React.useState('helper');window.setActor=value=>{window.actor=value;setActor(value);};window.actor=actor;return <Context.Provider value={{user:{id:actor}}}><JobQuoteWorkspace jobId="j1" isOwner={actor==='customer'}/></Context.Provider>;}
 createRoot(document.getElementById('root')).render(<BrowserRouter><I18nextProvider i18n={i18n}><Harness/></I18nextProvider></BrowserRouter>);
 `},bundle:true,write:false,format:'esm',jsx:'automatic',loader:{'.css':'empty'},define:{'import.meta.env':'{}'},plugins:[{name:'quote-fixture',setup(plugin){
 const mocks={
  '../hooks/useAuth':`import React from 'react';export const Context=React.createContext({});export const useAuth=()=>React.useContext(Context);`,
  '../hooks/useAccessProjection':`export const ACCESS_CHANGED_EVENT='oxsteed:access-changed';export default()=>({status:'ready',access:{personal:['helper.offer_services'],activation:{}}});`,
  '../api/axios':`window.quotes=[];window.counters=[];window.templates=[];window.bodies=[];
   const get=async path=>({data:path.endsWith('materials')?{templates:structuredClone(window.templates)}:{quotes:structuredClone(window.quotes),counters:structuredClone(window.counters),customer:window.actor==='customer',currency_code:'USD',job_revision:1,open:true}});
   const make=(body,parent)=>{const subtotal=body.line_items.reduce((sum,row)=>sum+Math.round(row.quantity*row.unit_price_cents),0);const quote={id:'q'+(window.quotes.length+1),job_id:'j1',helper_id:'helper',line_items:body.line_items,tax_rate:body.tax_basis_points/10000,total_cents:subtotal+Math.round(subtotal*body.tax_basis_points/10000),notes:body.notes,version:parent?parent.version+1:1,status:'sent',valid_until:'2099-01-01T12:00:00Z',created_at:'2026-11-20T10:00:00Z',parent_quote_id:parent?.id||null};if(parent)parent.superseded_at='2026-11-20';window.quotes.unshift(quote);return quote;};
   export default {get,
    post:async(path,body)=>{window.bodies.push({path,body});if(window.conflict)throw Object.assign(new Error('stale'),{response:{status:409,data:{code:'quote_version_conflict'}}});
     if(path.endsWith('materials')){const template={...body,id:'t1',version:1};window.templates.push(template);return {data:{template:structuredClone(template)}};}
     if(path.includes('/counters/')&&path.endsWith('/respond')){const proposal=window.counters[0];const parent=window.quotes.find(row=>row.id===proposal.quote_id);proposal.status=body.status;if(body.status==='accepted')make(proposal,parent);return {data:{counter:proposal}};}
     const quoteId=path.split('/').at(-2);const parent=window.quotes.find(row=>row.id===quoteId);
     if(path.endsWith('/counter')){const counter={...body,id:'c1',quote_id:parent.id,status:'pending'};window.counters.push(counter);return {data:{counter}};}
     if(path.endsWith('/respond')){parent.status=body.status;parent.bid_id='bid1';return {data:{quote:parent}};}
     return {data:{quote:make(body,path.endsWith('/revise')?parent:null)}};
    },put:async(path,body)=>{const template={...body,id:'t1',version:2};window.templates=[template];return {data:{template}};},delete:async()=>{window.templates=[];}
   };`
 };plugin.onResolve({filter:/.*/},args=>mocks[args.path]?{path:args.path,namespace:'fixture'}:undefined);plugin.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'jsx',resolveDir:root}));
 }}]});
 const css='*{box-sizing:border-box}body{margin:0;--color-text:#eee;--color-surface:#111827;--color-bg:#0b1220;--color-border:#475569;--color-primary:#fb923c}'+fs.readFileSync(path.join(root,'src/components/HelperWorkPanel.css'),'utf8');
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:320,height:780}});page.setDefaultTimeout(7000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('http://quotes.test/**',route=>new URL(route.request().url()).pathname==='/app.js'?route.fulfill({contentType:'text/javascript',body:bundle.outputFiles[0].text}):route.fulfill({contentType:'text/html',body:'<style>'+css+'</style><div id="root"></div><script type="module" src="/app.js"></script>'}));
  await page.goto('http://quotes.test/jobs/j1');const tr=en.quoteWorkspace;
  await page.getByRole('button',{name:tr.newQuote,exact:true}).click();
  await page.getByLabel(tr.description,{exact:true}).fill('Replace gasket');await page.getByLabel(tr.quantity,{exact:true}).fill('2');await page.getByLabel(tr.price+' (USD)',{exact:true}).fill('12.50');await page.getByLabel(tr.tax,{exact:true}).fill('7.01');await page.getByLabel(tr.notes,{exact:true}).fill('Original scope');
  await page.getByLabel(tr.templateName,{exact:true}).fill('Gasket kit');await page.getByRole('button',{name:tr.saveTemplate,exact:true}).click();
  await page.getByRole('button',{name:tr.useTemplate+': Gasket kit',exact:true}).click();await page.getByLabel(tr.description,{exact:true}).fill('Updated kit');await page.getByRole('button',{name:tr.updateTemplate,exact:true}).click();await page.getByText(tr.templateSaved,{exact:true}).waitFor();
  await page.evaluate(()=>window.conflict=true);await page.getByRole('button',{name:tr.sendQuote,exact:true}).click();await page.getByText(tr.quote_version_conflict,{exact:true}).waitFor();assert.equal(await page.getByLabel(tr.notes,{exact:true}).inputValue(),'Original scope');
  await page.evaluate(()=>window.conflict=false);await page.getByRole('button',{name:tr.sendQuote,exact:true}).click();await page.getByRole('heading',{name:/Version 1/}).waitFor();
  const submitted=await page.evaluate(()=>window.bodies.find(row=>row.path.endsWith('/jobs/j1')).body);assert.equal(submitted.line_items[0].unit_price_cents,1250);assert.equal(submitted.tax_basis_points,701);
  await page.evaluate(()=>window.setActor('customer'));await page.getByRole('button',{name:tr.counterTitle,exact:true}).click();await page.getByLabel(tr.notes,{exact:true}).fill('Customer alternative');await page.getByRole('button',{name:tr.sendCounter,exact:true}).click();
  await page.evaluate(()=>window.setActor('helper'));await page.getByRole('button',{name:tr.acceptCounter,exact:true}).click();await page.getByRole('heading',{name:/Version 2/}).waitFor();await page.getByText(tr.comparePrevious,{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.quotes[0].status),'sent');
  await page.evaluate(()=>window.setActor('customer'));await page.getByRole('button',{name:tr.accept,exact:true}).click();await page.getByRole('link',{name:tr.openBid,exact:true}).waitFor();assert.equal(await page.getByRole('link',{name:tr.openBid,exact:true}).getAttribute('href'),'/bids/bid1');
  await page.evaluate(()=>window.setLanguage());await page.getByRole('heading',{name:ar.quoteWorkspace.title,exact:true}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
