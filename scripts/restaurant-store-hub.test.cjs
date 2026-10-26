'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const request=require('../server/node_modules/supertest');
const {createHub}=require('../server/services/storeHubLan');

test('durable POS -> kitchen -> printer -> pickup during outage; lost upload response and restart',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'oxsteed-lan-test-'));
  let clock=Date.now(),offline=false,lost=false;
  const uploads=new Map();
  const snapshot={restaurantId:1,locationId:2,currencyCode:'USD',expiresAt:new Date(clock+3600000).toISOString(),
    taxPolicy:{defaultRateBps:800,taxInclusive:false,itemRules:[],deliveryFeeRules:[],serviceFeeRules:[]},
    items:[{id:4,name:'Meal',price_cents:1000}],shifts:[{id:5}]};
  const roles={11:'pos',12:'kitchen',13:'printer',14:'display'};
  const tokens=Object.fromEntries(Object.keys(roles).map(id=>[id,`synthetic-peer-${id}-credential`]));
  const cloud=async(method,endpoint,body)=>{
    if(offline)throw Error('network_down');
    if(endpoint==='bootstrap')return structuredClone(snapshot);
    if(endpoint==='authorize-peer'){
      if(!roles[body.deviceId]||tokens[body.deviceId]!==body.token)throw Object.assign(Error('denied'),{status:401});
      return {deviceId:body.deviceId,restaurantId:1,locationId:2,role:roles[body.deviceId],shiftIds:[5],expiresAt:new Date(clock+3600000).toISOString()};
    }
    if(endpoint==='offline-sales'){
      const sale=body.sales[0];uploads.set(sale.idempotencyKey,sale);
      if(lost){lost=false;throw Error('response_lost');}
      return {queued:[{idempotencyKey:sale.idempotencyKey,status:'queued'}]};
    }
    throw Error('unexpected_cloud_route');
  };
  const config={filename:path.join(dir,'hub.sqlite'),restaurantId:1,locationId:2,hubId:3,
    origin:'https://hub.example.test',cloud,now:()=>clock};
  let hub=createHub(config);
  const send=(id,method,url,body)=>request(hub.app)[method](url).set('Host','hub.example.test')
    .set('X-Device-Id',String(id)).set('Authorization',`Bearer ${tokens[id]}`).send(body);
  try{
    await hub.sync();
    for(const id of Object.keys(roles))assert.equal((await send(Number(id),'get','/v1/snapshot')).status,200);
    offline=true;
    const sale={idempotencyKey:'sale-test-0001',shiftId:5,items:[{menuItemId:4,quantity:2}],cashTenderedCents:2200};
    const created=await send(11,'post','/v1/orders',sale);
    assert.equal(created.status,201);assert.equal(created.body.totalCents,2160);
    const retry=await send(11,'post','/v1/orders',sale);
    assert.equal(retry.status,200);assert.equal(retry.body.hubSaleUuid,created.body.hubSaleUuid);
    assert.equal((await send(11,'post','/v1/orders',{...sale,cashTenderedCents:2300})).status,409);
    assert.equal((await send(12,'post','/v1/orders',{...sale,idempotencyKey:'unauthorized'})).status,403);
    assert.equal((await send(11,'post','/v1/orders',{...sale,idempotencyKey:'wrong-store',shiftId:999})).status,403);
    const claimed=(await send(13,'post','/v1/prints/claim',{})).body.job;
    assert.equal(claimed.payload.items[0].quantity,2);
    hub.close();hub=createHub(config);
    assert.equal((await send(12,'get','/v1/orders')).body.orders.length,1);
    assert.equal((await send(13,'post','/v1/prints/claim',{})).body.job,null);
    assert.equal((await send(13,'post',`/v1/prints/${claimed.id}/ack`,{claim:claimed.claim})).status,200);
    for(const [action,revision,id]of[['start',1,12],['ready',2,12],['pickup',3,11]]){
      const body={id:sale.idempotencyKey,action,expectedRevision:revision,operationId:`action-test-${revision}`};
      assert.equal((await send(id,'post','/v1/actions',body)).status,200);
      assert.equal((await send(id,'post','/v1/actions',body)).status,200);
    }
    assert.equal((await send(14,'get','/v1/orders')).body.orders.length,0);
    offline=false;lost=true;
    await assert.rejects(hub.sync(),/response_lost/);
    assert.equal((await hub.sync()).uploaded,1);assert.equal(uploads.size,1);
    assert.equal((await hub.sync()).uploaded,0);
    offline=true;clock+=3600001;
    assert.equal((await send(11,'get','/v1/orders')).status,401);
    assert.equal((await request(hub.app).get('/health').set('Host','evil.example')).status,403);
  }finally{hub.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('printer restart retries only the acknowledgement after a lost response',async()=>{
  const {createPrinter}=require('../server/services/storeHubPrinter');
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hub-printer-'));
  let writes=0,claims=0,acks=0;
  const request=async route=>{if(route==='prints/claim'){claims++;return {job:{id:1,claim:'synthetic',payload:{items:[{name:'Lunch',quantity:1}]}}};}
    acks++;if(acks===1)throw Error('ack response lost');return {printed:true};};
  const options={stateFile:path.join(directory,'state.json'),host:'127.0.0.1',request,print:async()=>{writes++;return {ok:true};}};
  try{
    await assert.rejects(createPrinter(options).tick());
    await createPrinter(options).tick();
    assert.equal(writes,1);assert.equal(claims,1);assert.equal(acks,2);
    fs.writeFileSync(options.stateFile,JSON.stringify({id:2,claim:'uncertain',state:'sending'}));
    await assert.rejects(createPrinter(options).tick(),/uncertain/);assert.equal(writes,1);
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('LAN print bridge writes a kitchen ticket to its configured TCP target',async()=>{
  const net=require('node:net');const {createPrinter}=require('../server/services/storeHubPrinter');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hub-print-tcp-'));let bytes=Buffer.alloc(0),ack=false;
  let received;const delivered=new Promise(resolve=>{received=resolve;});
  const server=net.createServer(socket=>{socket.on('data',data=>{bytes=Buffer.concat([bytes,data]);});socket.on('end',received);});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{
    const printer=createPrinter({stateFile:path.join(directory,'state'),host:'127.0.0.1',port:server.address().port,
      request:async route=>{if(route==='prints/claim')return {job:{id:1,claim:'synthetic',payload:{order:{queueNumber:'LAN-1'},items:[{name:'Synthetic meal',quantity:2}]}}};ack=true;return {printed:true};}});
    await printer.tick();assert.equal(ack,true);await delivered;
    assert.equal(ack,true);assert.ok(bytes.includes(Buffer.from('Synthetic meal')));assert.ok(bytes.includes(Buffer.from('LAN-1')));
  }finally{await new Promise(r=>server.close(r));fs.rmSync(directory,{recursive:true,force:true});}
});

test('pending balance survives restart and a lost batch acknowledgement; one upload covers several sales',async()=>{
  const {DatabaseSync}=require('node:sqlite');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hub-batch-'));
  const filename=path.join(dir,'hub.sqlite');
  let lose=true,uploadCalls=0;
  const config={filename,restaurantId:1,locationId:2,hubId:3,origin:'https://hub.example.test',cloud:async(method,route,body)=>{
    if(route==='bootstrap')return {restaurantId:1,locationId:2,expiresAt:new Date(Date.now()+300000).toISOString()};
    uploadCalls++;assert.equal(body.sales.length,2);
    if(lose){lose=false;throw Error('lost_ack');}
    return {queued:body.sales.map(s=>({idempotencyKey:s.idempotencyKey}))};
  }};
  let hub=createHub(config);hub.close();
  const db=new DatabaseSync(filename);
  for(const id of ['one','two'])db.prepare("INSERT INTO sales(id,request_hash,payload,state) VALUES(?,'hash',?,'completed')").run(id,JSON.stringify({idempotencyKey:id,totalCents:100}));
  try{
    assert.equal(db.prepare('SELECT cents FROM pending_balance').get().cents,200);
    hub=createHub(config);
    await assert.rejects(hub.sync(),/lost_ack/);
    assert.equal(db.prepare('SELECT cents FROM pending_balance').get().cents,200);
    hub.close();hub=createHub(config);
    assert.equal((await hub.sync()).uploaded,2);
    assert.equal(db.prepare('SELECT cents FROM pending_balance').get().cents,0);
    assert.equal((await hub.sync()).uploaded,0);assert.equal(uploadCalls,2);
  }finally{hub.close();db.close();fs.rmSync(dir,{recursive:true,force:true});}
});
