'use strict';

// Real PostgreSQL tests, synthetic records only. Deliberately refuse production
// databases, remote hosts and the normal OxSteed database name.
const assert = require('node:assert/strict');
const crypto = require('crypto');
const url = new URL(process.env.DATABASE_URL || 'postgres://invalid/invalid');
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/credit_card_security_test') {
  throw new Error('Requires a disposable localhost credit_card_security_test database');
}
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'synthetic-card-security-rehearsal-only';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.RESEND_API_KEY = ''; // never deliver to real addresses
process.env.LOG_LEVEL = 'error';
const pool = require('../db');
const security = require('../services/oxsteedCreditCardSecurity');
const cards = require('../services/oxsteedCreditCardService');
const recovery = require('../services/oxsteedCreditCardRecovery');

async function run() {
  const owner = crypto.randomUUID();
  await pool.query(`INSERT INTO users (id,email,password_hash,first_name,last_name,role,email_verified,is_active)
    VALUES ($1,$2,'synthetic-hash','Card','Fixture','customer',TRUE,TRUE)`, [owner, `${owner}@example.invalid`]);
  const account = (await pool.query(`INSERT INTO oxsteed_credit_accounts (account_type,customer_id)
    VALUES ('customer_wallet',$1) RETURNING id`, [owner])).rows[0].id;
  const frozen = (await pool.query(`INSERT INTO oxsteed_credit_cards (customer_id,account_id,card_type,status,freeze_origin)
    VALUES ($1,$2,'virtual','frozen','customer') RETURNING id`, [owner, account])).rows[0].id;
  const base = { customerId: owner, actorUserId: owner, sessionBinding: 'synthetic-session', stepupCode: '123456' };
  async function grant(cardId, action, payload = {}) {
    const args = { ...base, cardId, ...payload, idempotencyKey: crypto.randomUUID() };
    const user = (await pool.query('SELECT * FROM users WHERE id=$1', [owner])).rows[0];
    const result = await pool.query(`INSERT INTO oxsteed_credit_card_security_challenges
      (customer_id,card_id,action,binding_hash,code_hash,expires_at,delivered_at)
      VALUES ($1,$2,$3,$4,$5,NOW()+INTERVAL '10 minutes',NOW()) RETURNING id`,
    [owner, cardId, action, security.bindingHash(action,args,user), security.hash(['card-code','123456'])]);
    return { ...args, stepupChallengeId: result.rows[0].id };
  }
  const first = await grant(frozen, 'unfreeze');
  await assert.rejects(cards.unfreezeCard({ ...first, stepupCode: '654321' }), { code: 'credit_card_security_code_invalid' });
  assert.equal((await pool.query('SELECT attempts FROM oxsteed_credit_card_security_challenges WHERE id=$1', [first.stepupChallengeId])).rows[0].attempts, 1);
  assert.equal((await pool.query('SELECT failures FROM oxsteed_credit_card_security_limits WHERE customer_id=$1', [owner])).rows[0].failures, 1);
  const duplicate = await Promise.all([cards.unfreezeCard(first), cards.unfreezeCard(first)]);
  assert.equal(duplicate.filter(result => result.replayed).length, 1);
  assert.equal((await pool.query(`SELECT COUNT(*) FROM oxsteed_credit_audit_events WHERE resource_id=$1 AND action_type='credit.card.active'`, [frozen])).rows[0].count, '1');
  await assert.rejects(cards.unfreezeCard({ ...first, idempotencyKey: crypto.randomUUID() }), { code: 'credit_card_security_action_blocked' });
  // Replayed requests cannot resurrect the old state after an emergency block.
  await cards.freezeCard({ ...base, cardId: frozen });
  assert.equal((await cards.unfreezeCard(first)).card.status, 'frozen');

  await Promise.all([cards.reportCardLostOrStolen({ ...base, cardId: frozen }), cards.reportCardLostOrStolen({ ...base, cardId: frozen })]);
  assert.equal((await pool.query('SELECT COUNT(*) FROM oxsteed_credit_card_replacement_requests WHERE retired_card_id=$1', [frozen])).rows[0].count, '1');
  await assert.rejects(pool.query(`UPDATE oxsteed_credit_cards SET status='active' WHERE id=$1`, [frozen]), { code: '23514' });
  await recovery.markFound({ ...base, cardId: frozen });
  assert.equal((await pool.query('SELECT status FROM oxsteed_credit_cards WHERE id=$1', [frozen])).rows[0].status, 'lost');
  await Promise.all([recovery.processReplacementRequests(), recovery.processReplacementRequests()]);
  const replacements = (await pool.query('SELECT * FROM oxsteed_credit_cards WHERE replaces_card_id=$1', [frozen])).rows;
  assert.equal(replacements.length, 1); assert.equal(replacements[0].status, 'pending');
  assert.equal(replacements[0].credential_hash, null);
  const activate = await grant(replacements[0].id, 'activate');
  const activated = await Promise.all([cards.activatePhysicalCard(activate), cards.activatePhysicalCard(activate)]);
  assert.equal(activated.filter(result => result.card.credential).length, 1);
  assert.equal(activated.filter(result => result.replayed).length, 1);
  const pin = await grant(replacements[0].id, 'pin_set', { pin: '5678', resetPin: true });
  await cards.setCardPin(pin);
  await assert.rejects(cards.setCardPin({ ...pin, pin: '1234' }), { code: 'credit_idempotency_conflict' });

  // Rejected financial operations roll back, but PIN lockouts must not.
  const credential = activated.find(result => result.card.credential).card.credential;
  const wrongSpend = () => cards.redeemCardAtPartner({ credential, pin: '0000', partnerId: crypto.randomUUID(), amountCents: 100, idempotencyKey: crypto.randomUUID() });
  const rejected = await Promise.allSettled(Array.from({ length: 5 }, wrongSpend));
  assert.ok(rejected.every(result => result.status === 'rejected'));
  const lockedCard = (await pool.query('SELECT failed_pin_attempts,pin_locked_until FROM oxsteed_credit_cards WHERE id=$1', [replacements[0].id])).rows[0];
  assert.equal(lockedCard.failed_pin_attempts, 5);
  assert.ok(new Date(lockedCard.pin_locked_until) > new Date());
  await assert.rejects(cards.redeemCardAtPartner({ credential, pin: '5678', partnerId: crypto.randomUUID(), amountCents: 100, idempotencyKey: crypto.randomUUID() }), { code: 'credit_card_pin_locked' });
  assert.equal((await pool.query('SELECT COUNT(*) FROM oxsteed_credit_transactions WHERE debit_account_id=$1', [account])).rows[0].count, '0');
  await cards.setCardPin(await grant(replacements[0].id, 'pin_set', { pin: '5678', resetPin: true }));
  const wrongCashOut = () => cards.cashOutWithCard({ credential, pin: '0000', kioskDeviceId: crypto.randomUUID(), amountCents: 100, idempotencyKey: crypto.randomUUID() });
  await assert.rejects(wrongCashOut(), { code: 'credit_card_pin_incorrect' });
  assert.equal((await pool.query('SELECT failed_pin_attempts FROM oxsteed_credit_cards WHERE id=$1', [replacements[0].id])).rows[0].failed_pin_attempts, 1);
  await pool.query(`UPDATE oxsteed_credit_cards SET failed_pin_attempts=5,pin_locked_until=NOW()-INTERVAL '1 minute' WHERE id=$1`, [replacements[0].id]);
  await assert.rejects(wrongCashOut(), { code: 'credit_card_pin_incorrect' });
  assert.equal((await pool.query('SELECT failed_pin_attempts FROM oxsteed_credit_cards WHERE id=$1', [replacements[0].id])).rows[0].failed_pin_attempts, 1);

  const notices = (await pool.query('SELECT * FROM oxsteed_credit_notification_outbox WHERE user_id=$1 AND card_audit_event_id IS NOT NULL', [owner])).rows;
  assert.ok(notices.length >= 5);
  assert.equal(new Set(notices.map(row => row.card_audit_event_id)).size, notices.length);
  assert.ok(!JSON.stringify(notices).includes('synthetic-session'));
  const history = await recovery.listHistory({ cardId: frozen, customerId: owner });
  assert.ok(history.events.some(event => event.action === 'credit.card.found_after_report'));
  assert.ok(history.events.every(event => !('requestIp' in event) && !('metadata' in event)));
  await assert.rejects(recovery.listHistory({ cardId: frozen, customerId: crypto.randomUUID() }), { code: 'credit_card_not_found' });

  // Automatic replacement failure is durable and cannot undo retirement.
  const second = (await pool.query(`INSERT INTO oxsteed_credit_cards (customer_id,account_id,card_type,status)
    VALUES ($1,$2,'virtual','active') RETURNING id`, [owner, account])).rows[0].id;
  await cards.reportCardLostOrStolen({ ...base, cardId: second, status: 'stolen' });
  await pool.query(`UPDATE users SET is_active=FALSE WHERE id=$1`, [owner]);
  await recovery.processReplacementRequests();
  const failed = (await pool.query('SELECT * FROM oxsteed_credit_card_replacement_requests WHERE retired_card_id=$1', [second])).rows[0];
  assert.equal(failed.status, 'failed');
  assert.equal((await pool.query('SELECT status FROM oxsteed_credit_cards WHERE id=$1', [second])).rows[0].status, 'stolen');
  await assert.rejects(cards.unfreezeCard(await grant(frozen,'unfreeze')), { code: 'credit_card_security_actor_invalid' });
  await pool.query(`UPDATE oxsteed_credit_accounts SET status='suspended' WHERE id=$1`, [account]);
  assert.equal((await pool.query('SELECT status FROM oxsteed_credit_cards WHERE id=$1', [replacements[0].id])).rows[0].status, 'revoked');
  assert.equal((await pool.query('SELECT status FROM oxsteed_credit_cards WHERE id=$1', [second])).rows[0].status, 'stolen');
  const propagation = (await pool.query(`SELECT id FROM oxsteed_credit_audit_events
    WHERE resource_id=$1 AND action_type='credit.card.account_status_propagated' AND customer_id=$2`, [replacements[0].id,owner])).rows;
  assert.equal(propagation.length, 1);
  console.log('Card security PostgreSQL rehearsal passed: durable attempts and kiosk PIN lockouts, concurrent replay, retirement guard, replacement isolation, activation, PIN binding, outbox and privacy.');
}
run().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => pool.end());
