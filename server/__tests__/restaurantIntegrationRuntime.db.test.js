'use strict';
jest.unmock('pg');jest.unmock('../utils/transaction');
jest.mock('../db',()=>({query:jest.fn(),connect:jest.fn()}));
const crypto=require('crypto');
const {Pool}=require('pg');
const db=require('../db');
const {encrypt}=require('../utils/encryption');
const accounting=require('../services/restaurantAccountingService');
const delivery=require('../services/restaurantAccountingDelivery');
const devices=require('../services/unifiedDeviceService');
const credentials=require('../services/restaurantDeviceCredentials');
const display=require('../controllers/restaurantDisplayController');
const url=process.env.RESTAURANT_STORE_TEST_DATABASE_URL;
if(url){const u=new URL(url);if(!['postgres:','postgresql:'].includes(u.protocol)||!['localhost','127.0.0.1','[::1]'].includes(u.hostname)||u.pathname!=='/restaurant_store_test')throw Error('Requires disposable loopback restaurant_store_test');}
(url?describe:describe.skip)('restaurant provider runtime and canonical device standing, real PostgreSQL',()=>{
  let pool,owner,restaurantId,locationId;
  const originalFetch=global.fetch;
  beforeAll(async()=>{
    pool=new Pool({connectionString:url,max:6});db.query.mockImplementation((...a)=>pool.query(...a));db.connect.mockImplementation(()=>pool.connect());
    owner=crypto.randomUUID();
    await pool.query("INSERT INTO users(id,email,password_hash,first_name,last_name) VALUES($1,$2,'synthetic','Integration','Test')",[owner,`${owner}@example.test`]);
    const {rows:[business]}=await pool.query("INSERT INTO businesses(user_id,business_name) VALUES($1,'Provider fixture') RETURNING id",[owner]);
    const {rows:[restaurant]}=await pool.query("INSERT INTO food_restaurants(business_id,owner_user_id,display_name,status) VALUES($1,$2,'Provider fixture','active') RETURNING id",[business.id,owner]);restaurantId=restaurant.id;
    locationId=(await pool.query('SELECT id FROM restaurant_locations WHERE restaurant_id=$1 AND is_primary=TRUE',[restaurantId])).rows[0].id;
  });
  afterAll(async()=>{global.fetch=originalFetch;delete process.env.RESTAURANT_ACCOUNTING_DELIVERY_ENABLED;if(pool)await pool.end();});
  beforeEach(()=>{process.env.RESTAURANT_ACCOUNTING_DELIVERY_ENABLED='true';});
  async function queued(date,amount='10.00'){
    const {rows:[integration]}=await pool.query(`INSERT INTO restaurant_accounting_integrations(restaurant_id,provider,status,external_company_id,credentials_ciphertext,token_expires_at)
      VALUES($1,'xero','active','synthetic-tenant',$2,NOW()+INTERVAL '1 hour')
      ON CONFLICT(restaurant_id,provider) DO UPDATE SET credentials_ciphertext=EXCLUDED.credentials_ciphertext,token_expires_at=EXCLUDED.token_expires_at RETURNING *`,
      [restaurantId,encrypt(JSON.stringify({accessToken:'synthetic-access',refreshToken:'synthetic-refresh'}))]);
    const lines=[{date,reference:'cycle',description:'Cash',account:'1000',debit:amount,credit:'0.00',currency:'USD',location:'A'},
      {date,reference:'cycle',description:'Sales',account:'4000',debit:'0.00',credit:amount,currency:'USD',location:'A'}];
    return accounting.queueExport(pool,{restaurantId,provider:'xero',periodFrom:date,periodTo:date,currencyCode:'USD',idempotencyKey:crypto.randomUUID(),lines,actorUserId:owner});
  }
  test('posts an actual durable journal once and preserves provider idempotency and tenant identity',async()=>{
    const batch=await queued('2026-10-01');
    const calls=[];
    global.fetch=jest.fn(async(url,options)=>{calls.push({url,options});return {ok:true,text:async()=>JSON.stringify(url.endsWith('/Organisation')?{Organisations:[{BaseCurrency:'USD'}]}:{ManualJournals:[{ManualJournalID:'journal-test',Status:'POSTED'}]})};});
    const result=await delivery.processExports();expect(result.posted).toBe(1);
    await delivery.processExports();
    const posts=calls.filter(c=>c.options.method==='POST');expect(posts).toHaveLength(1);
    expect(posts[0].options.headers['Xero-tenant-id']).toBe('synthetic-tenant');
    expect(posts[0].options.headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(posts[0].options.body).ManualJournals[0].JournalLines.map(l=>l.LineAmount)).toEqual([10,-10]);
    const row=(await pool.query('SELECT status FROM restaurant_accounting_exports WHERE id=$1',[batch.export.id])).rows[0];expect(row.status).toBe('posted');
    // A second key and changed snapshot cannot repost the same company/day.
    await queued('2026-10-01','20.00');await delivery.processExports();
    expect(global.fetch.mock.calls.filter(([,o])=>o.method==='POST')).toHaveLength(1);
  });
  test('unknown provider outcome cannot be automatically retried or manually rearmed',async()=>{
    const batch=await queued('2026-10-02');
    global.fetch=jest.fn(async(url)=>{if(url.endsWith('/Organisation'))return {ok:true,text:async()=>JSON.stringify({Organisations:[{BaseCurrency:'USD'}]})};throw Error('lost response');});
    await delivery.processExports();
    expect((await pool.query('SELECT status FROM restaurant_accounting_exports WHERE id=$1',[batch.export.id])).rows[0].status).toBe('requires_reconciliation');
    const calls=global.fetch.mock.calls.length;await delivery.processExports();expect(global.fetch.mock.calls).toHaveLength(calls);
    await expect(accounting.updateExportStatus(pool,{restaurantId,exportId:Number(batch.export.id),status:'pending'})).rejects.toMatchObject({code:'accounting_provider_reconciliation_required'});
  });
  test('registry standing and store identity govern old app credentials',async()=>{
    const token=crypto.randomBytes(32).toString('hex');
    const {rows:[device]}=await pool.query(`INSERT INTO restaurant_app_devices(restaurant_id,location_id,app_key,device_name,status,device_token_hash)
      VALUES($1,$2,'hub','Hub','paired',$3) RETURNING id`,[restaurantId,locationId,credentials.tokenHash(token)]);
    const authenticated=await credentials.authenticateAppDevice(pool,{restaurantId,deviceId:device.id,token});expect(authenticated.registry_role).toBe('hub');
    await pool.query("UPDATE restaurant_devices SET status='disabled' WHERE id=$1",[authenticated.registry_id]);
    await expect(credentials.authenticateAppDevice(pool,{restaurantId,deviceId:device.id,token})).rejects.toMatchObject({code:'invalid_device_credential'});
    await pool.query('DELETE FROM restaurant_app_devices WHERE id=$1',[device.id]);
    expect((await pool.query('SELECT status FROM restaurant_devices WHERE id=$1',[authenticated.registry_id])).rows[0].status).toBe('disabled');
  });
  test('display disable revokes current and rotated credentials without violating claim-state CHECK',async()=>{
    const token=crypto.randomBytes(32).toString('hex'),previous=crypto.randomBytes(32).toString('hex');
    const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
    const {rows:[paired]}=await pool.query(`INSERT INTO display_pairings(restaurant_id,location_id,code_hash,pairing_token_hash,pairing_token_hash_prev,
      pairing_token_expires_at,pairing_token_prev_expires_at,expires_at,paired_at,label)
      VALUES($1,$2,$3,$4,$5,NOW()+INTERVAL '1 day',NOW()+INTERVAL '1 hour',NOW()+INTERVAL '1 day',NOW(),'Test display') RETURNING id`,
      [restaurantId,locationId,hash(crypto.randomUUID()),hash(token),hash(previous)]);
    const registry=(await pool.query('SELECT id FROM restaurant_devices WHERE source_display_pairing_id=$1',[paired.id])).rows[0];
    expect(await display.verifyDisplayPairingToken(token)).toBeTruthy();
    await devices.setDeviceStatus(pool,{restaurantId,deviceId:registry.id,status:'disabled'});
    expect(await display.verifyDisplayPairingToken(token)).toBeNull();expect(await display.verifyDisplayPairingToken(previous)).toBeNull();
    await expect(devices.setDeviceStatus(pool,{restaurantId,deviceId:registry.id,status:'active'})).rejects.toMatchObject({code:'device_pairing_required'});
  });
  test('offline permits reserve a drawer tender, survive retries and reconcile only matching connected intents',async()=>{
    const terminal=require('../services/restaurantPosTerminalService');
    const offline=require('../services/restaurantTerminalOffline');
    const account=jest.spyOn(terminal,'resolveRestaurantConnectAccount').mockResolvedValue('acct_synthetic');
    const retrieve=jest.spyOn(terminal,'retrieveConnectedIntent');
    process.env.RESTAURANT_TERMINAL_OFFLINE_ENABLED='true';
    try{
      const {rows:[device]}=await pool.query(`INSERT INTO restaurant_app_devices(restaurant_id,location_id,app_key,device_name,status,device_token_hash)
        VALUES($1,$2,'pos','POS','paired',$3) RETURNING id`,[restaurantId,locationId,credentials.tokenHash(crypto.randomUUID())]);
      const registry=(await pool.query('SELECT id FROM restaurant_devices WHERE source_app_device_id=$1',[device.id])).rows[0];
      const {rows:[shift]}=await pool.query("INSERT INTO restaurant_pos_shifts(restaurant_id,location_id,staff_user_id) VALUES($1,$2,$3) RETURNING id",[restaurantId,locationId,owner]);
      const {rows:[order]}=await pool.query(`INSERT INTO food_orders(restaurant_id,business_id,location_id,subtotal_cents,total_cents,currency_code,queue_number)
        SELECT id,business_id,$2,1000,1000,'USD',1001 FROM food_restaurants WHERE id=$1 RETURNING id`,[restaurantId,locationId]);
      await pool.query(`INSERT INTO restaurant_store_forward_settings(restaurant_id,location_id,enabled,max_transaction_cents,max_daily_cents,allowed_card_brands)
        VALUES($1,$2,TRUE,2000,1500,ARRAY['visa'])`,[restaurantId,locationId]);
      const input={restaurantId,locationId,deviceId:registry.id,orderId:order.id,shiftId:shift.id,userId:owner};
      const permit=await offline.issuePermit(input);expect((await offline.issuePermit(input)).id).toBe(permit.id);
      const reservation=(await pool.query('SELECT * FROM restaurant_pos_payments WHERE id=$1',[permit.pos_payment_id])).rows[0];
      expect(reservation.status).toBe('pending');expect(Number(reservation.amount_cents)).toBe(1000);
      const express=require('express'),request=require('supertest');
      const http=express();http.use(express.json());http.use((req,_res,next)=>{req.user={id:owner};next();});
      http.post('/restaurants/:restaurantId/orders/:orderId/payments',require('../controllers/restaurantAppFlowController').recordPosPayment);
      http.use(require('../middleware/errorHandler').errorHandler);
      const competing=await request(http).post(`/restaurants/${restaurantId}/orders/${order.id}/payments`).send({paymentType:'cash',amountCents:1000,shiftId:shift.id});
      expect(competing.status).toBe(409);

      expect((await pool.query('SELECT payment_status FROM food_orders WHERE id=$1',[order.id])).rows[0].payment_status).toBe('requires_payment');
      const intent={id:'pi_'+crypto.randomUUID().replace(/-/g,''),status:'requires_capture',amount:1000,currency:'usd',metadata:{offlineId:permit.id,food_order_id:String(order.id)},latest_charge:{payment_method_details:{card_present:{brand:'visa'}}}};
      retrieve.mockResolvedValue({...intent,amount:1001});
      await expect(offline.reconcileForwarded({restaurantId,permitId:permit.id,intentId:intent.id})).rejects.toMatchObject({code:'terminal_offline_intent_mismatch'});
      retrieve.mockResolvedValue(intent);const pending=await offline.reconcileForwarded({restaurantId,permitId:permit.id,intentId:intent.id});expect(pending.payment.status).toBe('pending');
      expect(retrieve).toHaveBeenLastCalledWith(intent.id,'acct_synthetic');
      retrieve.mockResolvedValue({...intent,status:'succeeded',amount_received:1000});
      await offline.reconcileForwarded({restaurantId,permitId:permit.id,intentId:intent.id});await offline.reconcileForwarded({restaurantId,permitId:permit.id,intentId:intent.id});
      expect((await pool.query('SELECT COUNT(*)::int AS n FROM restaurant_pos_payments WHERE food_order_id=$1',[order.id])).rows[0].n).toBe(1);
      expect((await pool.query('SELECT payment_status FROM food_orders WHERE id=$1',[order.id])).rows[0].payment_status).toBe('paid');
      const {rows:[second]}=await pool.query(`INSERT INTO food_orders(restaurant_id,business_id,location_id,subtotal_cents,total_cents,currency_code,queue_number)
        SELECT id,business_id,$2,1000,1000,'USD',1002 FROM food_restaurants WHERE id=$1 RETURNING id`,[restaurantId,locationId]);
      await expect(offline.issuePermit({...input,orderId:second.id})).rejects.toMatchObject({code:'terminal_offline_limit_exceeded'});
    }finally{account.mockRestore();retrieve.mockRestore();delete process.env.RESTAURANT_TERMINAL_OFFLINE_ENABLED;}
  });
  test('marketplace store orders deduplicate concurrent retries and reject changed financial facts',async()=>{
    const marketplace=require('../services/restaurantDeliveryMarketplaceService');
    await marketplace.upsertIntegration(pool,{restaurantId,locationId,provider:'doordash',externalLocationId:crypto.randomUUID(),status:'enabled',actorUserId:owner});
    const input={restaurantId,locationId,provider:'doordash',externalOrderId:crypto.randomUUID(),currencyCode:'USD',totalCents:1200,payload:{items:[{id:'meal',qty:1}]}};
    const results=await Promise.all([marketplace.ingestOrder(pool,input),marketplace.ingestOrder(pool,input)]);
    expect(results.filter(r=>!r.replayed)).toHaveLength(1);expect(results[0].order.location_id).toBe(String(locationId));
    await expect(marketplace.ingestOrder(pool,{...input,totalCents:1201})).rejects.toMatchObject({code:'delivery_order_replay_conflict'});
  });

  test('cloud bootstrap uses store prices, excludes required choices and refuses unsupported fee calculation',async()=>{
    const {bootstrap}=require('../services/storeHubBootstrap');
    const {rows:[item]}=await pool.query("INSERT INTO food_menu_items(restaurant_id,name,price_cents,publication_status) VALUES($1,'Simple',1000,'published') RETURNING id",[restaurantId]);
    await pool.query('INSERT INTO restaurant_store_menu_overrides(restaurant_id,location_id,menu_item_id,price_cents) VALUES($1,$2,$3,1200)',[restaurantId,locationId,item.id]);
    expect((await bootstrap(pool,{restaurantId,locationId})).items.find(i=>i.id===item.id).price_cents).toBe(1200);
    await pool.query("INSERT INTO food_modifier_groups(restaurant_id,menu_item_id,name,is_required) VALUES($1,$2,'Required choice',TRUE)",[restaurantId,item.id]);
    expect((await bootstrap(pool,{restaurantId,locationId})).items.some(i=>i.id===item.id)).toBe(false);
    await pool.query('UPDATE restaurant_locations SET service_fee_bps=100 WHERE id=$1',[locationId]);
    await expect(bootstrap(pool,{restaurantId,locationId})).rejects.toMatchObject({code:'hub_service_fee_unsupported'});
    await pool.query('UPDATE restaurant_locations SET service_fee_bps=0 WHERE id=$1',[locationId]);
  });
  test('verified marketplace ingress acknowledges durable encrypted receipt and detects altered event retries',async()=>{
    const controller=require('../controllers/restaurantMarketplaceWebhookController');
    const secrets=require('../services/restaurantProviderSecrets');
    const resolve=jest.spyOn(secrets,'resolveReferences').mockResolvedValue({webhookSecret:'synthetic-webhook'});
    process.env.RESTAURANT_MARKETPLACE_WEBHOOKS_ENABLED='true';
    const {rows:[integration]}=await pool.query("UPDATE restaurant_delivery_marketplace_integrations SET webhook_secret_ref='{{resolve:secretsmanager:synthetic:SecretString:webhook}}' WHERE restaurant_id=$1 AND provider='doordash' RETURNING id",[restaurantId]);
    const event={event:{id:crypto.randomUUID(),type:'OrderCreate'},order:{id:'synthetic-order'}};
    async function send(payload,auth='synthetic-webhook'){
      const req={params:{integrationId:String(integration.id)},headers:{authorization:auth},body:Buffer.from(JSON.stringify(payload))};
      const res={status:jest.fn().mockReturnThis(),json:jest.fn()};let error;await controller.receive(req,res,e=>{error=e;});return {res,error};
    }
    try{
      expect((await send(event,'forged')).error).toMatchObject({code:'delivery_webhook_signature_invalid'});
      expect((await send(event)).error).toBeUndefined();expect((await send(event)).error).toBeUndefined();
      expect((await send({...event,order:{id:'changed'}})).error).toMatchObject({code:'delivery_webhook_replay_conflict'});
      const receipts=(await pool.query('SELECT * FROM restaurant_marketplace_webhook_receipts WHERE integration_id=$1',[integration.id])).rows;
      expect(receipts).toHaveLength(1);expect(receipts[0].payload_ciphertext).not.toContain('synthetic-order');expect(receipts[0].status).toBe('requires_provider_mapping');
    }finally{resolve.mockRestore();delete process.env.RESTAURANT_MARKETPLACE_WEBHOOKS_ENABLED;}
  });

  test('generated provider journals reject refund and inclusive-tax periods before enqueueing',async()=>{
    const reports=require('../controllers/restaurantReportsController');
    const load=jest.spyOn(reports._accountingTest,'loadSalesJournalRows');
    const controller=require('../controllers/restaurantAccountingController');
    const req={params:{restaurantId:String(restaurantId),provider:'xero'},user:{id:owner},query:{},body:{from:'2026-10-03',to:'2026-10-03',currencyCode:'USD'},get:()=>crypto.randomUUID()};
    const row={currency:'USD',order_id:1,payment_status:'paid',order_status:'completed',payment_type:'cash'};
    const before=(await pool.query('SELECT COUNT(*)::int AS n FROM restaurant_accounting_exports WHERE restaurant_id=$1',[restaurantId])).rows[0].n;
    try{
      for(const [changes,code]of [[{payment_type:'refund'},'accounting_refund_review_required'],[{tax_rule_snapshot:{mode:'inclusive'}},'accounting_tax_review_required']]){
        load.mockResolvedValue({rows:[{...row,...changes}],fromDate:'2026-10-03',toDate:'2026-10-03'});
        let error;await controller.queueJournal(req,{status:jest.fn().mockReturnThis(),json:jest.fn()},e=>{error=e;});expect(error).toMatchObject({code});
      }
      expect((await pool.query('SELECT COUNT(*)::int AS n FROM restaurant_accounting_exports WHERE restaurant_id=$1',[restaurantId])).rows[0].n).toBe(before);
    }finally{load.mockRestore();}
  });

});
