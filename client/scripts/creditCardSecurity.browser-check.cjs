const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');
const root = path.resolve(__dirname, '..');

async function fixture() {
  const api = `
    const record = (action, payload, key) => { window.writes.push({action,payload,key}); };
    export const listOxsteedCreditCards = async () => window.cards;
    export const issueOxsteedCreditVirtualCard = async () => ({});
    export const requestOxsteedCreditPhysicalCard = async () => ({});
    export const activateOxsteedCreditCard = async (id,payload,key) => { record('activate',payload,key); return {}; };
    export const freezeOxsteedCreditCard = async () => ({});
    export const unfreezeOxsteedCreditCard = async (id,payload,key) => { record('unfreeze',payload,key); return {}; };
    export const reportOxsteedCreditCardLost = async (id,payload) => { record('report',payload); return {}; };
    export const setOxsteedCreditCardPin = async (id,payload,key) => { record('pin_set',payload,key); return {}; };
    export const issueCreditCardSecurityChallenge = async (id,payload) => { record('challenge',payload); return {challenge:{id:'fixture-grant'}}; };
    export const getCreditCardHistory = async () => ({events:[{id:'1',action:'credit.card.lost',actor:'you',createdAt:'2026-10-05T12:00:00Z'}],pagination:{nextOffset:null}});
    export const markCreditCardFound = async () => { record('found'); return {}; };
    export const requestCreditCardReplacement = async () => ({replacementPending:true});
  `;
  const mocks = {
    'react-i18next': `export const useTranslation=()=>({t:(key,options={})=>{const value=key.split('.').reduce((o,p)=>o?.[p],window.catalog);return typeof value==='string'?value:options.defaultValue||key;},i18n:{resolvedLanguage:window.language}});`,
    '../../api/oxsteedCredit': api,
    '../../components/Navbar': 'export default ()=>null;',
    '../../components/Footer': 'export default ()=>null;',
    '../../components/PageMeta': 'export default ()=>null;',
    '../../components/AddressAutocomplete': 'import React from "react";export default ()=> <input/>;',
  };
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'jsx', contents: `import React from 'react';import {createRoot} from 'react-dom/client';
      import {BrowserRouter} from 'react-router-dom';import Cards from './src/pages/food/OxsteedCreditCardsPage.jsx';
      createRoot(document.getElementById('root')).render(<BrowserRouter><Cards/></BrowserRouter>);` },
    bundle: true, write: false, format: 'esm', jsx: 'automatic',
    plugins: [{ name: 'fixture', setup(builder) {
      builder.onResolve({filter:/.*/}, args => mocks[args.path] ? {path:args.path,namespace:'fixture'} : undefined);
      builder.onLoad({filter:/.*/,namespace:'fixture'}, args => ({contents:mocks[args.path],loader:'jsx',resolveDir:root}));
      builder.onLoad({filter:/\.css$/},()=>({contents:'',loader:'js'}));
    }}],
  });
  const server = http.createServer((request,response) => {
    if(request.url === '/app.js') {response.setHeader('Content-Type','text/javascript');response.end(bundle.outputFiles[0].contents);return;}
    const params = new URL(request.url,'http://localhost').searchParams;
    const language = params.get('lang') || 'en';
    const theme = params.get('theme') || 'light';
    const catalog=JSON.parse(fs.readFileSync(path.join(root,'src/i18n/locales',language,'credit.json'),'utf8'));
    const styles=fs.readFileSync(path.join(root,'src/pages/food/OxsteedCreditCardsPage.css'),'utf8')+'\n'+fs.readFileSync(path.join(root,'src/components/credit/CardSecurity.css'),'utf8');
    response.setHeader('Content-Type','text/html; charset=utf-8');
    response.end(`<html data-theme="${theme}" dir="${language==='ar'?'rtl':'ltr'}"><head><style>${styles}</style></head><body><div id="root"></div>
      <script>window.language=${JSON.stringify(language)};window.catalog=${JSON.stringify(catalog).replace(/</g,'\\u003c')};window.writes=[];
      window.cards=[{id:'frozen',status:'frozen',freezeOrigin:'customer',cardType:'virtual'},{id:'admin',status:'frozen',freezeOrigin:'admin',cardType:'virtual'},
      {id:'lost',status:'lost',cardType:'virtual',replacementStatus:'pending'},{id:'replacement',status:'pending',cardType:'virtual',replacesCardId:'lost'}];</script>
      <script type="module" src="/app.js"></script></body></html>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try { browser=await chromium.launch({headless:true,channel:'chrome'}); }
  catch(error) {await new Promise(resolve=>server.close(resolve));throw error;}
  return {browser,base:`http://127.0.0.1:${server.address().port}`,close:async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));}};
}

test('customer card recovery and verification render in five locales, themes, RTL, mobile and reduced motion', async () => {
  const env=await fixture();
  try {
    const page=await env.browser.newPage(); const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',dialog=>dialog.accept());
    for(const language of ['en','es','fr','ht','ar']) for(const theme of ['light','dark']) {
      await page.setViewportSize(theme==='dark'?{width:390,height:844}:{width:1280,height:900});
      await page.emulateMedia({reducedMotion:'reduce'});
      await page.goto(`${env.base}/cards?lang=${language}&theme=${theme}`);
      const t=JSON.parse(fs.readFileSync(path.join(root,'src/i18n/locales',language,'credit.json'),'utf8')).cards;
      const tiles=page.locator('article');await tiles.first().waitFor();
      assert.equal(await tiles.nth(1).getByRole('button',{name:t.unfreeze,exact:true}).isDisabled(),true);
      assert.equal(await tiles.nth(2).getByRole('button',{name:t.unfreeze,exact:true}).count(),0);
      await tiles.nth(2).getByRole('button',{name:t.security.found,exact:true}).click();
      await tiles.nth(2).getByRole('button',{name:t.security.history,exact:true}).click();
      await tiles.nth(2).locator('li strong').getByText(t.security.events.lost,{exact:true}).waitFor();
      const trigger=tiles.first().getByRole('button',{name:t.unfreeze,exact:true});
      await trigger.click();
      const modal=page.getByRole('dialog');await modal.waitFor();
      for(let tab=0;tab<6;tab++) {
        await page.keyboard.press('Tab');
        // Native modal dialogs may yield focus to browser chrome (body), but
        // never to an interactive control on the inert page behind the modal.
        assert.equal(await modal.evaluate(element=>element.contains(document.activeElement) || document.activeElement===document.body),true);
      }
      const box=await modal.boundingBox();
      assert.ok(box.x>=0 && box.x+box.width<=page.viewportSize().width);
      assert.equal(await modal.getByRole('button',{name:t.security.send,exact:true}).count(),1);
      await modal.getByLabel(t.security.password,{exact:true}).fill('synthetic-password');
      await modal.getByRole('button',{name:t.security.send,exact:true}).click();
      await modal.getByLabel(t.security.emailCode,{exact:true}).fill('123456');
      await modal.getByRole('button',{name:t.security.verify,exact:true}).click();
      await modal.waitFor({state:'detached'});
      assert.equal(await trigger.evaluate(element=>element===document.activeElement),true);
      const writes=await page.evaluate(()=>window.writes);
      assert.equal(writes.at(-1).action,'unfreeze');assert.equal(writes.at(-1).payload.stepupCode,'123456');
      assert.ok(writes.at(-1).key);assert.equal(writes.at(-1).payload.password,undefined);
      await tiles.first().getByRole('button',{name:t.security.reportStolen,exact:true}).click();
      assert.equal((await page.evaluate(()=>window.writes)).at(-1).payload.status,'stolen');
      await tiles.nth(3).getByRole('button',{name:t.activate,exact:true}).click();
      await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');
      await page.getByRole('dialog').waitFor({state:'detached'});
      assert.equal(await page.locator('html').getAttribute('dir'),language==='ar'?'rtl':'ltr');
      assert.deepEqual(errors,[]);
    }
  } finally {await env.close();}
});
