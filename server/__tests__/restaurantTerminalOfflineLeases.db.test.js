'use strict';
// F-08: offline card leases (Stripe Terminal store-and-forward), real PostgreSQL.
jest.unmock('pg');jest.unmock('../utils/transaction');
jest.mock('../db',()=>({query:jest.fn(),connect:jest.fn()}));
const crypto=require('crypto');
const {Pool}=require('pg');
const db=require('../db');
const credentials=require('../services/restaurantDeviceCredentials');
const terminal=require('../services/restaurantPosTerminalService');
const leases=require('../services/restaurantTerminalOfflineLeases');

describe('offline review reasons (pure)',()=>{
  const lease={max_transaction_cents:2000,budget_cents:5000,consumed_cents:4000,created_at:'2026-10-26T10:00:00Z',expires_at:'2026-10-26T22:00:00Z',closed_at:null};
  test('flags per-sale cap, budget and window',()=>{
    expect(leases.reviewReasons(lease,{amountCents:1000,collectedAt:new Date('2026-10-26T12:00:00Z')})).toEqual([]);
    expect(leases.reviewReasons(lease,{amountCents:2500,collectedAt:new Date('2026-10-26T12:00:00Z')})).toEqual(['over_transaction_limit','over_lease_budget']);
    expect(leases.reviewReasons(lease,{amountCents:500,collectedAt:new Date('2026-10-27T02:00:00Z')})).toEqual(['outside_lease_window']);
  });
  test('lease hours are bounded',()=>{
    process.env.RESTAURANT_TERMINAL_OFFLINE_LEASE_HOURS='99';expect(leases.leaseHours()).toBe(24);
    delete process.env.RESTAURANT_TERMINAL_OFFLINE_LEASE_HOURS;expect(leases.leaseHours()).toBe(12);
  });
});

const url=process.env.RESTAURANT_STORE_TEST_DATABASE_URL;
if(url){const u=new URL(url);if(!['localhost','127.0.0.1','[::1]'].includes(u.hostname)||u.pathname!=='/restaurant_store_test')throw Error('Requires disposable loopback restaurant_store_test');}
(url?describe:describe.skip)('offline card leases, real PostgreSQL',()=>{
  let pool,owner,restaurantId,locationId,deviceId,shiftId,queue=1500;
  const spies=[];
  beforeAll(async()=>{
    pool=new Pool({connectionString:url,max:6});db.query.mockImplementation((...a)=>pool.query(...a));db.connect.mockImplementation(()=>pool.connect());
    owner=crypto.randomUUID();
    await pool.query("INSERT INTO users(id,email,password_hash,first_name,last_name) VALUES($1,$2,'synthetic','Offline','Test')",[owner,`${owner}@example.test`]);
    const {rows:[business]}=await pool.query("INSERT INTO businesses(user_id,business_name) VALUES($1,'Offline fixture') RETURNING id",[owner]);
    const {rows:[restaurant]}=await pool.query("INSERT INTO food_restaurants(business_id,owner_user_id,display_name,status) VALUES($1,$2,'Offline fixture','active') RETURNING id",[business.id,owner]);restaurantId=restaurant.id;
    locationId=(await pool.query('SELECT id FROM restaurant_locations WHERE restaurant_id=$1 AND is_primary=TRUE',[restaurantId])).rows[0].id;
    const {rows:[device]}=await pool.query(`INSERT INTO restaurant_app_devices(restaurant_id,location_id,app_key,device_name,status,device_token_hash)
      VALUES($1,$2,'pos','POS','paired',$3) RETURNING id`,[restaurantId,locationId,credentials.tokenHash(crypto.randomUUID())]);
    deviceId=(await pool.query('SELECT id FROM restaurant_devices WHERE source_app_device_id=$1',[device.id])).rows[0].id;
    shiftId=(await pool.query("INSERT INTO restaurant_pos_shifts(restaurant_id,location_id,staff_user_id) VALUES($1,$2,$3) RETURNING id",[restaurantId,locationId,owner])).rows[0].id;
    await pool.query(`INSERT INTO restaurant_store_forward_settings(restaurant_id,location_id,enabled,max_transaction_cents,max_daily_cents,allowed_card_brands)
      VALUES($1,$2,TRUE,2000,5000,ARRAY['visa'])`,[restaurantId,locationId]);
    spies.push(jest.spyOn(terminal,'resolveRestaurantConnectAccount').mockResolvedValue('acct_synthetic'));
    process.env.RESTAURANT_TERMINAL_OFFLINE_ENABLED='true';
  });
  afterAll(async()=>{spies.forEach(s=>s.mockRestore());delete process.env.RESTAURANT_TERMINAL_OFFLINE_ENABLED;if(pool)await pool.end();});
  afterEach(()=>{jest.restoreAllMocks();spies.splice(0);spies.push(jest.spyOn(terminal,'resolveRestaurantConnectAccount').mockResolvedValue('acct_synthetic'));});
  const order=async(total=1000)=>(await pool.query(`INSERT INTO food_orders(restaurant_id,business_id,location_id,subtotal_cents,total_cents,currency_code,queue_number)
    SELECT id,business_id,$2,$3,$3,'USD',$4 FROM food_restaurants WHERE id=$1 RETURNING id`,[restaurantId,locationId,total,queue++])).rows[0].id;
  const intentFor=(offlineId,orderId,amount,status='succeeded')=>({id:'pi_'+crypto.randomUUID().replace(/-/g,''),status,amount,amount_received:status==='succeeded'?amount:0,currency:'usd',
    metadata:{offlineId,food_order_id:String(orderId)},latest_charge:{payment_method_details:{card_present:{brand:'visa'}}}});

  test('is off unless enabled',async()=>{
    delete process.env.RESTAURANT_TERMINAL_OFFLINE_ENABLED;
    await expect(leases.issueLease({restaurantId,locationId,deviceId,shiftId,userId:owner})).rejects.toMatchObject({code:'terminal_offline_disabled'});
    process.env.RESTAURANT_TERMINAL_OFFLINE_ENABLED='true';
  });

  test('lease is idempotent per device, bounded by the store/day pool, and settles a forwarded payment once',async()=>{
    const lease=await leases.issueLease({restaurantId,locationId,deviceId,shiftId,userId:owner,budgetCents:3500});
    expect(Number(lease.budget_cents)).toBe(3500);expect(Number(lease.max_transaction_cents)).toBe(2000);
    expect((await leases.issueLease({restaurantId,locationId,deviceId,shiftId,userId:owner})).id).toBe(lease.id);
    const orderId=await order(1000);const offlineId=crypto.randomUUID();
    const intent=intentFor(offlineId,orderId,1000);
    jest.spyOn(terminal,'retrieveConnectedIntent').mockResolvedValue(intent);
    const input={restaurantId,deviceId,leaseId:lease.id,offlineId,intentId:intent.id,amountCents:1000,collectedAt:new Date().toISOString(),foodOrderId:orderId};
    const first=await leases.registerPayment(input);
    expect(first.attached).toBe(true);expect(first.settled).toBe(true);
    await leases.registerPayment(input);
    expect((await pool.query("SELECT COUNT(*)::int n FROM restaurant_pos_payments WHERE food_order_id=$1",[orderId])).rows[0].n).toBe(1);
    expect((await pool.query('SELECT payment_status FROM food_orders WHERE id=$1',[orderId])).rows[0].payment_status).toBe('paid');
    await expect(leases.registerPayment({...input,amountCents:999})).rejects.toMatchObject({code:'terminal_offline_payment_conflict'});
    expect(Number((await pool.query('SELECT consumed_cents FROM restaurant_terminal_offline_leases WHERE id=$1',[lease.id])).rows[0].consumed_cents)).toBe(1000);
    // The rest of the store/day pool is all an online permit can use now.
    const big=await order(1600);
    await expect(require('../services/restaurantTerminalOffline').issuePermit({restaurantId,locationId,deviceId,orderId:big,shiftId,userId:owner}))
      .rejects.toMatchObject({code:'terminal_offline_limit_exceeded'});
    await leases.closeLease({restaurantId,leaseId:lease.id,deviceId});
  });

  test('over-limit and mismatched payments are recorded for review, never dropped',async()=>{
    const lease=await leases.issueLease({restaurantId,locationId,deviceId,shiftId,userId:owner});
    const orderId=await order(2500);const offlineId=crypto.randomUUID();
    const intent=intentFor(offlineId,orderId,2500);
    jest.spyOn(terminal,'retrieveConnectedIntent').mockResolvedValue(intent);
    const r=await leases.registerPayment({restaurantId,deviceId,leaseId:lease.id,offlineId,intentId:intent.id,amountCents:2500,collectedAt:new Date().toISOString(),foodOrderId:orderId});
    expect(r.attached).toBe(true);
    const row=(await pool.query('SELECT * FROM restaurant_terminal_offline_payments WHERE offline_id=$1',[offlineId])).rows[0];
    expect(row.status).toBe('requires_reconciliation');expect(row.review_reasons).toContain('over_transaction_limit');
    const wrong=await order(700);const wrongId=crypto.randomUUID();
    const w=await leases.registerPayment({restaurantId,deviceId,leaseId:lease.id,offlineId:wrongId,amountCents:650,collectedAt:new Date().toISOString(),foodOrderId:wrong});
    expect(w.flagged).toBe(true);
    expect((await pool.query('SELECT review_reasons FROM restaurant_terminal_offline_payments WHERE offline_id=$1',[wrongId])).rows[0].review_reasons).toContain('amount_differs_from_order');
    const open=await leases.listOpen({restaurantId});
    expect(open.payments.map(p=>p.offline_id)).toEqual(expect.arrayContaining([offlineId,wrongId]));
    // Void needs Stripe to have nothing for the id; accept needs exactly one.
    jest.spyOn(terminal,'searchConnectedIntentByOfflineId').mockResolvedValue([intent]);
    await expect(leases.resolve({restaurantId,offlineId,action:'void',note:'test void',userId:owner})).rejects.toMatchObject({code:'terminal_offline_void_has_intent'});
    const accepted=await leases.resolve({restaurantId,offlineId,action:'accept',note:'manager ok over cap',userId:owner});
    expect(accepted.resolved).toBe(true);
    expect((await pool.query('SELECT status,resolved_by FROM restaurant_terminal_offline_payments WHERE offline_id=$1',[offlineId])).rows[0]).toMatchObject({status:'attached',resolved_by:owner});
    terminal.searchConnectedIntentByOfflineId.mockResolvedValue([]);
    await leases.resolve({restaurantId,offlineId:wrongId,action:'void',note:'never charged',userId:owner});
    expect((await pool.query('SELECT status FROM restaurant_terminal_offline_payments WHERE offline_id=$1',[wrongId])).rows[0].status).toBe('voided');
    await leases.closeLease({restaurantId,leaseId:lease.id,deviceId});
  });

  test('a ticket-only payment waits for the ticket, then the sweep attaches it and chases unreported permits',async()=>{
    const lease=await leases.issueLease({restaurantId,locationId,deviceId,shiftId,userId:owner,budgetCents:1000});
    const ticketId=crypto.randomUUID();const offlineId=crypto.randomUUID();
    const r=await leases.registerPayment({restaurantId,deviceId,leaseId:lease.id,offlineId,amountCents:800,collectedAt:new Date().toISOString(),screenTicketId:ticketId});
    expect(r.waiting).toBe(true);expect(r.attached).toBe(false);
    const orderId=await order(800);
    await pool.query(`INSERT INTO restaurant_screen_tickets(id,restaurant_id,location_id,payload,request_hash,status,order_id) VALUES($1,$2,$3,'{}'::jsonb,'h','accepted',$4)`,[ticketId,restaurantId,locationId,orderId]);
    const intent=intentFor(offlineId,orderId,800);
    const search=jest.spyOn(terminal,'searchConnectedIntentByOfflineId').mockResolvedValue([intent]);
    jest.spyOn(terminal,'retrieveConnectedIntent').mockResolvedValue(intent);
    // Expired permit: the device never reported back its intent.
    await pool.query("UPDATE restaurant_terminal_offline_leases SET expires_at=NOW()-INTERVAL '1 minute' WHERE id=$1",[lease.id]);
    const swept=await leases.sweep({now:new Date(Date.now()+60*60*1000)});
    expect(swept.expired).toBeGreaterThanOrEqual(1);expect(swept.attached).toBe(1);
    expect(search).toHaveBeenCalledWith(offlineId,'acct_synthetic');
    expect((await pool.query('SELECT payment_status FROM food_orders WHERE id=$1',[orderId])).rows[0].payment_status).toBe('paid');
    expect((await pool.query('SELECT status FROM restaurant_terminal_offline_leases WHERE id=$1',[lease.id])).rows[0].status).toBe('expired');
  });

  test('an old unworked review queue blocks new leases',async()=>{
    const {rows:[l]}=await pool.query('SELECT id FROM restaurant_terminal_offline_leases WHERE restaurant_id=$1 LIMIT 1',[restaurantId]);
    await pool.query(`INSERT INTO restaurant_terminal_offline_payments(offline_id,lease_id,restaurant_id,location_id,amount_cents,collected_at,status,created_at)
      VALUES($1,$2,$3,$4,100,NOW(),'requires_reconciliation',NOW()-INTERVAL '2 days')`,[crypto.randomUUID(),l.id,restaurantId,locationId]);
    await expect(leases.issueLease({restaurantId,locationId,deviceId,shiftId,userId:owner})).rejects.toMatchObject({code:'terminal_offline_reconciliation_backlog'});
  });
  test('manager queue and resolve endpoints are scoped and validated',async()=>{
    const express=require('express'),request=require('supertest');
    const c=require('../controllers/restaurantTerminalOfflineController');
    const http=express();http.use(express.json());http.use((req,_res,next)=>{req.user={id:owner};next();});
    http.get('/r/:restaurantId/open',c.openQueue);http.post('/r/:restaurantId/resolve/:offlineId',c.resolve);
    http.use(require('../middleware/errorHandler').errorHandler);
    const open=await request(http).get(`/r/${restaurantId}/open`);
    expect(open.status).toBe(200);expect(open.headers['cache-control']).toBe('no-store');expect(Array.isArray(open.body.payments)).toBe(true);
    expect((await request(http).post(`/r/${restaurantId}/resolve/not-a-uuid`).send({action:'void',note:'x'})).status).toBe(400);
    expect((await request(http).post(`/r/${restaurantId}/resolve/${crypto.randomUUID()}`).send({action:'void',note:'missing'})).status).toBe(404);
    const stranger=crypto.randomUUID();
    await pool.query("INSERT INTO users(id,email,password_hash,first_name,last_name) VALUES($1,$2,'synthetic','No','Access')",[stranger,`${stranger}@example.test`]);
    const other=express();other.use(express.json());other.use((req,_res,next)=>{req.user={id:stranger};next();});
    other.get('/r/:restaurantId/open',c.openQueue);other.use(require('../middleware/errorHandler').errorHandler);
    expect([403,404]).toContain((await request(other).get(`/r/${restaurantId}/open`)).status);
  });
});
