'use strict';

// OxSteed Logistics Phase 3 — release-blocker regression tests.
//
// Real migrated PostgreSQL only (disposable credit_statement_test database).
// Covers the three Credit integration fixes:
//   1. createPaymentAttempt with method='credit' actually executes the debit
//      (no more pending_execution dead end), failing closed with distinct
//      codes when the rail/participant is unavailable.
//   2. The Credit reversal adapter is registered when the module production
//      actually loads (logisticsRefundService) is required.
//   3. reverseLogisticsCreditPayment accepts the refund executor's
//      transaction client: no nested transaction, no re-lock of the
//      refund-case row, exactly one ledger reversal, no deadlock.

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');
const { disposableDatabaseOptIn } = require('./helpers/statementTestDatabase');

const database = disposableDatabaseOptIn('LOGISTICS_CREDIT_PAY_TEST_DATABASE_URL');
if (database) process.env.DATABASE_URL = database;

const describeDatabase = database ? describe : describe.skip;

const crypto = require('crypto');
const pool = require('../db');
const { withTransaction } = require('../utils/transaction');
const creditService = require('../services/oxsteedCreditService');
const payments = require('../services/logisticsPaymentService');
const logisticsCreditPay = require('../services/logisticsCreditPayService');

jest.setTimeout(180000);

test('logistics credit checkout-fix DB tests require an explicit disposable database opt-in', () => {
  expect(database === '' || database.includes('/credit_statement_test')).toBe(true);
});

describeDatabase('logistics credit release blockers', () => {
  const tag = () => crypto.randomBytes(6).toString('hex');
  let railAdminId = null;

  beforeAll(async () => {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, is_active)
       VALUES ($1, $2, 'synthetic-unusable', 'Rail', 'Admin', 'admin', TRUE)
       ON CONFLICT (id) DO NOTHING`,
      [id, `logi-fix-railadmin-${id}@example.invalid`]
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
      [id, `logi-fix-${suffix}-${id}@example.invalid`, suffix, role]
    );
    return id;
  }

  async function createBusiness(ownerId, suffix) {
    const { rows } = await pool.query(
      `INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id`,
      [ownerId, `OxSteed Logistics Fix ${suffix}`]
    );
    return rows[0].id;
  }

  async function createLogisticsParticipant(businessId) {
    const adminId = await createUser('admin', `admin-${tag()}`);
    const { rows: [partner] } = await pool.query(
      `INSERT INTO oxsteed_credit_partners (restaurant_id, business_id, status, settlement_currency_code, created_by)
       VALUES (NULL, $1, 'active', 'USD', $2) RETURNING id`,
      [businessId, adminId]
    );
    await pool.query(
      `INSERT INTO oxsteed_credit_partner_agreements
         (partner_id, version, status, starts_at, allowed_order_types, allowed_categories, created_by, approved_by)
       VALUES ($1, 1, 'active', NOW() - INTERVAL '1 day', '{logistics}', '{}', $2, $2)`,
      [partner.id, adminId]
    );
    await pool.query(
      `INSERT INTO credit_participants
         (partner_id, participant_type, business_id, status,
          didit_verified, didit_verified_at, allowed_surfaces)
       VALUES ($1, 'logistics', $2, 'active', TRUE, NOW(), '{logistics}')`,
      [partner.id, businessId]
    );
  }

  async function createPurchaseOrder(buyerId, suffix) {
    const { rows: [lane] } = await pool.query(
      `INSERT INTO logistics_lanes (code, name, origin_country, destination_country)
       VALUES ($1, $2, 'US', 'US') RETURNING id`,
      [`LX${tag()}`, `Lane ${suffix}`]
    );
    const { rows: [supplier] } = await pool.query(
      `INSERT INTO supplier_profiles (code, company_name, country)
       VALUES ($1, $2, 'US') RETURNING id`,
      [`SX${tag()}`, `Supplier ${suffix}`]
    );
    const { rows: [po] } = await pool.query(
      `INSERT INTO purchase_orders
         (reference, supplier_id, lane_id, buyer_user_id, qty_ordered, unit_cost_usd)
       VALUES ($1, $2, $3, $4, 10, 1000.00) RETURNING id`,
      [`POX-${suffix}`, supplier.id, lane.id, buyerId]
    );
    return po.id;
  }

  async function createQuote({ subjectId, buyerId, depositCents, finalCents }) {
    const total = depositCents + finalCents;
    const { rows: [quote] } = await pool.query(
      `INSERT INTO logistics_buyer_quotes
         (reference, subject_type, purchase_order_id, version, status, currency,
          subtotal_cents, total_cents, deposit_cents, final_cents,
          accepted_by_user_id, accepted_at)
       VALUES ($1, 'purchase_order', $2, 1, 'accepted', 'USD', $3, $3, $4, $5, $6, NOW())
       RETURNING id`,
      [`QX-${tag()}`, subjectId, total, depositCents, finalCents, buyerId]
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
      idempotencyKey: `logi-fix-fund-${tag()}`,
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

  async function happyFixture({ fundedCents = 100000, depositCents = 30000, finalCents = 70000 } = {}) {
    const s = tag();
    const buyerId = await createUser('customer', `buyer-${s}`);
    const ownerId = await createUser('customer', `owner-${s}`);
    const businessId = await createBusiness(ownerId, s);
    await createLogisticsParticipant(businessId);
    const poId = await createPurchaseOrder(buyerId, s);
    const quoteId = await createQuote({ subjectId: poId, buyerId, depositCents, finalCents });
    await fundBuyer(buyerId, fundedCents);
    return { buyerId, businessId, poId, quoteId, depositCents, finalCents, suffix: s };
  }

  async function createRefundCase({ attemptId, buyerId, amountCents }) {
    const { rows: [kase] } = await pool.query(
      `INSERT INTO logistics_refund_cases
         (reference, user_id, refund_reason, requested_amount_usd,
          refund_method, original_payment_attempt_id, amount_cents, status)
       VALUES ($1, $2, 'test refund', $3, 'credit', $4, $5, 'approved')
       RETURNING id`,
      [`RCX-${tag()}`, buyerId, (amountCents / 100).toFixed(2), String(attemptId), amountCents]
    );
    return kase.id;
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
    await pool.query(`UPDATE credit_participants SET status = 'revoked', updated_at = NOW() WHERE participant_type = 'logistics' AND status = 'active'`);
  });

  // ── Fix 1: credit checkout executes the debit ───────────────

  test('credit-method checkout debits the buyer wallet and settles the attempt', async () => {
    const f = await happyFixture();
    const key = crypto.randomUUID();

    const result = await payments.createPaymentAttempt(f.buyerId, {
      idempotencyKey: key,
      subjectType: 'purchase_order',
      purchaseOrderId: f.poId,
      installment: 'deposit',
      method: 'credit',
    });

    expect(result.idempotentReplay).toBe(false);
    expect(result.clientSecret).toBeNull();
    expect(result.attempt.status).toBe('succeeded');
    expect(result.attempt.method).toBe('credit');
    expect(Number(result.attempt.amount_cents)).toBe(f.depositCents);
    expect(result.attempt.settled_at).toBeTruthy();

    expect(result.credit.status).toBe('succeeded');
    expect(result.credit.settledAt).toBeTruthy();
    expect(result.credit.amountCents).toBe(f.depositCents);
    expect(result.credit.currency).toBe('USD');
    expect(result.credit.creditTransactionId).toBeTruthy();
    expect(result.credit.replayed).toBe(false);

    // Money actually moved: exactly one ledger debit, no pending limbo.
    expect(await walletBalanceCents(f.buyerId)).toBe(100000 - f.depositCents);
    expect(await purchaseCountForKey(key)).toBe(1);
    const { rows: [po] } = await pool.query(
      `SELECT deposit_paid_cents FROM purchase_orders WHERE id = $1`, [f.poId]
    );
    expect(Number(po.deposit_paid_cents)).toBe(f.depositCents);
  });

  test('credit checkout fails closed with a distinct code when the rail is suspended', async () => {
    const f = await happyFixture();
    await setRailEnabled(false);
    const before = await attemptCount();

    await expect(payments.createPaymentAttempt(f.buyerId, {
      idempotencyKey: crypto.randomUUID(),
      subjectType: 'purchase_order',
      purchaseOrderId: f.poId,
      installment: 'deposit',
      method: 'credit',
    })).rejects.toMatchObject({ code: 'credit_rail_suspended', status: 503 });

    // Fail closed: no attempt row left behind, no money moved.
    expect(await attemptCount()).toBe(before);
    expect(await walletBalanceCents(f.buyerId)).toBe(100000);
  });

  test('credit checkout fails closed when no logistics participant is configured', async () => {
    const f = await happyFixture();
    await pool.query(`DELETE FROM credit_participants WHERE participant_type = 'logistics'`);
    const before = await attemptCount();

    await expect(payments.createPaymentAttempt(f.buyerId, {
      idempotencyKey: crypto.randomUUID(),
      subjectType: 'purchase_order',
      purchaseOrderId: f.poId,
      installment: 'deposit',
      method: 'credit',
    })).rejects.toMatchObject({ code: 'logistics_credit_participant_not_configured', status: 503 });

    expect(await attemptCount()).toBe(before);
    expect(await walletBalanceCents(f.buyerId)).toBe(100000);
  });

  // ── Fix 3: reversal inside the executor's transaction ───────

  test('reversal on the executor transaction client does not deadlock and posts exactly one reversal', async () => {
    const f = await happyFixture();
    const payResult = await logisticsCreditPay.payLogisticsInstallmentWithCredit({
      buyerUserId: f.buyerId,
      subjectType: 'purchase_order',
      subjectId: f.poId,
      installment: 'deposit',
      quoteId: f.quoteId,
      amountCents: f.depositCents,
      idempotencyKey: `fixrev-${f.suffix}`,
    });
    const caseId = await createRefundCase({ attemptId: payResult.attemptId, buyerId: f.buyerId, amountCents: f.depositCents });
    const refundKey = `fixrefund-${f.suffix}`;

    const deadlockGuard = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('deadlock-timeout: reversal blocked on the refund-case row lock')), 15000).unref();
    });

    // Simulate the refund executor: it holds the case row lock in its own
    // transaction and passes its client. The old nested-transaction code
    // would block forever re-locking that row.
    const reversal = await withTransaction(pool, (client) => Promise.race([
      (async () => {
        await client.query(`SELECT * FROM logistics_refund_cases WHERE id = $1 FOR UPDATE`, [caseId]);
        return logisticsCreditPay.reverseLogisticsCreditPayment(
          { refundCaseId: caseId, amountCents: f.depositCents, currency: 'USD', idempotencyKey: refundKey },
          { client }
        );
      })(),
      deadlockGuard,
    ]), 'logistics_credit_refund_test');

    expect(reversal.ledgerEntryId).toBeTruthy();
    expect(reversal.replayed).toBe(false);

    // Funds returned exactly once after the outer transaction commits.
    expect(await walletBalanceCents(f.buyerId)).toBe(100000);
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM oxsteed_credit_transactions
        WHERE transaction_type = 'refund' AND idempotency_key = $1 AND status = 'posted'`,
      [refundKey]
    );
    expect(rows[0].n).toBe(1);
  });

  test('reversal accepts the client inline in the first argument (backward-compatible shapes)', async () => {
    const f = await happyFixture();
    const payResult = await logisticsCreditPay.payLogisticsInstallmentWithCredit({
      buyerUserId: f.buyerId,
      subjectType: 'purchase_order',
      subjectId: f.poId,
      installment: 'deposit',
      quoteId: f.quoteId,
      amountCents: f.depositCents,
      idempotencyKey: `fixrev2-${f.suffix}`,
    });
    const caseId = await createRefundCase({ attemptId: payResult.attemptId, buyerId: f.buyerId, amountCents: f.depositCents });
    const refundKey = `fixrefund2-${f.suffix}`;

    const reversal = await withTransaction(pool, async (client) => {
      await client.query(`SELECT * FROM logistics_refund_cases WHERE id = $1 FOR UPDATE`, [caseId]);
      return logisticsCreditPay.reverseLogisticsCreditPayment({
        refundCaseId: caseId, amountCents: f.depositCents, currency: 'USD',
        idempotencyKey: refundKey, client,
      });
    }, 'logistics_credit_refund_test');

    expect(reversal.ledgerEntryId).toBeTruthy();
    expect(await walletBalanceCents(f.buyerId)).toBe(100000);
  });

  // ── Fix 2: registration on the production require chain ─────

  test('adapter is registered when the production-loaded refund service module is required', async () => {
    let freshCreditPort = null;
    let freshPool = null;
    jest.isolateModules(() => {
      // The module production actually loads (routes -> controller -> here,
      // and middleware/requireFreshAuth.js). Its bottom-of-module
      // registration must satisfy the setCreditReversalAdapter contract.
      require('../services/logisticsRefundService');
      freshCreditPort = require('../services/logisticsRefundPorts').creditPort;
      freshPool = require('../db');
    });
    try {
      // If the adapter were not registered this would fail with
      // credit_reversal_unavailable; the registered adapter runs and
      // reports the case as missing instead.
      await expect(freshCreditPort.reverseCredit({
        refundCaseId: 42424242,
        amountCents: 100,
        currency: 'USD',
        idempotencyKey: `chain-${tag()}`,
      })).rejects.toMatchObject({ code: 'refund_case_not_found' });
    } finally {
      if (freshPool && typeof freshPool.end === 'function') {
        await freshPool.end().catch(() => {});
      }
    }
  });
});
