'use strict';
// F-26: one status writer for restaurant devices.
jest.unmock('pg');jest.unmock('../utils/transaction');
jest.mock('../db',()=>({query:jest.fn(),connect:jest.fn()}));
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {Pool}=require('pg');
const db=require('../db');

describe('static guard',()=>{
  const ROOT=path.join(__dirname,'..');
  const files=[];
  const walk=d=>{for(const n of fs.readdirSync(d)){const f=path.join(d,n);if(fs.statSync(f).isDirectory()){if(!['node_modules','__tests__','migrations'].includes(n))walk(f);}else if(n.endsWith('.js'))files.push(f);}};
  ['controllers','routes','services','jobs','workers'].forEach(d=>fs.existsSync(path.join(ROOT,d))&&walk(path.join(ROOT,d)));
  const rel=f=>path.relative(ROOT,f).split(path.sep).join('/');
  test('only the unified service changes registry status',()=>{
    const writers=files.filter(f=>/UPDATE\s+restaurant_devices\b[\s\S]{0,80}\bstatus\s*=/.test(fs.readFileSync(f,'utf8'))).map(rel);
    expect(writers).toEqual(['services/unifiedDeviceService.js']);
  });
  test('legacy config writers route status through the unified service',()=>{
    const src=fs.readFileSync(path.join(ROOT,'controllers/restaurantAppFlowController.js'),'utf8');
    expect((src.match(/setAppDeviceStatus\(/g)||[]).length).toBe(2);
    const literal=[...src.matchAll(/UPDATE restaurant_app_devices\s+SET status = '(\w+)'/g)].map(m=>m[1]);
    expect(literal).toEqual(['paired']); // the pairing flow itself
    const display=fs.readFileSync(path.join(ROOT,'controllers/restaurantDisplayController.js'),'utf8');
    expect(display).toMatch(/retireDisplayPairing[\s\S]{0,200}DELETE FROM display_pairings/);
  });
});

const url=process.env.RESTAURANT_STORE_TEST_DATABASE_URL;
if(url){const u=new URL(url);if(!['localhost','127.0.0.1','[::1]'].includes(u.hostname)||u.pathname!=='/restaurant_store_test')throw Error('Requires disposable loopback restaurant_store_test');}
(url?describe:describe.skip)('device status convergence, real PostgreSQL',()=>{
  let pool,owner,restaurantId,locationId,http;
  beforeAll(async()=>{
    pool=new Pool({connectionString:url,max:4});db.query.mockImplementation((...a)=>pool.query(...a));db.connect.mockImplementation(()=>pool.connect());
    owner=crypto.randomUUID();
    await pool.query("INSERT INTO users(id,email,password_hash,first_name,last_name) VALUES($1,$2,'synthetic','Device','Owner')",[owner,`${owner}@example.test`]);
    const {rows:[b]}=await pool.query("INSERT INTO businesses(user_id,business_name) VALUES($1,'Device fixture') RETURNING id",[owner]);
    restaurantId=(await pool.query("INSERT INTO food_restaurants(business_id,owner_user_id,display_name,status) VALUES($1,$2,'Device fixture','active') RETURNING id",[b.id,owner])).rows[0].id;
    locationId=(await pool.query('SELECT id FROM restaurant_locations WHERE restaurant_id=$1 AND is_primary=TRUE',[restaurantId])).rows[0].id;
    const express=require('express');
    http=express();http.use(express.json());http.use((req,_res,next)=>{req.user={id:owner};next();});
    http.patch('/r/:restaurantId/devices/:deviceId',require('../controllers/restaurantAppFlowController').updateDeviceConfig);
    http.use(require('../middleware/errorHandler').errorHandler);
  });
  afterAll(async()=>{if(pool)await pool.end();});
  const device=async(status,paired)=>(await pool.query(`INSERT INTO restaurant_app_devices(restaurant_id,location_id,app_key,device_name,status,device_token_hash,paired_at)
    VALUES($1,$2,'pos','POS',$3,$4,$5) RETURNING id`,[restaurantId,locationId,status,paired?crypto.randomUUID():null,paired?new Date():null])).rows[0].id;
  const registry=async id=>(await pool.query('SELECT status FROM restaurant_devices WHERE source_app_device_id=$1',[id])).rows[0];
  const request=()=>require('supertest')(http);

  test('disabling from the config screen writes through the registry',async()=>{
    const id=await device('paired',true);
    const res=await request().patch(`/r/${restaurantId}/devices/${id}`).send({status:'disabled',deviceName:'POS 1'});
    expect(res.status).toBe(200);expect(res.body.device.status).toBe('disabled');
    expect((await registry(id)).status).toBe('disabled');
    const back=await request().patch(`/r/${restaurantId}/devices/${id}`).send({status:'paired'});
    expect(back.status).toBe(200);expect((await registry(id)).status).toBe('active');
  });
  test('a never-paired device cannot be switched on and pending is pairing-only',async()=>{
    const id=await device('pending',false);
    const on=await request().patch(`/r/${restaurantId}/devices/${id}`).send({status:'paired'});
    expect(on.status).toBe(409);expect(on.body.code||on.body.error?.code).toBe('device_pairing_required');
    const paired=await device('paired',true);
    const pend=await request().patch(`/r/${restaurantId}/devices/${paired}`).send({status:'pending'});
    expect(pend.status).toBe(409);
  });
  test('unpairing a display retires its registry row',async()=>{
    const svc=require('../services/unifiedDeviceService');
    const hex=()=>crypto.randomBytes(32).toString('hex');
    const {rows:[dp]}=await pool.query(`INSERT INTO display_pairings(restaurant_id,location_id,code_hash,expires_at,paired_at,pairing_token_hash,device_role)
      VALUES($1,$2,$3,NOW()+INTERVAL '10 minutes',NOW(),$4,'kiosk') RETURNING id`,[restaurantId,locationId,hex(),hex()]);
    const before=await pool.query('SELECT status FROM restaurant_devices WHERE source_display_pairing_id=$1',[dp.id]);
    expect(before.rows[0]?.status).toBe('active');
    const regId=(await pool.query('SELECT id FROM restaurant_devices WHERE source_display_pairing_id=$1',[dp.id])).rows[0].id;
    const client=await pool.connect();
    try{await client.query('BEGIN');await svc.retireDisplayPairing(client,{restaurantId,pairingId:dp.id});await client.query('DELETE FROM display_pairings WHERE id=$1',[dp.id]);await client.query('COMMIT');}
    finally{client.release();}
    expect((await pool.query('SELECT status FROM restaurant_devices WHERE id=$1',[regId])).rows[0].status).toBe('disabled');
  });
});
