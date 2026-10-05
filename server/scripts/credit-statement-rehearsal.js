'use strict';

// Deliberately synthetic, local-only, and rerunnable. This does NOT apply
// migrations, alter existing fixtures, call payments/email, or touch production.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
let url;
try { url = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid'); }
catch { throw new Error('Requires a disposable localhost credit_statement_test database'); }
if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost'].includes(url.hostname)
    || url.pathname !== '/credit_statement_test'
    || [...url.searchParams].some(([key, value]) => key !== 'sslmode' || value !== 'disable')) {
  throw new Error('Requires a disposable localhost credit_statement_test database; connection overrides are forbidden');
}
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.RESEND_API_KEY = '';
const pool = require('../db');
const statements = require('../services/creditStatementService');
const runId = crypto.randomUUID();

function monthPeriod(now, offset) {
  return {
    from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1)).toISOString().slice(0, 10),
    to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 0)).toISOString().slice(0, 10),
  };
}
async function user(role = 'customer') {
  const id = crypto.randomUUID();
  await pool.query(`INSERT INTO users (id,email,password_hash,first_name,last_name,role,email_verified,is_active)
    VALUES ($1,$2,'synthetic-unusable-hash','Statement','Fixture',$3,TRUE,TRUE)`, [id, `${id}@example.invalid`, role]);
  return id;
}
async function account(type, { customerId = null, partnerId = null, currency = 'USD', createdAt }) {
  return (await pool.query(`INSERT INTO oxsteed_credit_accounts (account_type,customer_id,partner_id,currency_code,created_at)
    VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id`, [type, customerId, partnerId, currency, createdAt])).rows[0]?.id
    || (await pool.query('SELECT id FROM oxsteed_credit_accounts WHERE account_type=$1 AND currency_code=$2', [type, currency])).rows[0].id;
}
async function wallet(customerId, restaurantId, currency, createdAt) {
  return (await pool.query(`INSERT INTO food_customer_wallet_accounts (customer_id,restaurant_id,currency_code,created_at)
    VALUES ($1,$2,$3,$4) RETURNING id`, [customerId, restaurantId, currency, createdAt])).rows[0].id;
}
async function restaurant(ownerId, currency = 'USD') {
  const businessId = (await pool.query(`INSERT INTO businesses (user_id,business_name)
    VALUES ($1,$2) RETURNING id`, [ownerId, `Synthetic statements ${runId}`])).rows[0].id;
  return (await pool.query(`INSERT INTO food_restaurants (business_id,owner_user_id,display_name,status,currency_code)
    VALUES ($1,$2,'Synthetic Statement Restaurant','active',$3) RETURNING id`, [businessId, ownerId, currency])).rows[0].id;
}
async function oxMovement({ debit, credit, amount, type, currency = 'USD', date, actorId, actorType = 'admin',
  partnerId = null, agreementId = null, purchaseId = null, corruptCredit = false }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const balances = (await client.query('SELECT * FROM oxsteed_credit_accounts WHERE id=ANY($1::bigint[]) ORDER BY id FOR UPDATE', [[debit, credit]])).rows;
    const debitAccount = balances.find(value => String(value.id) === String(debit));
    const creditAccount = balances.find(value => String(value.id) === String(credit));
    const id = crypto.randomUUID();
    await client.query(`INSERT INTO oxsteed_credit_transactions
      (id,transaction_type,status,debit_account_id,credit_account_id,amount_cents,currency_code,
       idempotency_key,reference_type,reference_id,description,reason,actor_type,actor_user_id,
       partner_id,agreement_id,posted_at,created_at)
      VALUES ($1,$2,'posted',$3,$4,$5,$6,$7,$8,$9,'Synthetic statement rehearsal',
       'Local synthetic fixture only',$10,$11,$12,$13,$14,$14)`,
    [id, type, debit, credit, amount, currency, `${runId}:${id}`, purchaseId ? 'oxsteed_credit_purchase' : 'statement_rehearsal',
      purchaseId || id, actorType, actorId, partnerId, agreementId, date]);
    await client.query("SELECT set_config('oxsteed.credit_ledger_transaction_id',$1,TRUE)", [id]);
    for (const [source, side, sign] of [[debitAccount, 'debit', -1n], [creditAccount, 'credit', 1n]]) {
      const balance = BigInt(source.balance_cents) + sign * BigInt(amount);
      const sequence = BigInt(source.ledger_version) + 1n;
      const entryHash = crypto.createHash('sha256').update(`${runId}:${id}:${source.id}`).digest('hex');
      await client.query(`INSERT INTO oxsteed_credit_transaction_entries
        (transaction_id,account_id,entry_side,amount_cents,balance_after_cents,sequence,previous_entry_hash,entry_hash,created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, source.id, side, amount, String(balance + (corruptCredit && side === 'credit' ? 1n : 0n)),
        String(sequence), source.last_entry_hash, entryHash, date]);
      await client.query(`UPDATE oxsteed_credit_accounts SET balance_cents=$2,ledger_version=$3,last_entry_hash=$4,last_posted_at=$5
        WHERE id=$1`, [source.id, String(balance), String(sequence), entryHash, date]);
    }
    await client.query('COMMIT');
    return id;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
async function restaurantMovement({ accountId, customerId, restaurantId, amount, type, date, currency = 'USD', corrupt = false }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = (await client.query('SELECT * FROM food_customer_wallet_accounts WHERE id=$1 FOR UPDATE', [accountId])).rows[0];
    const balance = BigInt(current.balance_cents) + (type === 'debit' ? -1n : 1n) * BigInt(amount);
    const sequence = BigInt(current.ledger_version) + 1n;
    const hash = crypto.createHash('sha256').update(`${runId}:${accountId}:${sequence}`).digest('hex');
    await client.query(`INSERT INTO food_customer_wallet_ledger
      (account_id,restaurant_id,customer_id,entry_type,amount_cents,balance_after_cents,currency_code,
       description,idempotency_key,entry_sequence,previous_entry_hash,entry_hash,created_at,posted_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'Synthetic statement rehearsal',$8,$9,$10,$11,$12,$12)`,
    [accountId, restaurantId, customerId, type, amount, String(balance + (corrupt ? 1n : 0n)), currency,
      `${runId}:${accountId}:${sequence}`, String(sequence), current.last_entry_hash, hash, date]);
    await client.query(`UPDATE food_customer_wallet_accounts SET balance_cents=$2,ledger_version=$3,last_entry_hash=$4,last_posted_at=$5
      WHERE id=$1`, [accountId, String(balance), String(sequence), hash, date]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function run() {
  assert.equal((await pool.query('SELECT current_database() AS name')).rows[0].name, 'credit_statement_test');
  const applied = await pool.query(`SELECT 1 FROM _migrations WHERE filename='682_credit_statement_documents.sql' AND status='applied'`);
  assert.equal(applied.rows.length, 1, 'Apply the complete migration chain through 682 before rehearsal');
  const now = new Date((await pool.query('SELECT transaction_timestamp() AS now')).rows[0].now);
  const period = monthPeriod(now, -2);
  const emptyMonth = monthPeriod(now, -1);
  const before = `${monthPeriod(now, -3).from}T00:00:00.000Z`;
  const tiedDate = `${period.from}T12:00:00.000Z`;
  const owner = await user(); const stranger = await user(); const admin = await user('super_admin');
  const restaurantId = await restaurant(admin);
  const otherRestaurant = await restaurant(admin, 'EUR');
  const partnerId = (await pool.query(`INSERT INTO oxsteed_credit_partners (restaurant_id,status,created_by)
    VALUES ($1,'active',$2) RETURNING id`, [restaurantId, admin])).rows[0].id;
  const agreementId = (await pool.query(`INSERT INTO oxsteed_credit_partner_agreements (partner_id,version,status,starts_at,created_by,approved_by)
    VALUES ($1,1,'active',$2,$3,$3) RETURNING id`, [partnerId, before, admin])).rows[0].id;
  const usd = await account('customer_wallet', { customerId: owner, createdAt: before });
  const jpy = await account('customer_wallet', { customerId: owner, currency: 'JPY', createdAt: before });
  const treasury = await account('platform_treasury', { createdAt: before });
  const jpyTreasury = await account('platform_treasury', { currency: 'JPY', createdAt: before });
  const payable = await account('partner_payable', { partnerId, createdAt: before });
  const revenue = await account('platform_revenue', { createdAt: before });
  await oxMovement({ debit: treasury, credit: usd, amount: 6000, type: 'load', date: before, actorId: admin });
  await oxMovement({ debit: treasury, credit: usd, amount: 2000, type: 'load', date: tiedDate, actorId: admin });
  const purchaseId = await oxMovement({ debit: usd, credit: payable, amount: 1000, type: 'purchase', date: tiedDate,
    actorId: owner, actorType: 'customer', partnerId, agreementId });
  await oxMovement({ debit: payable, credit: usd, amount: 250, type: 'refund', date: tiedDate,
    actorId: admin, partnerId, agreementId, purchaseId });
  await oxMovement({ debit: usd, credit: revenue, amount: 50, type: 'transfer_fee', date: tiedDate, actorId: owner, actorType: 'customer' });
  await oxMovement({ debit: jpyTreasury, credit: jpy, amount: 12345, type: 'load', currency: 'JPY', date: tiedDate, actorId: admin });
  const restaurantWallet = await wallet(owner, restaurantId, 'USD', before);
  const eurWallet = await wallet(owner, otherRestaurant, 'EUR', before);
  for (const movement of [
    { amount: 6000, type: 'credit', date: before }, { amount: 2000, type: 'credit', date: tiedDate },
    { amount: 1000, type: 'debit', date: tiedDate }, { amount: 250, type: 'refund', date: tiedDate },
    { amount: 100, type: 'adjustment', date: tiedDate },
  ]) await restaurantMovement({ accountId: restaurantWallet, customerId: owner, restaurantId, ...movement });
  await restaurantMovement({ accountId: eurWallet, customerId: owner, restaurantId: otherRestaurant,
    amount: 9999, type: 'credit', currency: 'EUR', date: tiedDate });

  // Real concurrent insert collisions exercise unique/serialization retry paths.
  const ox = await Promise.all(Array.from({ length: 6 }, () => statements.getStatement(owner, period)));
  const food = await Promise.all(Array.from({ length: 6 }, () => statements.getStatement(owner,
    { ...period, product: 'restaurant', restaurantId })));
  for (const reports of [ox, food]) {
    assert.equal(new Set(reports.map(report => report.id)).size, 1);
    assert.equal(new Set(reports.map(report => report.contentHash)).size, 1);
    assert.equal(reports[0].contentHash, statements.hashDocument(reports[0]));
    assert.equal(reports[0].openingBalanceCents, 6000);
    assert.equal(reports[0].holds.length, 0);
  }
  assert.equal(ox[0].closingBalanceCents, 7200);
  assert.equal(ox[0].totalCreditsCents, 2250); assert.equal(ox[0].totalDebitsCents, 1050);
  assert.equal(ox[0].transactionCount, 4);
  assert.equal(food[0].closingBalanceCents, 7350);
  assert.equal(food[0].totalCreditsCents, 2350); assert.equal(food[0].totalDebitsCents, 1000);
  assert.equal(food[0].transactionCount, 4);
  assert.ok(ox[0].transactions.some(entry => entry.type === 'refund' && entry.creditCents === 250));
  assert.ok(ox[0].transactions.some(entry => entry.type === 'transfer_fee' && entry.debitCents === 50));
  assert.equal((await pool.query('SELECT COUNT(*) AS count FROM credit_statement_documents WHERE customer_id=$1', [owner])).rows[0].count, '2');

  const emptyOx = await statements.getStatement(owner, emptyMonth);
  const emptyFood = await statements.getStatement(owner, { ...emptyMonth, product: 'restaurant', restaurantId });
  assert.equal(emptyOx.transactionCount, 0); assert.equal(emptyFood.transactionCount, 0);
  assert.equal(emptyOx.openingBalanceCents, 7200); assert.equal(emptyOx.closingBalanceCents, 7200);
  assert.equal(emptyFood.openingBalanceCents, 7350); assert.equal(emptyFood.closingBalanceCents, 7350);
  assert.equal((await statements.getStatement(owner, { ...period, currencyCode: 'JPY' })).closingBalanceCents, 12345);
  const euro = await statements.getStatement(owner, { ...period, product: 'restaurant', restaurantId: otherRestaurant, currencyCode: 'EUR' });
  assert.equal(euro.closingBalanceCents, 9999); assert.equal(euro.currencyCode, 'EUR');
  await assert.rejects(statements.getStatement(owner, { ...period, currencyCode: 'EUR' }), { code: 'statement_account_not_found' });
  await assert.rejects(statements.getStatement(owner, { ...period, product: 'restaurant', restaurantId, currencyCode: 'EUR' }), { code: 'statement_account_not_found' });
  await assert.rejects(statements.getStatement(stranger, period), { code: 'statement_account_not_found' });
  await assert.rejects(statements.getStatement(stranger, { ...period, product: 'restaurant', restaurantId }), { code: 'statement_account_not_found' });
  await assert.rejects(pool.query('UPDATE credit_statement_documents SET content_hash=$2 WHERE id=$1', [ox[0].id, 'a'.repeat(64)]), { code: '55000' });
  await assert.rejects(pool.query('DELETE FROM credit_statement_documents WHERE id=$1', [food[0].id]), { code: '55000' });

  const holdClient = await pool.connect();
  try {
    await holdClient.query('BEGIN');
    for (const [status, amount, expires] of [['active', 300, '1 day'], ['released', 400, '1 day'], ['active', 500, '-1 day']]) {
      await holdClient.query(`INSERT INTO oxsteed_credit_holds
        (account_id,customer_id,partner_id,agreement_id,amount_cents,currency_code,status,idempotency_key,expires_at,
         created_by,released_at,release_actor_type,released_by,release_reason)
        VALUES ($1,$2,$3,$4,$5,'USD',$6::text,$7,NOW()+$8::interval,$2,
          CASE WHEN $6::text='released' THEN NOW() ELSE NULL END,
          CASE WHEN $6::text='released' THEN 'customer' ELSE NULL END,
          CASE WHEN $6::text='released' THEN $2::uuid ELSE NULL END,
          CASE WHEN $6::text='released' THEN 'Synthetic fixture release' ELSE NULL END)`,
      [usd, owner, partnerId, agreementId, amount, status, crypto.randomUUID(), expires]);
      await holdClient.query(`INSERT INTO food_customer_wallet_holds (account_id,customer_id,restaurant_id,amount_cents,currency_code,status,idempotency_key,expires_at)
        VALUES ($1,$2,$3,$4,'USD',$5,$6,NOW()+$7::interval)`, [restaurantWallet, owner, restaurantId, amount, status, crypto.randomUUID(), expires]);
    }
    await holdClient.query(`UPDATE oxsteed_credit_accounts SET reserved_cents=(SELECT SUM(amount_cents) FROM oxsteed_credit_holds
      WHERE account_id=$1 AND status='active') WHERE id=$1`, [usd]);
    await holdClient.query('COMMIT');
  } catch (error) { await holdClient.query('ROLLBACK'); throw error; }
  finally { holdClient.release(); }
  const interimPeriod = { from: monthPeriod(now, 0).from, to: now.toISOString().slice(0, 10) };
  for (const options of [interimPeriod, { ...interimPeriod, product: 'restaurant', restaurantId }]) {
    const report = await statements.getStatement(owner, options);
    assert.equal(report.kind, 'interim'); assert.equal(report.totalHeldCents, 300);
    assert.equal(report.holds.length, 1); assert.ok(report.holdsAsOf);
    assert.equal(report.transactionCount, 0);
  }
  await pool.query('UPDATE users SET first_name=$2 WHERE id=$1', [owner, 'Changed name']);
  const replay = await statements.getStatement(owner, period);
  assert.deepEqual(replay, ox[0]);
  assert.deepEqual(await statements.getStatement(owner, { ...period, product: 'restaurant', restaurantId }), food[0]);

  // Corrupt balance evidence must reject the entire document and leave no archive.
  const brokenOwner = await user();
  const brokenOx = await account('customer_wallet', { customerId: brokenOwner, createdAt: before });
  const brokenFood = await wallet(brokenOwner, restaurantId, 'USD', before);
  await oxMovement({ debit: treasury, credit: brokenOx, amount: 500, type: 'load', date: tiedDate, actorId: admin, corruptCredit: true });
  await restaurantMovement({ accountId: brokenFood, customerId: brokenOwner, restaurantId, amount: 500, type: 'credit', date: tiedDate, corrupt: true });
  for (const options of [period, { ...period, product: 'restaurant', restaurantId }]) {
    await assert.rejects(statements.getStatement(brokenOwner, options), { code: 'statement_integrity_failed' });
  }
  assert.equal((await pool.query('SELECT COUNT(*) AS count FROM credit_statement_documents WHERE customer_id=$1', [brokenOwner])).rows[0].count, '0');
  // A failed transaction has been rolled back, and the pooled session is usable.
  assert.equal((await statements.getStatement(owner, period)).contentHash, ox[0].contentHash);
  console.log('Credit statement PostgreSQL rehearsal passed: both products, exact refunds/fees, same-time ordering, currencies, ownership, zero-activity carryover, concurrent identical issuance, immutable stable hashes, current-only holds, reconciliation failure rollback.');
  console.log('Only synthetic fixtures remain in disposable credit_statement_test; no financial/provider/email services were invoked.');
}

run().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => pool.end());
