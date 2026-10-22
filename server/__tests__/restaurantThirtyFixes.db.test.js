'use strict';
// Explicit disposable loopback DB only. Every table lives in a random test schema.
jest.unmock('pg');
jest.unmock('../utils/transaction');
jest.mock('../db', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('../services/scopeModel', () => ({ resolveRestaurantAccess: jest.fn() }));
jest.mock('../services/permissionsService', () => ({ hasRestaurantPermission: jest.fn(async () => true), getEffectivePermissions: jest.fn(async () => ({ permissions: new Set(['*']) })), hasAny: (p, c) => p.has('*') || c.some((code) => p.has(code)) }));
jest.mock('../services/smsNotificationService', () => ({ sendTransactionalSMS: jest.fn(async () => ({ success: true })) }));
jest.mock('../services/notificationService', () => ({ sendNotification: jest.fn(async () => ({ success: true })) }));
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const db = require('../db');
const payroll = require('../services/restaurantPayrollService');
const loyalty = require('../controllers/restaurantLoyaltyController');
const hosting = require('../controllers/restaurantHostingController');
const campaigns = require('../services/restaurantLoyaltyCampaignService');
const { listBusinessAudit, listBusinessAuditActors } = require('../services/businessAuditLog');
const scopeModel = require('../services/scopeModel');
const url = process.env.FRANCHISE_SCOPE_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) || parsed.pathname !== '/franchise_scope_test') throw new Error('Requires disposable loopback franchise_scope_test database');
}
const userA = '00000000-0000-4000-8000-000000000001';
const userB = '00000000-0000-4000-8000-000000000002';
const restaurant = { id: 3, business_id: 42, effective_role: 'owner', timezone: 'America/New_York', currency_code: 'USD' };
async function invoke(handler, body = {}, params = {}, query = {}) {
  const req = { params: { restaurantId: '3', ...params }, body, query, user: { id: userA }, headers: {}, get: () => null };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() }; const next = jest.fn();
  await handler(req, res, next); return { error: next.mock.calls[0]?.[0], data: res.json.mock.calls[0]?.[0] };
}
(url ? describe : describe.skip)('thirty-fix PostgreSQL regressions', () => {
  let pool; let admin; const schema = `franchise_${crypto.randomBytes(6).toString('hex')}`;
  beforeAll(async () => {
    admin = new Pool({ connectionString: url }); await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: url, options: `-c search_path=${schema}`, max: 4 });
    db.query.mockImplementation((...args) => pool.query(...args)); db.connect.mockImplementation(() => pool.connect());
    await pool.query(`
      CREATE TABLE users(id UUID PRIMARY KEY, first_name TEXT, last_name TEXT, email TEXT);
      CREATE TABLE businesses(id BIGINT PRIMARY KEY, user_id UUID);
      CREATE TABLE food_restaurants(id BIGINT PRIMARY KEY, business_id BIGINT);
      CREATE TABLE restaurant_locations(id BIGINT PRIMARY KEY, restaurant_id BIGINT, name TEXT, status TEXT DEFAULT 'active', timezone TEXT DEFAULT 'UTC', is_primary BOOLEAN DEFAULT FALSE, UNIQUE(restaurant_id,id));
      CREATE TABLE business_members(id BIGINT PRIMARY KEY, business_id BIGINT, member_id UUID, status TEXT, role TEXT, job_role TEXT, hourly_wage_cents INTEGER, pay_rate_period TEXT, pay_rate_cents INTEGER);
      CREATE TABLE restaurant_location_memberships(id BIGINT, restaurant_id BIGINT, location_id BIGINT, membership_id BIGINT, status TEXT, role_override TEXT, pay_rate_cents INTEGER, pay_rate_period VARCHAR(10));
      CREATE TABLE business_staff_shifts(id BIGSERIAL PRIMARY KEY, business_id BIGINT, restaurant_id BIGINT, user_id UUID, shift_date DATE, start_time TIME, end_time TIME, published_at TIMESTAMPTZ, published_by UUID);
      CREATE TABLE business_time_entries(id BIGSERIAL PRIMARY KEY, business_id BIGINT, user_id UUID, entry_date DATE, hours_worked NUMERIC, breaks JSONB, clock_in_at TIMESTAMPTZ, clock_out_at TIMESTAMPTZ, voided_at TIMESTAMPTZ);
      CREATE TABLE restaurant_declared_cash_tips(id BIGSERIAL PRIMARY KEY, restaurant_id BIGINT, staff_user_id UUID, business_date DATE, amount_cents INTEGER, declared_by UUID, note TEXT, created_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE team_permissions(code TEXT UNIQUE, group_key TEXT, description TEXT);
      CREATE TABLE restaurant_waitlist_entries(id BIGSERIAL PRIMARY KEY, restaurant_id BIGINT, location_id BIGINT, status TEXT DEFAULT 'waiting', guest_phone TEXT, quoted_wait_min INTEGER, notified_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, joined_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE restaurant_tip_pool_settings(restaurant_id BIGINT, pooling_enabled BOOLEAN, tip_out_rules JSONB, updated_by UUID, updated_at TIMESTAMPTZ);
      CREATE TABLE restaurant_labor_policies(restaurant_id BIGINT, overtime_threshold_hours NUMERIC, overtime_multiplier_bps INTEGER, break_after_minutes INTEGER, break_duration_minutes INTEGER, updated_by UUID, updated_at TIMESTAMPTZ);
      CREATE TABLE food_orders(id BIGSERIAL PRIMARY KEY, restaurant_id BIGINT, location_id BIGINT, customer_id UUID, payment_status TEXT, status TEXT, total_cents INTEGER, tip_cents INTEGER, discount_cents INTEGER DEFAULT 0, currency_code TEXT, acting_staff_user_id UUID, metadata JSONB, created_at TIMESTAMPTZ);
      CREATE TABLE restaurant_pos_payments(id BIGSERIAL PRIMARY KEY, restaurant_id BIGINT, location_id BIGINT, food_order_id BIGINT, amount_cents INTEGER, payment_type TEXT, status TEXT, created_by UUID, created_at TIMESTAMPTZ);
      CREATE TABLE restaurant_pos_shifts(id BIGINT PRIMARY KEY, staff_user_id UUID);
      CREATE TABLE restaurant_pos_drawer_events(restaurant_id BIGINT, location_id BIGINT, created_by UUID, event_type TEXT, amount_cents INTEGER, created_at TIMESTAMPTZ);
      CREATE TABLE food_loyalty_accounts(restaurant_id BIGINT, customer_id UUID, lifetime_points INTEGER);
      CREATE TABLE business_audit_log(id BIGSERIAL PRIMARY KEY, business_id BIGINT, actor_user_id UUID, actor_role TEXT, action TEXT, target_type TEXT, target_id TEXT, before_state JSONB, after_state JSONB, metadata JSONB, ip_address TEXT, user_agent TEXT, impersonated_by UUID, created_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE restaurant_tables(id BIGINT PRIMARY KEY, restaurant_id BIGINT, location_id BIGINT, name TEXT, capacity INTEGER, status TEXT, position JSONB, updated_at TIMESTAMPTZ);
      CREATE TABLE restaurant_reservations(id BIGSERIAL PRIMARY KEY, restaurant_id BIGINT, location_id BIGINT, table_id BIGINT, guest_name TEXT, guest_phone TEXT, guest_email TEXT, party_size INTEGER, starts_at TIMESTAMPTZ, ends_at TIMESTAMPTZ, status TEXT DEFAULT 'pending', source TEXT, notes TEXT, idempotency_key TEXT, created_by UUID, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ, UNIQUE(restaurant_id,idempotency_key));
      CREATE TABLE restaurant_inventory_storage_areas(id BIGINT PRIMARY KEY, restaurant_id BIGINT, name TEXT, responsible_user_id UUID, is_active BOOLEAN);
      CREATE TABLE restaurant_inventory_suppliers(id BIGINT PRIMARY KEY, restaurant_id BIGINT, name TEXT, is_active BOOLEAN);
      CREATE TABLE restaurant_inventory_items(id BIGINT, restaurant_id BIGINT, location_id BIGINT, storage_area_id BIGINT, supplier_id BIGINT, is_active BOOLEAN, quantity NUMERIC, reorder_point NUMERIC, last_counted_at TIMESTAMPTZ);
      CREATE TABLE restaurant_inventory_supplier_issues(id BIGINT, restaurant_id BIGINT, location_id BIGINT, supplier_name TEXT, status TEXT);
      CREATE TABLE restaurant_gift_card_products(id BIGSERIAL PRIMARY KEY, restaurant_id BIGINT, sku TEXT, name TEXT, amount_cents INTEGER, currency_code TEXT, delivery_type TEXT, is_active BOOLEAN DEFAULT TRUE, metadata JSONB, created_by UUID, updated_by UUID, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE restaurant_loyalty_segments(id BIGSERIAL PRIMARY KEY, restaurant_id BIGINT, name TEXT, criteria JSONB, is_active BOOLEAN DEFAULT TRUE, created_by UUID, updated_by UUID, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE restaurant_loyalty_campaigns(id BIGINT PRIMARY KEY, status TEXT, subject TEXT, name TEXT, body TEXT, completed_at TIMESTAMPTZ);
      CREATE TABLE restaurant_loyalty_campaign_deliveries(id BIGINT PRIMARY KEY, campaign_id BIGINT, customer_id UUID, channel TEXT, status TEXT, attempts INTEGER, next_attempt_at TIMESTAMPTZ DEFAULT NOW(), lease_token UUID, lease_expires_at TIMESTAMPTZ, notification_id BIGINT, sent_at TIMESTAMPTZ, last_error TEXT, updated_at TIMESTAMPTZ);
    `);
    await pool.query(fs.readFileSync(path.join(__dirname, '../migrations/994_restaurant_payroll_hosting_scope.sql'), 'utf8'));
  });
  beforeEach(async () => {
    scopeModel.resolveRestaurantAccess.mockResolvedValue({ ...restaurant });
    await pool.query(`TRUNCATE users, businesses, food_restaurants, restaurant_locations, business_members, restaurant_location_memberships, business_staff_shifts, business_time_entries, restaurant_declared_cash_tips, restaurant_tip_pool_settings, restaurant_labor_policies, food_orders, restaurant_pos_payments, restaurant_pos_shifts, restaurant_pos_drawer_events, food_loyalty_accounts, business_audit_log, restaurant_tables, restaurant_reservations, restaurant_waitlist_entries, restaurant_loyalty_campaign_deliveries, restaurant_loyalty_campaigns, restaurant_inventory_storage_areas, restaurant_inventory_suppliers, restaurant_inventory_items, restaurant_inventory_supplier_issues, restaurant_gift_card_products, restaurant_loyalty_segments CASCADE;
      INSERT INTO users VALUES ('${userA}','Store','A','a@example.test'),('${userB}','Store','B','b@example.test');
      INSERT INTO businesses VALUES(42,'${userA}'); INSERT INTO food_restaurants VALUES(3,42),(4,43);
      INSERT INTO restaurant_locations(id,restaurant_id,name,is_primary) VALUES(7,3,'Store A',TRUE),(9,3,'Store B',FALSE),(10,4,'Other tenant',TRUE);
      INSERT INTO business_members VALUES(8,42,'${userA}','active','employee','server',1000,NULL,NULL),(9,42,'${userB}','active','employee','server',2000,NULL,NULL);
      INSERT INTO restaurant_location_memberships VALUES(1,3,7,8,'active',NULL),(2,3,9,9,'active',NULL);
    `);
  });
  afterEach(() => { delete process.env.RESTAURANT_LOYALTY_DELIVERY_ENABLED; });
  afterAll(async () => { if (pool) await pool.end(); if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); } });
  test('CRM audience criteria bind after restaurant ID and assigned counts exclude sibling orders', async () => {
    await pool.query(`INSERT INTO food_loyalty_accounts VALUES(3,'${userA}',100),(3,'${userB}',1);
      INSERT INTO food_orders(restaurant_id,location_id,customer_id,payment_status,status,created_at) VALUES(3,7,'${userA}','paid','completed',NOW()),(3,9,'${userB}','paid','completed',NOW());`);
    expect(await loyalty._normalize.audienceFor(3,{ min_lifetime_points: 50, min_orders: 1 })).toMatchObject({ totalCustomers: 2, matchingCustomers: 1 });
    expect(await loyalty._normalize.audienceFor(3,{ location_id: 7, min_orders: 1 }, { mode: 'assigned', location_ids: [7] })).toMatchObject({ totalCustomers: 1, matchingCustomers: 1 });
    await expect(loyalty._normalize.audienceFor(3,{location_id:9},{mode:'assigned',location_ids:[7]})).rejects.toMatchObject({statusCode:403});
  });
  test('payroll scope covers roster, hours, overtime, schedules, tips, revenue and export inputs', async () => {
    await pool.query(`INSERT INTO business_time_entries(business_id,user_id,entry_date,hours_worked,location_id) VALUES(42,'${userA}','2026-10-21',2,7),(42,'${userA}','2026-10-21',8,9),(42,'${userB}','2026-10-21',8,9),(42,'${userA}','2026-10-21',10,NULL);
      INSERT INTO business_staff_shifts(business_id,user_id,shift_date,start_time,end_time,location_id,published_at) VALUES(42,'${userA}','2026-10-21','09:00','12:00',7,NOW()),(42,'${userB}','2026-10-21','09:00','17:00',9,NOW());
      INSERT INTO food_orders(restaurant_id,location_id,total_cents,tip_cents,currency_code,acting_staff_user_id,payment_status,status,created_at) VALUES(3,7,10000,200,'USD','${userA}','paid','completed','2026-10-21T16:00Z'),(3,9,90000,900,'USD','${userB}','paid','completed','2026-10-21T16:00Z');
      INSERT INTO restaurant_declared_cash_tips(restaurant_id,staff_user_id,business_date,amount_cents,location_id) VALUES(3,'${userA}','2026-10-21',100,7),(3,'${userA}','2026-10-21',900,9);`);
    const result = await payroll.computeLabor({ restaurant, fromDate:'2026-10-21', toDate:'2026-10-21', locationIds:[7] });
    expect(result.employees).toHaveLength(1); expect(result.employees[0]).toMatchObject({ user_id:userA,hours:2,scheduled_hours:3,wages_cents:2000,net_tips_cents:300 });
    expect(payroll.buildPayrollCsv(result)).not.toContain(userB);
    expect(JSON.stringify(result)).not.toContain('90000');
    const exceptions = await payroll.computeExceptions({restaurant,fromDate:'2026-10-21',toDate:'2026-10-21',locationIds:[7]});
    expect(exceptions.employees.some((e)=>e.user_id===userB)).toBe(false);
  });
  test('payroll database rejects cross-business attribution and preserves ambiguous legacy rows', async () => {
    await expect(pool.query(`INSERT INTO business_time_entries(business_id,user_id,entry_date,location_id) VALUES(42,'${userA}','2026-10-21',10)`)).rejects.toMatchObject({code:'23514'});
    await expect(pool.query(`INSERT INTO restaurant_declared_cash_tips(restaurant_id,staff_user_id,business_date,amount_cents,location_id) VALUES(3,'${userA}','2026-10-21',10,10)`)).rejects.toMatchObject({code:'23503'});
    const {rows:[entry]}=await pool.query(`INSERT INTO business_time_entries(business_id,user_id,entry_date) VALUES(42,'${userA}','2026-10-21') RETURNING location_id`); expect(entry.location_id).toBeNull();
  });
  test('activity date-only filters use the 23-hour DST day and scope both actors and rows', async () => {
    await pool.query(`INSERT INTO business_audit_log(business_id,actor_user_id,action,metadata,created_at) VALUES(42,'${userA}','a','{"location_id":7}','2026-03-08T05:00Z'),(42,'${userA}','a','{"location_id":7}','2026-03-09T03:59:59Z'),(42,'${userA}','a','{"location_id":7}','2026-03-09T04:00Z'),(42,'${userB}','b','{"location_id":9}','2026-03-08T12:00Z'),(42,'${userB}','legacy','{}','2026-03-08T12:00Z');`);
    const opts={restaurantId:3,locationIds:[7],timezone:'America/New_York',from:'2026-03-08',to:'2026-03-08'};
    expect((await listBusinessAudit(42,opts)).total).toBe(2); expect(await listBusinessAuditActors(42,opts)).toEqual([expect.objectContaining({user_id:userA})]);
  });
  test('simultaneous creates serialize on the table and admit only one overlapping reservation', async () => {
    await pool.query("INSERT INTO restaurant_tables VALUES(11,3,7,'T1',4,'active','{}',NOW())");
    const body={locationId:7,tableId:11,guestName:'Guest',partySize:2,startsAt:'2026-10-21T18:00Z',endsAt:'2026-10-21T19:00Z'};
    const results=await Promise.all([invoke(hosting.createReservation,{...body,idempotencyKey:'one'}),invoke(hosting.createReservation,{...body,idempotencyKey:'two'})]);
    expect(results.filter((r)=>!r.error)).toHaveLength(1); expect(results.find((r)=>r.error).error.code).toBe('reservation_conflict');
    const {rows:[r]}=await pool.query('SELECT * FROM restaurant_reservations');
    expect((await invoke(hosting.updateReservation,{partySize:5},{reservationId:r.id})).error.code).toBe('table_capacity_exceeded');
  });
  test('simultaneous waitlist sends claim once and acknowledge once', async () => {
    const {sendTransactionalSMS}=require('../services/smsNotificationService'); sendTransactionalSMS.mockClear();
    await pool.query("INSERT INTO restaurant_waitlist_entries(id,restaurant_id,location_id,guest_phone,status) VALUES(1,3,7,'+15555550123','waiting')");
    const results=await Promise.all([invoke(hosting.notifyWaitlistEntry,{}, {entryId:'1'}),invoke(hosting.notifyWaitlistEntry,{}, {entryId:'1'})]);
    expect(results.some((r)=>!r.error)).toBe(true); expect(sendTransactionalSMS).toHaveBeenCalledTimes(1);
    const again=await invoke(hosting.notifyWaitlistEntry,{}, {entryId:'1'}); expect(again.data.delivery.alreadyNotified).toBe(true);
  });
  test('expired campaign leases recover below the attempt bound and become terminal at the bound', async () => {
    process.env.RESTAURANT_LOYALTY_DELIVERY_ENABLED='true';
    await pool.query(`INSERT INTO restaurant_loyalty_campaigns VALUES(1,'queued','Subject','Campaign','Body',NULL);
      INSERT INTO restaurant_loyalty_campaign_deliveries(id,campaign_id,customer_id,channel,status,attempts,lease_expires_at) VALUES(1,1,'${userA}','in_app','sending',1,NOW()-INTERVAL '10 minutes'),(2,1,'${userB}','in_app','sending',5,NOW()-INTERVAL '10 minutes');`);
    expect(await campaigns.deliverBatch()).toMatchObject({claimed:1,sent:1});
    const {rows}=await pool.query('SELECT id,status,attempts FROM restaurant_loyalty_campaign_deliveries ORDER BY id'); expect(rows).toEqual([{id:'1',status:'sent',attempts:2},{id:'2',status:'failed',attempts:5}]);
  });
  test('scoped overtime keeps the person-wide threshold without returning sibling-store hours', async () => {
    await pool.query(`INSERT INTO business_time_entries(business_id,user_id,entry_date,hours_worked,location_id) VALUES
      (42,'${userA}','2026-10-19',24,9),(42,'${userA}','2026-10-20',16,9),(42,'${userA}','2026-10-21',2,7);`);
    const result=await payroll.computeLabor({restaurant,fromDate:'2026-10-21',toDate:'2026-10-21',locationIds:[7]});
    expect(result.employees[0]).toMatchObject({hours:2,overtime_hours:2,wages_cents:3000});
  });
  test('transient delivery failures back off and stop after the fifth attempt', async () => {
    const {sendNotification}=require('../services/notificationService');
    sendNotification.mockResolvedValue({success:false,error:'provider unavailable'});
    process.env.RESTAURANT_LOYALTY_DELIVERY_ENABLED='true';
    await pool.query(`INSERT INTO restaurant_loyalty_campaigns VALUES(1,'queued','Subject','Campaign','Body',NULL);
      INSERT INTO restaurant_loyalty_campaign_deliveries(id,campaign_id,customer_id,channel,status,attempts) VALUES(1,1,'${userA}','email','pending',0);`);
    expect(await campaigns.deliverBatch()).toMatchObject({claimed:1,sent:0});
    const {rows:[first]}=await pool.query('SELECT status,next_attempt_at>NOW() AS backed_off FROM restaurant_loyalty_campaign_deliveries WHERE id=1');
    expect(first).toEqual({status:'pending',backed_off:true}); expect(await campaigns.deliverBatch()).toMatchObject({claimed:0});
    await pool.query("UPDATE restaurant_loyalty_campaign_deliveries SET attempts=4,next_attempt_at=NOW()-INTERVAL '1 minute'");
    await campaigns.deliverBatch(); expect((await pool.query('SELECT status FROM restaurant_loyalty_campaign_deliveries')).rows[0].status).toBe('failed');
    sendNotification.mockResolvedValue({success:true});
  });

  test('storage-area and supplier statistics exclude sibling-store facts', async () => {
    const inventory=require('../controllers/restaurantInventoryOperationsController');
    scopeModel.resolveRestaurantAccess.mockResolvedValue({...restaurant,effective_role:'employee',effective_membership_id:8});
    await pool.query(`INSERT INTO restaurant_inventory_storage_areas VALUES(1,3,'Dry',NULL,TRUE);
      INSERT INTO restaurant_inventory_suppliers VALUES(1,3,'Supplier',TRUE);
      INSERT INTO restaurant_inventory_items VALUES(1,3,7,1,1,TRUE,1,2,NOW()),(2,3,9,1,1,TRUE,0,2,NOW());
      INSERT INTO restaurant_inventory_supplier_issues VALUES(1,3,7,'Supplier','open'),(2,3,9,'Supplier','open');`);
    expect((await invoke(inventory.listAreas)).data.areas[0]).toMatchObject({item_count:1,critical_count:1});
    expect((await invoke(inventory.listSuppliers)).data.suppliers[0]).toMatchObject({item_count:1,open_issue_count:1});
  });
  test('waitlist pagination filters status and reports truncation explicitly', async () => {
    await pool.query("INSERT INTO restaurant_waitlist_entries(restaurant_id,location_id,status) VALUES(3,7,'waiting'),(3,7,'waiting'),(3,7,'seated'),(3,9,'waiting')");
    const result=await invoke(hosting.listWaitlist,{}, {}, {locationId:'7',limit:'1',status:'waiting'});
    expect(result.error).toBeUndefined(); expect(result.data).toMatchObject({limit:1,offset:0,hasMore:true}); expect(result.data.entries).toHaveLength(1);
    scopeModel.resolveRestaurantAccess.mockResolvedValue({...restaurant,effective_role:'employee',effective_membership_id:8});
    expect((await invoke(hosting.listWaitlist,{}, {}, {locationId:'9'})).error.statusCode).toBe(403);
  });
  test('rescheduling and creation use the same parent lock to prevent overlap', async () => {
    await pool.query("INSERT INTO restaurant_tables VALUES(11,3,7,'T1',4,'active','{}',NOW())");
    const base={locationId:7,tableId:11,guestName:'Guest',partySize:2,startsAt:'2026-10-21T18:00Z',endsAt:'2026-10-21T19:00Z'};
    const first=await invoke(hosting.createReservation,base);
    const results=await Promise.all([
      invoke(hosting.updateReservation,{startsAt:'2026-10-21T20:00Z',endsAt:'2026-10-21T21:00Z'},{reservationId:first.data.reservation.id}),
      invoke(hosting.createReservation,{...base,startsAt:'2026-10-21T20:00Z',endsAt:'2026-10-21T21:00Z'}),
    ]);
    expect(results.filter((r)=>!r.error)).toHaveLength(1); expect(results.find((r)=>r.error).error.code).toBe('reservation_conflict');
  });

  test.each([
    ['gift-card', 'restaurant_gift_card_products', 'restaurant.gift_card_product.created', {sku:'GC-25',name:'Card',amountCents:2500,deliveryType:'physical'}],
    ['CRM', 'restaurant_loyalty_segments', 'restaurant.loyalty_segment.created', {name:'Guests',criteria:{}}],
  ])('%s writes roll back on a real PostgreSQL audit constraint failure', async (kind, table, action, body) => {
    const handler=kind==='CRM' ? loyalty.createSegment : require('../controllers/restaurantGiftCardController').createProduct;
    await pool.query(`ALTER TABLE business_audit_log ADD CONSTRAINT reject_test_audit CHECK(action <> '${action}')`);
    try {
      expect((await invoke(handler,body)).error.code).toBe('23514');
      expect((await pool.query(`SELECT COUNT(*)::int AS n FROM ${table}`)).rows[0].n).toBe(0);
    } finally { await pool.query('ALTER TABLE business_audit_log DROP CONSTRAINT reject_test_audit'); }
  });

});
