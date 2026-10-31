'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { mockQuery } = require('./setup');
jest.unmock('pg');
jest.mock('../db', () => {
  const { mockQuery } = require('./setup');
  return { query: (...args) => mockQuery(...args), connect: async () => ({ query: (...args) => mockQuery(...args), release() {} }) };
});
const { Pool } = require('pg');
const { disposableDatabaseOptIn } = require('./helpers/statementTestDatabase');
const database = disposableDatabaseOptIn('AUDIT_INTEGRITY_TEST_DATABASE_URL');
const describeDb = database ? describe : describe.skip;
const { hardDeleteUser } = require('../jobs/scheduledDeletionJob');
const { markPayoutPaid } = require('../services/deliveryDriverPayoutService');
jest.setTimeout(60000);

describeDb('Sunday integrity against the full production migration history', () => {
  let pool, client, owner, customer, approver, restaurant, wallet, payoutId;
  beforeAll(async () => {
    pool = new Pool({ connectionString: database, ssl: false });
    client = await pool.connect();
    const migrations = fs.readdirSync(path.join(__dirname,'../migrations')).filter(f => f.endsWith('.sql'));
    const { rows } = await client.query("SELECT filename FROM _migrations WHERE status='applied'");
    const applied = new Set(rows.map(r => r.filename));
    if (migrations.some(name => !applied.has(name))) throw new Error('Apply the complete migration history before audit integrity tests');
    owner = crypto.randomUUID(); customer = crypto.randomUUID(); approver = crypto.randomUUID();
    for (const id of [owner,customer,approver]) await client.query("INSERT INTO users(id,email,password_hash,first_name,last_name) VALUES($1,$2,'synthetic-test-hash','Audit','Fixture')", [id,`${id}@example.invalid`]);
    const { rows: [business] } = await client.query("INSERT INTO businesses(user_id,business_name) VALUES($1,'Audit fixture') RETURNING id",[owner]);
    ({ rows: [restaurant] } = await client.query("INSERT INTO food_restaurants(business_id,owner_user_id,display_name,timezone) VALUES($1,$2,'Audit fixture','UTC') RETURNING id",[business.id,owner]));
    ({ rows: [wallet] } = await client.query("INSERT INTO food_customer_wallet_accounts(restaurant_id,customer_id,balance_cents) VALUES($1,$2,500) RETURNING id",[restaurant.id,customer]));
    await client.query("INSERT INTO food_customer_wallet_ledger(account_id,restaurant_id,customer_id,entry_type,amount_cents,balance_after_cents) VALUES($1,$2,$3,'credit',500,500)",[wallet.id,restaurant.id,customer]);
    const { rows: [job] } = await client.query(`INSERT INTO delivery_jobs(reference,customer_user_id,helper_user_id,origin_address,origin_lat,origin_lng,destination_address,destination_lat,destination_lng,distance_miles,package_type,price_snapshot,customer_total_cents,driver_payout_cents)
      VALUES($1,$2,$2,'Synthetic origin',0,0,'Synthetic destination',0,0,1,'small','{}',100,50) RETURNING id`, [`audit-${crypto.randomUUID().slice(0,20)}`,owner]);
    // Fixture carries a recorded approver (distinct from the mark-paid
    // caller): a null approver now fails closed with approver_unknown
    // (audit item 8), and this test's subject is concurrent transitions,
    // not the approver rule.
    const { rows: [payout] } = await client.query("INSERT INTO delivery_driver_payouts(delivery_job_id,driver_user_id,payout_cents,status,approved_by_user_id) VALUES($1,$2,50,'approved',$3) RETURNING id",[job.id,owner,approver]);
    payoutId = payout.id;
    mockQuery.mockImplementation((...args) => client.query(...args));
  });
  afterAll(async () => { if (client) client.release(); if (pool) await pool.end(); });

  test('food-wallet stored value blocks the real deletion path', async () => {
    await expect(hardDeleteUser({ id: customer }, { throwOnError: true })).rejects.toMatchObject({ code: 'account_financial_review' });
    expect((await client.query('SELECT balance_cents FROM food_customer_wallet_accounts WHERE id=$1',[wallet.id])).rows[0].balance_cents).toBe('500');
  });
  test('zero-balance wallet history survives anonymization without dangling financial identity', async () => {
    await client.query('UPDATE food_customer_wallet_accounts SET balance_cents=0 WHERE id=$1',[wallet.id]);
    await hardDeleteUser({ id: customer }, { throwOnError: true });
    const { rows } = await client.query('SELECT u.is_active,u.country,u.country_confirmed,w.id,l.id AS ledger_id FROM users u JOIN food_customer_wallet_accounts w ON w.customer_id=u.id JOIN food_customer_wallet_ledger l ON l.account_id=w.id WHERE u.id=$1',[customer]);
    expect(rows).toHaveLength(1);
    expect(rows[0].is_active).toBe(false);
    expect(rows[0]).toMatchObject({ country: 'ZZ', country_confirmed: false });
  });
  test('concurrent paid transitions cannot overwrite the winning reference', async () => {
    const a = await pool.connect(), b = await pool.connect();
    try {
      await a.query('BEGIN'); await b.query('BEGIN');
      await markPayoutPaid(a,payoutId,owner,'first-provider-reference');
      // b waits for a's row lock, then observes its committed paid state.
      const pending = markPayoutPaid(b,payoutId,owner,'second-provider-reference');
      const rejection = expect(pending).rejects.toMatchObject({ statusCode: 409 });
      await a.query('COMMIT');
      await rejection;
      await b.query('ROLLBACK');
      expect((await client.query('SELECT payment_reference FROM delivery_driver_payouts WHERE id=$1',[payoutId])).rows[0].payment_reference).toBe('first-provider-reference');
    } finally { await a.query('ROLLBACK'); await b.query('ROLLBACK'); a.release(); b.release(); }
  });
});
