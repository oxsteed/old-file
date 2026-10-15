'use strict';

// OxSteed Logistics Phase 3 — Credit rail integration.
//
// Real migrated PostgreSQL only (disposable credit_statement_test database).
// Covers: successful debit, insufficient funds (fail closed, no partial
// debit), disabled rail, frozen rail, frozen account, duplicate idempotency
// key (no duplicate debit), concurrent attempts (same key and different
// keys), reversal idempotency, the refunds-workstream adapter contract,
// participant-not-configured, launch flag, amount mismatch, and the
// availability probe the checkout UI uses to distinguish failure modes.

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');
const { disposableDatabaseOptIn } = require('./helpers/statementTestDatabase');

const database = disposableDatabaseOptIn('LOGISTICS_CREDIT_PAY_TEST_DATABASE_URL');
if (database) process.env.DATABASE_URL = database;

const describeDatabase = database ? describe : describe.skip;

const crypto = require('crypto');
const pool = require('../db');
const creditService = require('../services/oxsteedCreditService');
const adapter = require('../services/creditSpendAdapter');
const { VALID_PARTICIPANT_TYPES } = require('../services/creditParticipantService');
const logisticsCreditPay = require('../services/logisticsCreditPayService');
const { creditPort } = require('../services/logisticsRefundPorts');

jest.setTimeout(180000);

test('logistics credit pay DB tests require an explicit disposable database opt-in', () => {
  expect(database === '' || database.includes('/credit_statement_test')).toBe(true);
});

describeDatabase('logistics credit payments', () => {
  const tag = () => crypto.randomBytes(6).toString('hex');
  const created = { users: [], businesses: [], partners: [], attempts: [] };
  let railAdminId = null;

  // Persistent admin for rail freeze/unfreeze (requires admin actor).
  // Created once; the row is left in place (see afterEach note).
  beforeAll(async () => {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, is_active)
       VALUES ($1, $2, 'synthetic-unusable', 'Rail', 'Admin', 'admin', TRUE)
       ON CONFLICT (id) DO NOTHING`,
      [id, `logi-railadmin-${id}@example.invalid`]
    );
    railAdminId = id;
    try {
      await creditService.unfreezeCreditRail({ reason: 'test suite start', actorUserId: railAdminId });
    } catch { /* already unfrozen */ }
    await pool.query(`UPDATE feature_flags SET is_enabled = TRUE WHERE key = 'oxsteed_credit_enabled'`);
  });

  async function createUser(role, suffix) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, is_active)
       VALUES ($1, $2, 'synthetic-unusable', 'Logi', $3, $4, TRUE)`,
      [id, `logi-${suffix}-${id}@example.invalid`, suffix, role]
    );
    created.users.push(id);
    return id;
  }

  async function createBusiness(ownerId, suffix) {
    const { rows } = await pool.query(
      `INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id`,
      [ownerId, `OxSteed Logistics ${suffix}`]
    );
    created.businesses.push(rows[0].id);
    return rows[0].id;
  }

  // The admin-enrolled OxSteed collection entity: partner with
  // restaurant_id NULL (never a restaurant account) + logistics
  // participant + active agreement covering the logistics order type.
  // Control-plane inserts require an active admin creator (migration 488).
  async function createLogisticsParticipant(businessId, overrides = {}) {
    const adminId = await createUser('admin', `admin-${tag()}`);
    const { rows: [partner] } = await pool.query(
      `INSERT INTO oxsteed_credit_partners (restaurant_id, business_id, status, settlement_currency_code, created_by)
       VALUES (NULL, $1, 'active', 'USD', $2) RETURNING id`,
      [businessId, adminId]
    );
    created.partners.push(partner.id);
    await pool.query(
      `INSERT INTO oxsteed_credit_partner_agreements
         (partner_id, version, status, starts_at, allowed_order_types, allowed_categories, created_by, approved_by)
       VALUES ($1, 1, 'active', NOW() - INTERVAL '1 day', '{logistics}', '{}', $2, $2)`,
      [partner.id, adminId]
    );
    const { rows: [participant] } = await pool.query(
      `INSERT INTO credit_participants
         (partner_id, participant_type, business_id, status,
          didit_verified, didit_verified_at, allowed_surfaces)
       VALUES ($1, 'logistics', $2, $3, TRUE, NOW(), '{logistics}')
       RETURNING id`,
      [partner.id, businessId, overrides.status || 'active']
    );
    return { partnerId: partner.id, participantId: participant.id };
  }

  async function createPurchaseOrder(buyerId, suffix) {
    const laneCode = `L${tag()}`;
    const { rows: [lane] } = await pool.query(
      `INSERT INTO logistics_lanes (code, name, origin_country, destination_country)
       VALUES ($1, $2, 'US', 'US') RETURNING id`,
      [laneCode, `Lane ${suffix}`]
    );
    const { rows: [supplier] } = await pool.query(
      `INSERT INTO supplier_profiles (code, company_name, country)
       VALUES ($1, $2, 'US') RETURNING id`,
      [`S${tag()}`, `Supplier ${suffix}`]
    );
    const { rows: [po] } = await pool.query(
      `INSERT INTO purchase_orders
         (reference, supplier_id, lane_id, buyer_user_id, qty_ordered, unit_cost_usd)
       VALUES ($1, $2, $3, $4, 10, 1000.00) RETURNING id`,
      [`PO-${suffix}`, supplier.id, lane.id, buyerId]
    );
    return po.id;
  }

  async function createQuote({ subjectType, subjectId, buyerId, depositCents, finalCents }) {
    const subjectColumn = subjectType === 'purchase_order' ? 'purchase_order_id' : 'participant_id';
    const total = depositCents + finalCents;
    const { rows: [quote] } = await pool.query(
      `INSERT INTO logistics_buyer_quotes
         (reference, subject_type, ${subjectColumn}, version, status, currency,
          subtotal_cents, total_cents, deposit_cents, final_cents,
          accepted_by_user_id, accepted_at)
       VALUES ($1, $2, $3, 1, 'accepted', 'USD', $4, $4, $5, $6, $7, NOW())
       RETURNING id`,
      [`Q-${tag()}`, subjectType, subjectId, total, depositCents, finalCents, buyerId]
    );
    return quote.id;
  }

  async function fundBuyer(customerId, cents) {
    const adminId = await createUser('admin', `funder-${tag()}`);
    await creditService.adjustCustomerCredit({
      customerId,
      amountCents: cents,
      currencyCode: 'USD',
      direction: 'credit',
      idempotencyKey: `logi-fund-${tag()}`,
      actorType: 'admin',
      actorUserId: adminId,
      reason: 'test funding',
      referenceId: `test-fund-${tag()}`,
    });
  }

  async function walletBalanceCents(customerId) {
    const { rows } = await pool.query(
      `SELECT balance_cents FROM oxsteed_credit_accounts
        WHERE account_type = 'customer_wallet' AND customer_id = $1 AND currency_code = 'USD'`,
      [customerId]
    );
    return rows[0] ? Number(rows[0].balance_cents) : null;
  }

  async function setRailEnabled(enabled) {
    await pool.query(`UPDATE feature_flags SET is_enabled = $1 WHERE key = 'oxsteed_credit_enabled'`, [enabled]);
  }

  async function attemptCount() {
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM logistics_payment_attempts`);
    return rows[0].n;
  }

  async function purchaseCountForKey(key) {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM oxsteed_credit_transactions WHERE idempotency_key = $1`,
      [`logistics-credit-purchase:${key}`]
    );
    return rows[0].n;
  }

  // Standard happy-path fixture: buyer + funded wallet + participant + PO + quote.
  async function happyFixture({ fundedCents = 100000, depositCents = 30000, finalCents = 70000 } = {}) {
    const s = tag();
    const buyerId = await createUser('customer', `buyer-${s}`);
    const ownerId = await createUser('customer', `owner-${s}`);
    const businessId = await createBusiness(ownerId, s);
    await createLogisticsParticipant(businessId);
    const poId = await createPurchaseOrder(buyerId, s);
    const quoteId = await createQuote({ subjectType: 'purchase_order', subjectId: poId, buyerId, depositCents, finalCents });
    await fundBuyer(buyerId, fundedCents);
    return { buyerId, businessId, poId, quoteId, depositCents, finalCents, suffix: s };
  }

  beforeEach(async () => {
    process.env.LOGISTICS_CREDIT_PAY_ENABLED = '1';
    await setRailEnabled(true);
  });

  afterEach(async () => {
    delete process.env.LOGISTICS_CREDIT_PAY_ENABLED;
    await setRailEnabled(false);
    try {
      await creditService.unfreezeCreditRail({ reason: 'test cleanup', actorUserId: railAdminId });
    } catch { /* not frozen */ }
    await pool.query(`DELETE FROM logistics_payment_attempts`);
    await pool.query(`DELETE FROM logistics_refund_decisions`);
    await pool.query(`DELETE FROM logistics_refund_cases`);
    await pool.query(`DELETE FROM logistics_buyer_quotes`);
    await pool.query(`DELETE FROM purchase_orders`);
    await pool.query(`DELETE FROM pooled_order_participants`);
    await pool.query(`DELETE FROM pooled_orders`);
    await pool.query(`DELETE FROM supplier_profiles`);
    await pool.query(`DELETE FROM logistics_lanes`);
    // NOTE: agreements/partners/transactions are append-only or FK-locked;
    // revoke logistics participants instead of deleting so the
    // exactly-one-active-participant resolution stays deterministic.
    await pool.query(`UPDATE credit_participants SET status = 'revoked', updated_at = NOW() WHERE participant_type = 'logistics' AND status = 'active'`);
    // NOTE: oxsteed_credit_transactions / entries / accounts are append-only
    // (DB guard); fixture rows use unique keys/users per test, so they do
    // not interfere across tests. Total issuance stays far under the cap.
    // NOTE: businesses/users rows are intentionally left in place (uniquely
    // tagged per test, so no cross-test interference). Direct DELETEs on
    // those tables trip rule-rewritten deferred FK checks in this schema.
    created.users.length = 0;
    created.businesses.length = 0;
    created.partners.length = 0;
  });

  test('surface matrix maps logistics to debit and participant type exists', () => {
    expect(adapter.SURFACE_MODES.logistics).toBe('debit');
    expect(VALID_PARTICIPANT_TYPES).toContain('logistics');
  });

  test('successful credit debit settles the attempt and the subject', async () => {
    const f = await happyFixture();
    const key = `dep-${f.suffix}`;

    const result = await logisticsCreditPay.payLogisticsInstallmentWithCredit({
      buyerUserId: f.buyerId,
      subjectType: 'purchase_order',
      subjectId: f.poId,
      installment: 'deposit',
      quoteId: f.quoteId,
      amountCents: f.depositCents,
      idempotencyKey: key,
    });

    expect(result.status).toBe('succeeded');
    expect(result.method).toBe('credit');
    expect(result.currency).toBe('USD');
    expect(result.amountCents).toBe(f.depositCents);
    expect(result.settledAt).toBeTruthy();
    expect(result.replayed).toBe(false);
    expect(result.creditTransactionId).toBeTruthy();

    // Ledger: buyer debited exactly once, partner payable credited.
    expect(await walletBalanceCents(f.buyerId)).toBe(100000 - f.depositCents);
    expect(await purchaseCountForKey(key)).toBe(1);
    const { rows: [txn] } = await pool.query(
      `SELECT transaction_type, status, amount_cents, reference_type, reference_id
         FROM oxsteed_credit_transactions WHERE idempotency_key = $1`,
      [`logistics-credit-purchase:${key}`]
    );
    expect(txn.transaction_type).toBe('purchase');
    expect(txn.status).toBe('posted');
    expect(Number(txn.amount_cents)).toBe(f.depositCents);
    expect(txn.reference_type).toBe('logistics_payment_attempt');
    expect(txn.reference_id).toBe(String(result.attemptId));

    // Attempt + subject state.
    const { rows: [attempt] } = await pool.query(
      `SELECT * FROM logistics_payment_attempts WHERE id = $1`, [result.attemptId]
    );
    expect(attempt.status).toBe('succeeded');
    expect(attempt.settled_at).toBeTruthy();
    expect(attempt.idempotency_key).toBe(key);
    const { rows: [po] } = await pool.query(
      `SELECT deposit_paid_cents, deposit_paid_usd, deposit_paid_at FROM purchase_orders WHERE id = $1`, [f.poId]
    );
    expect(Number(po.deposit_paid_cents)).toBe(f.depositCents);
    expect(Number(po.deposit_paid_usd)).toBe(f.depositCents / 100);
    expect(po.deposit_paid_at).toBeTruthy();
  });

  test('insufficient funds fails closed with no partial debit and no attempt row', async () => {
    const f = await happyFixture({ fundedCents: 1000 });
    const before = await attemptCount();

    await expect(logisticsCreditPay.payLogisticsInstallmentWithCredit({
      buyerUserId: f.buyerId,
      subjectType: 'purchase_order',
      subjectId: f.poId,
      installment: 'deposit',
      quoteId: f.quoteId,
      amountCents: f.depositCents,
      idempotencyKey: `poor-${f.suffix}`,
    })).rejects.toMatchObject({ code: 'credit_insufficient_funds' });

    expect(await walletBalanceCents(f.buyerId)).toBe(1000);
    expect(await attemptCount()).toBe(before);
    expect(await purchaseCountForKey(`poor-${f.suffix}`)).toBe(0);
  });

  test('disabled rail fails closed with a distinct code', async () => {
    const f = await happyFixture();
    await setRailEnabled(false);
    const before = await attemptCount();

    await expect(logisticsCreditPay.payLogisticsInstallmentWithCredit({
      buyerUserId: f.buyerId,
      subjectType: 'purchase_order',
      subjectId: f.poId,
      installment: 'deposit',
      quoteId: f.quoteId,
      amountCents: f.depositCents,
      idempotencyKey: `railoff-${f.suffix}`,
    })).rejects.toMatchObject({ code: 'credit_rail_suspended', status: 503 });

    expect(await attemptCount()).toBe(before);
    expect(await walletBalanceCents(f.buyerId)).toBe(100000);
  });

  test('frozen rail fails closed with a distinct code', async () => {
    const f = await happyFixture();
    await creditService.freezeCreditRail({ reason: 'test freeze', actorUserId: railAdminId });

    await expect(logisticsCreditPay.payLogisticsInstallmentWithCredit({
      buyerUserId: f.buyerId,
      subjectType: 'purchase_order',
      subjectId: f.poId,
      installment: 'deposit',
      quoteId: f.quoteId,
      amountCents: f.depositCents,
      idempotencyKey: `frozen-${f.suffix}`,
    })).rejects.toMatchObject({ code: 'credit_rail_frozen', status: 503 });

    expect(await walletBalanceCents(f.buyerId)).toBe(100000);
  });

  test('suspended buyer wallet fails closed (frozen account)', async () => {
    const f = await happyFixture();
    await pool.query(
      `UPDATE oxsteed_credit_accounts SET status = 'suspended'
        WHERE account_type = 'customer_wallet' AND customer_id = $1`,
      [f.buyerId]
    );

    await expect(logisticsCreditPay.payLogisticsInstallmentWithCredit({
      buyerUserId: f.buyerId,
      subjectType: 'purchase_order',
      subjectId: f.poId,
      installment: 'deposit',
      quoteId: f.quoteId,
      amountCents: f.depositCents,
      idempotencyKey: `susp-${f.suffix}`,
    })).rejects.toMatchObject({ code: 'credit_account_inactive' });

    expect(await walletBalanceCents(f.buyerId)).toBe(100000);
  });

  test('duplicate idempotency key replays without a second debit', async () => {
    const f = await happyFixture();
    const key = `dupe-${f.suffix}`;
    const base = {
      buyerUserId: f.buyerId,
      subjectType: 'purchase_order',
      subjectId: f.poId,
      installment: 'deposit',
      quoteId: f.quoteId,
      amountCents: f.depositCents,
      idempotencyKey: key,
    };

    const first = await logisticsCreditPay.payLogisticsInstallmentWithCredit(base);
    const second = await logisticsCreditPay.payLogisticsInstallmentWithCredit(base);

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.attemptId).toBe(first.attemptId);
    expect(second.creditTransactionId).toBe(first.creditTransactionId);
    expect(second.status).toBe('succeeded');
    expect(await walletBalanceCents(f.buyerId)).toBe(100000 - f.depositCents);
    expect(await purchaseCountForKey(key)).toBe(1);
  });

  test('concurrent attempts with the same key converge on one debit', async () => {
    const f = await happyFixture();
    const key = `race-${f.suffix}`;
    const base = {
      buyerUserId: f.buyerId,
      subjectType: 'purchase_order',
      subjectId: f.poId,
      installment: 'deposit',
      quoteId: f.quoteId,
      amountCents: f.depositCents,
      idempotencyKey: key,
    };

    const [a, b] = await Promise.all([
      logisticsCreditPay.payLogisticsInstallmentWithCredit(base),
      logisticsCreditPay.payLogisticsInstallmentWithCredit(base),
    ]);

    const replayedCount = [a, b].filter((r) => r.replayed).length;
    expect(replayedCount).toBe(1);
    expect(a.attemptId).toBe(b.attemptId);
    expect(await walletBalanceCents(f.buyerId)).toBe(100000 - f.depositCents);
    expect(await purchaseCountForKey(key)).toBe(1);
  });

  test('concurrent attempts with different keys for one installment: second fails closed', async () => {
    const f = await happyFixture();
    const mk = (k) => ({
      buyerUserId: f.buyerId,
      subjectType: 'purchase_order',
      subjectId: f.poId,
      installment: 'deposit',
      quoteId: f.quoteId,
      amountCents: f.depositCents,
      idempotencyKey: k,
    });

    const results = await Promise.allSettled([
      logisticsCreditPay.payLogisticsInstallmentWithCredit(mk(`raceA-${f.suffix}`)),
      logisticsCreditPay.payLogisticsInstallmentWithCredit(mk(`raceB-${f.suffix}`)),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.code).toBe('logistics_installment_already_paid');
    expect(await walletBalanceCents(f.buyerId)).toBe(100000 - f.depositCents);
  });

  test('no logistics participant configured fails closed (not a 500)', async () => {
    const f = await happyFixture();
    await pool.query(`DELETE FROM credit_participants WHERE participant_type = 'logistics'`);

    await expect(logisticsCreditPay.payLogisticsInstallmentWithCredit({
      buyerUserId: f.buyerId,
      subjectType: 'purchase_order',
      subjectId: f.poId,
      installment: 'deposit',
      quoteId: f.quoteId,
      amountCents: f.depositCents,
      idempotencyKey: `nopart-${f.suffix}`,
    })).rejects.toMatchObject({ code: 'logistics_credit_participant_not_configured', status: 503 });

    expect(await walletBalanceCents(f.buyerId)).toBe(100000);
  });

  test('launch flag off fails closed before any rail check', async () => {
    delete process.env.LOGISTICS_CREDIT_PAY_ENABLED;
    const f = await happyFixture();

    await expect(logisticsCreditPay.payLogisticsInstallmentWithCredit({
      buyerUserId: f.buyerId,
      subjectType: 'purchase_order',
      subjectId: f.poId,
      installment: 'deposit',
      quoteId: f.quoteId,
      amountCents: f.depositCents,
      idempotencyKey: `flagoff-${f.suffix}`,
    })).rejects.toMatchObject({ code: 'logistics_credit_pay_disabled', status: 503 });

    expect(await walletBalanceCents(f.buyerId)).toBe(100000);
  });

  test('amount must equal the accepted quote installment amount', async () => {
    const f = await happyFixture();

    await expect(logisticsCreditPay.payLogisticsInstallmentWithCredit({
      buyerUserId: f.buyerId,
      subjectType: 'purchase_order',
      subjectId: f.poId,
      installment: 'deposit',
      quoteId: f.quoteId,
      amountCents: f.depositCents - 1,
      idempotencyKey: `amt-${f.suffix}`,
    })).rejects.toMatchObject({ code: 'logistics_credit_amount_mismatch' });

    expect(await walletBalanceCents(f.buyerId)).toBe(100000);
  });

  test('availability probe distinguishes failure modes for the checkout UI', async () => {
    const f = await happyFixture();

    expect(await logisticsCreditPay.getLogisticsCreditPayAvailability()).toMatchObject({
      available: true, code: 'ok',
    });

    delete process.env.LOGISTICS_CREDIT_PAY_ENABLED;
    expect(await logisticsCreditPay.getLogisticsCreditPayAvailability()).toMatchObject({
      available: false, code: 'logistics_credit_pay_disabled',
    });
    process.env.LOGISTICS_CREDIT_PAY_ENABLED = '1';

    await setRailEnabled(false);
    expect(await logisticsCreditPay.getLogisticsCreditPayAvailability()).toMatchObject({
      available: false, code: 'credit_rail_suspended',
    });
    await setRailEnabled(true);

    await creditService.freezeCreditRail({ reason: 'probe', actorUserId: railAdminId });
    expect(await logisticsCreditPay.getLogisticsCreditPayAvailability()).toMatchObject({
      available: false, code: 'credit_rail_frozen',
    });
    await creditService.unfreezeCreditRail({ reason: 'probe done', actorUserId: railAdminId });

    await pool.query(`DELETE FROM credit_participants WHERE participant_type = 'logistics'`);
    expect(await logisticsCreditPay.getLogisticsCreditPayAvailability()).toMatchObject({
      available: false, code: 'logistics_credit_participant_not_configured',
    });
  });

  async function createRefundCase({ attemptId, buyerId, amountCents }) {
    const { rows: [kase] } = await pool.query(
      `INSERT INTO logistics_refund_cases
         (reference, user_id, refund_reason, requested_amount_usd,
          refund_method, original_payment_attempt_id, amount_cents, status)
       VALUES ($1, $2, 'test refund', $3, 'credit', $4, $5, 'approved')
       RETURNING id`,
      [`RC-${tag()}`, buyerId, (amountCents / 100).toFixed(2), String(attemptId), amountCents]
    );
    return kase.id;
  }

  test('credit reversal is idempotent and returns funds via committed ledger reversal', async () => {
    const f = await happyFixture();
    const payResult = await logisticsCreditPay.payLogisticsInstallmentWithCredit({
      buyerUserId: f.buyerId,
      subjectType: 'purchase_order',
      subjectId: f.poId,
      installment: 'deposit',
      quoteId: f.quoteId,
      amountCents: f.depositCents,
      idempotencyKey: `rev-${f.suffix}`,
    });
    expect(await walletBalanceCents(f.buyerId)).toBe(100000 - f.depositCents);

    const caseId = await createRefundCase({ attemptId: payResult.attemptId, buyerId: f.buyerId, amountCents: f.depositCents });
    const refundKey = `refund-${f.suffix}`;
    const args = { refundCaseId: caseId, amountCents: f.depositCents, currency: 'USD', idempotencyKey: refundKey };

    const first = await logisticsCreditPay.reverseLogisticsCreditPayment(args);
    const second = await logisticsCreditPay.reverseLogisticsCreditPayment(args);

    expect(first.ledgerEntryId).toBeTruthy();
    expect(first.replayed).toBe(false);
    expect(second.ledgerEntryId).toBe(first.ledgerEntryId);
    expect(second.replayed).toBe(true);

    // Funds returned exactly once.
    expect(await walletBalanceCents(f.buyerId)).toBe(100000);
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM oxsteed_credit_transactions
        WHERE transaction_type = 'refund' AND idempotency_key = $1 AND status = 'posted'`,
      [refundKey]
    );
    expect(rows[0].n).toBe(1);
  });

  test('reversal adapter is registered for the refunds workstream contract', async () => {
    const f = await happyFixture();
    const payResult = await logisticsCreditPay.payLogisticsInstallmentWithCredit({
      buyerUserId: f.buyerId,
      subjectType: 'purchase_order',
      subjectId: f.poId,
      installment: 'deposit',
      quoteId: f.quoteId,
      amountCents: f.depositCents,
      idempotencyKey: `reg-${f.suffix}`,
    });
    const caseId = await createRefundCase({ attemptId: payResult.attemptId, buyerId: f.buyerId, amountCents: f.depositCents });

    // The exact call shape logisticsRefundService uses.
    const reversal = await creditPort.reverseCredit({
      refundCaseId: caseId,
      amountCents: f.depositCents,
      currency: 'USD',
      idempotencyKey: `reg-refund-${f.suffix}`,
    });

    expect(reversal.ledgerEntryId || reversal.id).toBeTruthy();
    expect(await walletBalanceCents(f.buyerId)).toBe(100000);
  });

  test('reversal rejects non-credit attempts and unknown cases', async () => {
    await expect(logisticsCreditPay.reverseLogisticsCreditPayment({
      refundCaseId: 999999, amountCents: 100, currency: 'USD', idempotencyKey: `nope-${tag()}`,
    })).rejects.toMatchObject({ code: 'refund_case_not_found' });

    const f = await happyFixture();
    const { rows: [attempt] } = await pool.query(
      `INSERT INTO logistics_payment_attempts
         (idempotency_key, buyer_user_id, subject_type, purchase_order_id,
          installment, amount_cents, currency, method, status)
       VALUES ($1, $2, 'purchase_order', $3, 'deposit', 100, 'USD', 'stripe', 'succeeded')
       RETURNING id`,
      [`stripe-${f.suffix}`, f.buyerId, f.poId]
    );
    const caseId = await createRefundCase({ attemptId: attempt.id, buyerId: f.buyerId, amountCents: 100 });
    await expect(logisticsCreditPay.reverseLogisticsCreditPayment({
      refundCaseId: caseId, amountCents: 100, currency: 'USD', idempotencyKey: `stripe-rev-${f.suffix}`,
    })).rejects.toMatchObject({ code: 'refund_method_mismatch' });
  });
});
