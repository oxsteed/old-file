const test = require('node:test');
const assert = require('node:assert/strict');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const root = path.resolve(__dirname, '..');
const screenshots = fs.mkdtempSync(path.join(os.tmpdir(), 'oxsteed-reservation-design-'));

test('reservation card layouts and request lifecycle preserve all fields and pending confirmation', { timeout: 60_000 }, async () => {
  const bundle = await build({stdin:{resolveDir:root,loader:'jsx',contents:`
    import React from 'react';import {createRoot} from 'react-dom/client';
    import Reservation from './src/pages/food/PublicReservationRequest';
    createRoot(document.getElementById('root')).render(<Reservation t={window.t} restaurantId="restaurant-2" locationId="store-1"
      locations={[{id:'store-1',name:'Downtown'},{id:'store-2',name:'Riverside'},{id:'store-3',name:'Archived',status:'archived'}]}/>);`},
    bundle:true,write:false,outfile:'app.js',jsx:'automatic',plugins:[{name:'reservation-services',setup(p){
      const mocks={
        '../../api/food':`export const requestRestaurantReservation=async(id,body,key)=>{window.calls.push({id,body,key});await new Promise(r=>setTimeout(r,80));if(window.failRequest)throw new Error('synthetic unavailable');return {reservation:{id:'request-1',status:'pending'}};};`,
        './foodShared':`export const apiErrorMessage=(_,fallback)=>fallback;`,
      };
      p.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'fixture'}:undefined);
      p.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'jsx',resolveDir:root}));
    }}]});
  const browser = await chromium.launch({headless:true,channel:'chrome'});
  try {
    for (const [language,width,dark] of [['en',320,true],['en',420,false],['ar',360,true]]) {
      const page=await browser.newPage({viewport:{width,height:1000},timezoneId:'America/New_York'});page.setDefaultTimeout(7000);
      const catalog=JSON.parse(fs.readFileSync(path.join(root,`src/locales/${language}.json`)));
      const tr=catalog.reservationRequest, old=catalog.food.restaurant.reservation;
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      const tokens=dark?'--color-bg:#0a0f1a;--color-surface:#111827;--color-surface-2:#1a2235;--color-text:#f1f5f9;--color-text-muted:#dbe4ef;--color-border:#374151;--color-border-strong:#374151;color-scheme:dark':'--color-bg:#fafafa;--color-surface:#fff;--color-surface-2:#f1f5f9;--color-text:#0f172a;--color-text-muted:#475569;--color-border:#e2e8f0;--color-border-strong:#cbd5e1;color-scheme:light';
      await page.route('http://reservation.test/**',route=>{
        const asset=new URL(route.request().url()).pathname;
        if(asset==='/app.js')return route.fulfill({contentType:'text/javascript',body:bundle.outputFiles.find(f=>f.path.endsWith('.js')).text});
        return route.fulfill({contentType:'text/html',body:`<html lang="${language}" dir="${language==='ar'?'rtl':'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{${tokens};--color-primary:#f97316;--color-action:#c2410c;--color-action-hover:#9a3412;--color-on-action:#fff;--color-error:#f87171;--color-error-bg:#7f1d1d22}body{margin:0;padding:16px;background:var(--color-bg);font-family:Arial,sans-serif}*{box-sizing:border-box}${bundle.outputFiles.find(f=>f.path.endsWith('.css')).text}</style></head><body><div id="root"></div><script>window.calls=[];const catalog=${JSON.stringify(catalog).replace(/</g,'\\u003c')};window.t=key=>key.split('.').reduce((v,k)=>v?.[k],catalog)||key;</script><script src="/app.js"></script></body></html>`});
      });
      await page.goto('http://reservation.test');
      try { await page.getByLabel(tr.arrival,{exact:true}).waitFor(); }
      catch (failure) { console.error({language,errors,body:(await page.locator('body').innerText()).slice(0,2000)}); throw failure; }
      assert.equal(await page.getByLabel(old.name,{exact:true}).count(),0,'first step keeps contact fields out of the sidebar');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      assert.equal(await page.getByLabel(old.store,{exact:true}).locator('option[value=store-3]').isDisabled(),true);
      await page.locator('.reservation-request').screenshot({path:path.join(screenshots,`${language}-${width}-${dark?'dark':'light'}-visit.png`)});
      await page.getByLabel(old.partySize,{exact:true}).fill('4');await page.getByLabel(old.store,{exact:true}).selectOption('store-2');
      await page.getByLabel(tr.arrival,{exact:true}).fill('2030-05-20T18:30');await page.getByLabel(tr.departure,{exact:true}).fill('2030-05-20T17:30');
      await page.getByRole('button',{name:tr.continue,exact:true}).click();await page.getByRole('alert').getByText(tr.invalidWindow,{exact:true}).waitFor();
      await page.getByLabel(tr.departure,{exact:true}).fill('2030-05-20T19:30');await page.getByRole('button',{name:tr.continue,exact:true}).focus();await page.keyboard.press('Enter');
      await page.getByLabel(old.name,{exact:true}).fill('Synthetic Guest');
      await page.getByRole('button',{name:old.submit,exact:true}).click();await page.getByRole('alert').getByText(tr.contactRequired,{exact:true}).waitFor();
      assert.equal(await page.evaluate(()=>window.calls.length),0);
      await page.getByLabel(old.email,{exact:true}).fill('synthetic@example.test');
      await page.getByText(tr.addNote,{exact:true}).focus();await page.keyboard.press('Enter');await page.getByLabel(old.notes,{exact:true}).fill('Step-free access, please.');
      await page.getByRole('button',{name:tr.editVisit,exact:true}).click();assert.equal(await page.getByLabel(old.partySize,{exact:true}).inputValue(),'4');
      await page.getByRole('button',{name:tr.continue,exact:true}).click();assert.equal(await page.getByLabel(old.email,{exact:true}).inputValue(),'synthetic@example.test');
      await page.locator('.reservation-request').screenshot({path:path.join(screenshots,`${language}-${width}-${dark?'dark':'light'}-contact.png`)});
      await page.evaluate(()=>window.failRequest=true);await page.getByRole('button',{name:old.submit,exact:true}).click();await page.getByRole('alert').getByText(old.error,{exact:true}).waitFor();
      assert.equal(await page.getByLabel(old.email,{exact:true}).inputValue(),'synthetic@example.test');
      await page.evaluate(()=>window.failRequest=false);await page.getByRole('button',{name:old.submit,exact:true}).click();
      await page.getByRole('heading',{name:old.received,exact:true}).waitFor();await page.getByRole('status').getByText(old.pendingHint,{exact:true}).waitFor();
      const sent=await page.evaluate(()=>window.calls.at(-1));assert.equal(sent.id,'restaurant-2');assert.equal(sent.body.locationId,'store-2');assert.equal(sent.body.partySize,4);assert.equal(sent.body.guestName,'Synthetic Guest');assert.equal(sent.body.guestEmail,'synthetic@example.test');assert.equal(sent.body.notes,'Step-free access, please.');assert.equal(sent.body.startsAt,'2030-05-20T22:30:00.000Z');assert.equal(sent.body.endsAt,'2030-05-20T23:30:00.000Z');assert.ok(sent.key);
      assert.equal(await page.getByRole('heading',{name:old.received,exact:true}).evaluate(el=>el===document.activeElement),true);
      await page.getByRole('button',{name:old.requestAnother,exact:true}).click();await page.getByLabel(tr.arrival,{exact:true}).waitFor();
      assert.equal(await page.getByLabel(old.partySize,{exact:true}).inputValue(),'2');assert.deepEqual(errors,[]);await page.close();
    }
    console.log('Reservation design screenshots: '+screenshots);
  } finally {await browser.close();}
});
