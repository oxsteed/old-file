'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {chromium}=require('../server/node_modules/playwright');
const {createHub}=require('../server/services/storeHubLan');
test('LAN checkout preserves its request through a lost response and reload, with Arabic mobile layout',{timeout:60000},async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hub-browser-'));let hub,browser;
  const server=http.createServer((req,res)=>hub.app(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const cloud=async(method,endpoint,body)=>{
    if(endpoint==='bootstrap')return {restaurantId:1,locationId:2,currencyCode:'USD',expiresAt:new Date(Date.now()+3500000).toISOString(),
      taxPolicy:{defaultRateBps:0,taxInclusive:false,itemRules:[],deliveryFeeRules:[],serviceFeeRules:[]},items:[{id:4,name:'Meal',price_cents:1000}],shifts:[{id:5,staff_label:'Drawer'}]};
    if(endpoint==='authorize-peer'&&body.token==='synthetic-pos-credential')return {deviceId:11,restaurantId:1,locationId:2,role:'pos',shiftIds:[5],expiresAt:new Date(Date.now()+3500000).toISOString()};
    throw Object.assign(Error('denied'),{status:401});
  };
  try{
    hub=createHub({filename:path.join(directory,'hub.sqlite'),restaurantId:1,locationId:2,hubId:3,origin,cloud});await hub.sync();
    browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({locale:'en-US'});page.setDefaultTimeout(10000);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin);async function connect(){await page.getByLabel('Device',{exact:true}).fill('11');await page.getByLabel('Device credential').fill('synthetic-pos-credential');await page.getByRole('button',{name:'Connect',exact:true}).click();await page.getByRole('heading',{name:'Cash sale'}).waitFor();}
    await connect();await page.getByLabel('Cash received').fill('10.00');
    let lost=false,commits=0;
    await page.route('**/v1/orders',async route=>{if(route.request().method()!=='POST')return route.continue();
      const result=await route.fetch();if(result.status()===201)commits++;
      if(!lost){lost=true;return route.abort('failed');}return route.fulfill({response:result});});
    await page.getByRole('button',{name:'Record cash sale'}).click();await page.getByRole('status').filter({hasText:'Unavailable'}).waitFor();
    await page.reload();await connect();assert.equal(await page.getByLabel('Cash received').isDisabled(),true);
    await page.getByRole('button',{name:'Record cash sale'}).click();await page.getByRole('status').filter({hasText:'LAN-1'}).waitFor();
    assert.equal(commits,1);assert.equal(await page.evaluate(()=>sessionStorage.getItem('oxsteed-lan-pending')),null);assert.deepEqual(errors,[]);
    const arabic=await browser.newPage({locale:'ar',viewport:{width:390,height:844}});await arabic.goto(origin);assert.equal(await arabic.locator('html').getAttribute('dir'),'rtl');
    assert.equal(await arabic.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await arabic.screenshot({path:'/tmp/oxsteed-lan-ar-mobile.png',fullPage:true});
  }finally{await browser?.close();await new Promise(r=>server.close(r));hub?.close();fs.rmSync(directory,{recursive:true,force:true});}
});
