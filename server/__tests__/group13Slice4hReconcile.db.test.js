'use strict';

// Group 13 Slice 4h acceptance: reconcile accounts (686-690).
// 686 per-location reconciliation summary, 687 adjustment matching,
// 688 difference annotations, 689 period-close review, 690 authorized
// reconciliation export — one participant/location-facing surface with two
// doors: the kiosk cashier (device-authenticated, paired location only)
// and HQ/participant (user-authenticated behind requireRestaurantAccess,
// own restaurant only). No money moves in this slice: the summary, the
// review, and the export derive from the existing runs, ledger rows,
// exceptions, and adjustments. The admin workspace is untouched.
// Runs against a dedicated fresh database (credit_statement_test_g13h) so
// slice-local fixtures never pollute the shared credit_statement_test DB.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'group13-slice4h-test-secret';

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

// 687: the propose path runs the funding-compliance choke point before
// creating the pending row. Compliance itself is not what this slice
// proves, so it is allowed here exactly as the agent-adjustment unit
// suite allows it; the link validation and the money path stay real.
jest.mock('../services/fiatComplianceService', () => ({
  evaluateFundingCompliance: jest.fn().mockResolvedValue({ allowed: true }),
}));

const crypto = require('crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('supertest');

const dbUrl = process.env.GROUP13_SLICE4H_TEST_DATABASE_URL;
if (dbUrl) {
  const url = new URL(dbUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.pathname !== '/credit_statement_test_g13h') {
    throw new Error('Group 13 Slice 4h DB tests require the loopback credit_statement_test_g13h database');
  }
  process.env.DATABASE_URL = dbUrl;
}

jest.setTimeout(60000);

const describeDb = dbUrl ? describe : describe.skip;

function signToken(payload) {
  return jwt.sign({ typ: 'access', sid: 'test-session', ...payload }, process.env.JWT_SECRET, { algorithm: 'HS256' });
}

describeDb('Group 13 Slice 4h: reconcile accounts (686-690)', () => {
  let pool;
  let app;
  let owner;
  let owner2;
  let businessId;
  let restaurantId;
  let restaurant2Id;
  let locPrimary;
  let locSecond;
  let locOtherRestaurant;
  let kioskDevice;
  let kioskToken;
  let otherDevice;
  let otherToken;
  let queueDevice;
  let queueToken;

  let walletId;
  let partnerPayableId;
  let treasuryId;
  let partnerId;
  let agreementId;
  let partner2Id;
  let agreement2Id;
  let partner2PayableId;
  let customerId;
  let cardId;
  let adminId;

  let orderAId;
  let orderBId;
  let orderR2Id;
  let orderATxId;
  let orderBTxId;
  let orderR2TxId;
  let redemptionTxId;
  let cashOutTxId;
  let prePeriodTxId;
  let settlementTxId;
  let excAId;
  let excBId;
  let excRestaurantId;
  let excGlobalId;
  let excResolvedId;
  let adjAId;
  let adjUnlinkedId;
  let settlementId;
  let cycleId;

  // The test period: [now - 2d, now + 1d). In-period rows are created at
  // now - 1d; the opening row at now - 3d.
  const periodStart = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  const periodEnd = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const inPeriod = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const prePeriod = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const periodQuery = `periodStart=${periodStart.toISOString()}&periodEnd=${periodEnd.toISOString()}&currencyCode=USD`;
  // Fixed idempotency keys / references are suffixed per run so the suite
  // can run twice against the same database without unique violations.
  const runId = crypto.randomUUID().slice(0, 8);

  beforeAll(async () => {
    pool = require('../db');
    const creditService = require('../services/oxsteedCreditService');
    app = express();
    app.use(express.json());
    // The real routers, mounted exactly as in server/index.js.
    app.use('/api/restaurants/:restaurantId/credit-kiosks/:deviceId', require('../routes/oxsteedCreditKiosk'));
    app.use('/api/restaurants/:restaurantId/credit-reconciliation', require('../routes/creditLocationReconciliation'));
    app.use('/api/agent', require('../routes/agentCreditAdjustments'));
    app.use(require('../middleware/errorHandler').errorHandler);

    await pool.query(`DELETE FROM oxsteed_credit_reconciliation_runs`);
    owner = await makeUser();
    owner2 = await makeUser();
    const { rows: [business] } = await pool.query(
      `INSERT INTO businesses (user_id, business_name, is_primary, is_active)
       VALUES ($1, 'Fixture Business', FALSE, TRUE) RETURNING id`,
      [owner.id],
    );
    businessId = business.id;
    const { rows: [restaurant] } = await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, status)
       VALUES ($1, $2, 'Fixture Kitchen', 'active') RETURNING id`,
      [business.id, owner.id],
    );
    restaurantId = restaurant.id;
    ({ rows: [{ id: locPrimary }] } = await pool.query(
      `SELECT id FROM restaurant_locations WHERE restaurant_id = $1 AND is_primary = TRUE`,
      [restaurantId],
    ));
    locPrimary = Number(locPrimary);
    await pool.query(`UPDATE restaurant_locations SET name = 'Downtown' WHERE id = $1`, [locPrimary]);
    locSecond = await makeLocation(restaurantId, 'Uptown', {});
    // A second restaurant, owned by someone else: every isolation test
    // reads against this restaurant's location and rows.
    const { rows: [business2] } = await pool.query(
      `INSERT INTO businesses (user_id, business_name, is_primary, is_active)
       VALUES ($1, 'Second Business', FALSE, TRUE) RETURNING id`,
      [owner2.id],
    );
    const { rows: [restaurant2] } = await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, status)
       VALUES ($1, $2, 'Second Kitchen', 'active') RETURNING id`,
      [business2.id, owner2.id],
    );
    restaurant2Id = restaurant2.id;
    ({ rows: [{ id: locOtherRestaurant }] } = await pool.query(
      `SELECT id FROM restaurant_locations WHERE restaurant_id = $1 AND is_primary = TRUE`,
      [restaurant2Id],
    ));
    locOtherRestaurant = Number(locOtherRestaurant);

    ({ device: kioskDevice, token: kioskToken } = await makeDevice({
      restaurantId, locationId: locPrimary, appKey: 'credit_kiosk',
    }));
    ({ device: otherDevice, token: otherToken } = await makeDevice({
      restaurantId, locationId: locSecond, appKey: 'credit_kiosk',
    }));
    ({ device: queueDevice, token: queueToken } = await makeDevice({
      restaurantId, locationId: locPrimary, appKey: 'display', config: { screenRole: 'queue' },
    }));

    const customer = await makeUser();
    customerId = customer.id;
    const admin = await makeUser('super_admin');
    adminId = admin.id;
    const approver = await makeUser('super_admin');
    const { rows: [partner] } = await pool.query(
      `INSERT INTO oxsteed_credit_partners (restaurant_id, status, created_by)
       VALUES ($1, 'active', $2) RETURNING id`,
      [restaurantId, admin.id],
    );
    partnerId = partner.id;
    const { rows: [agreement] } = await pool.query(
      `INSERT INTO oxsteed_credit_partner_agreements (partner_id, version, status, starts_at, created_by, approved_by)
       VALUES ($1, 1, 'active', NOW() - INTERVAL '30 days', $2, $3) RETURNING id`,
      [partner.id, admin.id, approver.id],
    );
    agreementId = agreement.id;
    const { rows: [partner2] } = await pool.query(
      `INSERT INTO oxsteed_credit_partners (restaurant_id, status, created_by)
       VALUES ($1, 'active', $2) RETURNING id`,
      [restaurant2Id, admin.id],
    );
    partner2Id = partner2.id;
    const { rows: [agreement2] } = await pool.query(
      `INSERT INTO oxsteed_credit_partner_agreements (partner_id, version, status, starts_at, created_by, approved_by)
       VALUES ($1, 1, 'active', NOW() - INTERVAL '30 days', $2, $3) RETURNING id`,
      [partner2.id, admin.id, approver.id],
    );
    agreement2Id = agreement2.id;

    walletId = await ensureCreditAccount({ accountType: 'customer_wallet', customerId: customer.id });
    partnerPayableId = await ensureCreditAccount({ accountType: 'partner_payable', partnerId });
    partner2PayableId = await ensureCreditAccount({ accountType: 'partner_payable', partnerId: partner2Id });
    treasuryId = await ensureCreditAccount({ accountType: 'platform_treasury' });
    {
      const fundClient = await pool.connect();
      try {
        await fundClient.query('BEGIN');
        await creditService.postJournalTransaction(fundClient, {
          currencyCode: 'USD',
          transactionType: 'load',
          debitAccountId: treasuryId,
          creditAccountId: walletId,
          amountCents: 100000,
          actorType: 'admin',
          actorUserId: admin.id,
          reason: 'Fixture load',
          referenceType: 'admin_load',
          referenceId: 'g13h-fixture-load',
          description: 'Fixture load',
          idempotencyKey: `g13h-load-${customer.id}`,
        });
        await fundClient.query('COMMIT');
      } catch (error) {
        await fundClient.query('ROLLBACK');
        throw error;
      } finally {
        fundClient.release();
      }
    }
    const { rows: [card] } = await pool.query(
      `INSERT INTO oxsteed_credit_cards (customer_id, account_id, card_type, status, credential_hash, credential_last4, idempotency_key)
       VALUES ($1, $2, 'virtual', 'active', $3, '4242', $4) RETURNING id`,
      [customer.id, walletId, crypto.createHash('sha256').update(`g13h-card-${customer.id}`).digest('hex'), `g13h-card-${customer.id}`],
    );
    cardId = card.id;

    // Location A (Downtown) rows: an order purchase, a direct redemption,
    // a cash-out, and a pre-period purchase that opens the period.
    const orderAttemptA = crypto.randomUUID();
    const { rows: [orderA] } = await pool.query(
      `INSERT INTO food_orders (restaurant_id, business_id, customer_id, location_id, subtotal_cents, total_cents, currency_code, queue_number, payment_status, order_source, fulfillment_type)
       VALUES ($1, $2, $3, $4, 1800, 1800, 'USD', 42, 'paid', 'kiosk', 'dine_in') RETURNING id`,
      [restaurantId, businessId, customer.id, locPrimary],
    );
    orderAId = orderA.id;
    orderATxId = await seedLedgerTx({
      type: 'purchase', amountCents: 1800,
      debitAccountId: walletId, creditAccountId: partnerPayableId,
      referenceType: 'food_order', referenceId: String(orderAId),
      metadata: {
        kioskDeviceId: String(kioskDevice.id), cardId,
        clientOrderId: `credit-kiosk:${kioskDevice.id}:${orderAttemptA}`,
        orderId: orderAId,
      },
      createdAt: inPeriod,
    });
    await pool.query(
      `UPDATE food_orders SET metadata = $2::jsonb WHERE id = $1`,
      [orderAId, JSON.stringify({
        clientOrderId: `credit-kiosk:${kioskDevice.id}:${orderAttemptA}`,
        creditKioskDeviceId: String(kioskDevice.id),
        oxsteedCreditTransactionId: orderATxId,
      })],
    );
    redemptionTxId = await seedLedgerTx({
      type: 'purchase', amountCents: 2500,
      debitAccountId: walletId, creditAccountId: partnerPayableId,
      referenceType: 'credit_kiosk_redemption', referenceId: String(kioskDevice.id),
      metadata: { kioskDeviceId: String(kioskDevice.id), cardId, cardLast4: '4242' },
      createdAt: inPeriod,
    });
    cashOutTxId = await seedLedgerTx({
      type: 'cash_out', amountCents: 1000,
      debitAccountId: walletId, creditAccountId: treasuryId,
      referenceType: 'credit_kiosk_cash_out', referenceId: String(kioskDevice.id),
      metadata: { kioskDeviceId: String(kioskDevice.id), cardId, cardLast4: '4242' },
      createdAt: inPeriod,
    });
    prePeriodTxId = await seedLedgerTx({
      type: 'purchase', amountCents: 5000,
      debitAccountId: walletId, creditAccountId: partnerPayableId,
      referenceType: 'credit_kiosk_redemption', referenceId: String(kioskDevice.id),
      metadata: { kioskDeviceId: String(kioskDevice.id), cardId, cardLast4: '4242' },
      createdAt: prePeriod,
    });
    // A partner-level settlement row: the restaurant's money with no
    // location attribution — it belongs in the unattributed bucket, never
    // in a location's totals. The direction guard requires treasury ->
    // payable with partner + agreement, and migration 490 requires the
    // row to reference a matching APPROVED settlement snapshot, so the
    // snapshot is created first (in an earlier period, so it stays out of
    // the period-close settlements list).
    const { rows: [approvedSettlement] } = await pool.query(
      `INSERT INTO oxsteed_credit_settlements
         (partner_id, agreement_id, currency_code, period_start, period_end,
          gross_cents, refund_cents, fee_cents, net_cents, status, approved_by, idempotency_key,
          creation_reason, creation_request_hash, created_by)
       VALUES ($1, $2, 'USD', $3, $4, 3000, 0, 0, 3000, 'approved', $5, $7,
               'Fixture settlement', $6, $5) RETURNING id`,
      [partnerId, agreementId,
        new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), new Date(Date.now() - 9 * 24 * 60 * 60 * 1000),
        admin.id, crypto.createHash('sha256').update('g13h-settlement-approved-' + runId).digest('hex'),
        'g13h-settlement-approved-' + runId],
    );
    {
      const id = crypto.randomUUID();
      await pool.query(
        `INSERT INTO oxsteed_credit_transactions
           (id, transaction_type, status, debit_account_id, credit_account_id,
            amount_cents, currency_code, idempotency_key, reference_type, reference_id,
            actor_type, actor_user_id, partner_id, agreement_id, metadata, posted_at, created_at)
         VALUES ($1, 'settlement', 'posted', $2, $3, 3000, 'USD', $4, 'credit_settlement', $5,
                 'system', NULL, $6, $7, '{}'::jsonb, $8, $8)`,
        [id, treasuryId, partnerPayableId, `g13h-settlement-${id}`, String(approvedSettlement.id), partnerId, agreementId, inPeriod],
      );
      settlementTxId = id;
    }

    // Location B (Uptown) rows: one order purchase on the other device.
    const orderAttemptB = crypto.randomUUID();
    const { rows: [orderB] } = await pool.query(
      `INSERT INTO food_orders (restaurant_id, business_id, customer_id, location_id, subtotal_cents, total_cents, currency_code, queue_number, payment_status, order_source, fulfillment_type)
       VALUES ($1, $2, $3, $4, 9900, 9900, 'USD', 7, 'paid', 'kiosk', 'pickup') RETURNING id`,
      [restaurantId, businessId, customer.id, locSecond],
    );
    orderBId = orderB.id;
    orderBTxId = await seedLedgerTx({
      type: 'purchase', amountCents: 9900,
      debitAccountId: walletId, creditAccountId: partnerPayableId,
      referenceType: 'food_order', referenceId: String(orderBId),
      metadata: {
        kioskDeviceId: String(otherDevice.id), cardId,
        clientOrderId: `credit-kiosk:${otherDevice.id}:${orderAttemptB}`,
        orderId: orderBId,
      },
      createdAt: inPeriod,
    });
    await pool.query(
      `UPDATE food_orders SET metadata = $2::jsonb WHERE id = $1`,
      [orderBId, JSON.stringify({
        clientOrderId: `credit-kiosk:${otherDevice.id}:${orderAttemptB}`,
        creditKioskDeviceId: String(otherDevice.id),
        oxsteedCreditTransactionId: orderBTxId,
      })],
    );

    // The other restaurant's row: same customer wallet, different partner
    // and location — it must never appear in restaurant 1's summary.
    const { rows: [orderR2] } = await pool.query(
      `INSERT INTO food_orders (restaurant_id, business_id, customer_id, location_id, subtotal_cents, total_cents, currency_code, queue_number, payment_status, order_source, fulfillment_type)
       VALUES ($1, $2, $3, $4, 7700, 7700, 'USD', 3, 'paid', 'web', 'pickup') RETURNING id`,
      [restaurant2Id, business2.id, customer.id, locOtherRestaurant],
    );
    orderR2Id = orderR2.id;
    orderR2TxId = await seedLedgerTx({
      type: 'purchase', amountCents: 7700,
      debitAccountId: walletId, creditAccountId: partner2PayableId,
      referenceType: 'food_order', referenceId: String(orderR2Id),
      metadata: { orderId: orderR2Id },
      createdAt: inPeriod,
      partnerId: partner2Id, agreementId: agreement2Id,
    });

    // Reconciliation runs overlapping the test period: one balanced, one
    // with a platform difference of 700 (never allocated to a location).
    await pool.query(
      `INSERT INTO oxsteed_credit_reconciliation_runs
         (currency_code, period_start, period_end, status, account_balance_cents,
          journal_balance_cents, difference_cents, account_count, entry_count, completed_at)
       VALUES ('USD', $1, $2, 'balanced', 100000, 100000, 0, 3, 12, NOW()),
              ('USD', $3, $4, 'difference', 100700, 100000, 700, 3, 12, NOW())`,
      [
        new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), new Date(Date.now() - 24 * 60 * 60 * 1000),
        new Date(Date.now() - 24 * 60 * 60 * 1000), new Date(Date.now()),
      ],
    );

    // A settlement cycle and a pending settlement for the period (689):
    // the review informs them and must never change them.
    const { rows: [cycle] } = await pool.query(
      `INSERT INTO oxsteed_credit_settlement_cycles
         (cycle_type, period_start, period_end, cutoff_at, value_date, settlement_date, status)
       VALUES ('daily', $1, $2, $2, $3::date, $3::date, 'scheduled') RETURNING id`,
      [periodStart, periodEnd, periodEnd.toISOString().slice(0, 10)],
    );
    cycleId = cycle.id;
    const { rows: [settlement] } = await pool.query(
      `INSERT INTO oxsteed_credit_settlements
         (partner_id, agreement_id, currency_code, period_start, period_end,
          gross_cents, refund_cents, fee_cents, net_cents, status, idempotency_key,
          creation_reason, creation_request_hash, created_by)
       VALUES ($1, $2, 'USD', $3, $4, 5000, 0, 100, 4900, 'pending', $7,
               'Fixture settlement', $5, $6) RETURNING id`,
      [partnerId, agreementId, periodStart, periodEnd,
        crypto.createHash('sha256').update('g13h-settlement-1-' + runId).digest('hex'), admin.id,
        'g13h-settlement-1-' + runId],
    );
    settlementId = settlement.id;

    // Exceptions: one per location (food-order references), one
    // restaurant-level (restaurantId in details, no location), one global
    // platform finding (no restaurant signal at all), and one resolved.
    excAId = await seedException({
      domain: 'payment_refund', referenceId: `food-order:${orderAId}`, severity: 'warning', status: 'open',
      summary: 'Wallet debit not found for cancelled/refunded food order',
      details: { restaurantId, locationId: locPrimary, orderReferenceId: String(orderAId) },
    });
    excBId = await seedException({
      domain: 'payment_refund', referenceId: `food-order:${orderBId}`, severity: 'warning', status: 'open',
      summary: 'Wallet debit not found for cancelled/refunded food order',
      details: { restaurantId, locationId: locSecond, orderReferenceId: String(orderBId) },
    });
    excRestaurantId = await seedException({
      domain: 'credit_external', referenceId: `partner-payable-check-${runId}`, severity: 'warning', status: 'acknowledged',
      summary: 'Partner payable needs review',
      details: { restaurantId },
    });
    excGlobalId = await seedException({
      domain: 'credit_external', referenceId: `stripe-payout-mismatch-${runId}`, severity: 'critical', status: 'open',
      summary: 'Stripe payout mismatch',
      details: { currencyCode: 'USD', kind: 'payout' },
    });
    excResolvedId = await seedException({
      domain: 'payment_refund', referenceId: `food-order:${orderAId}`, severity: 'info', status: 'resolved',
      summary: 'Earlier order difference, fixed by admin',
      details: { restaurantId, locationId: locPrimary, resolution_notes: 'Fixed by admin' },
      resolvedAt: new Date(),
    });

    // Adjustments (687): one linked to excA, one unlinked.
    const { rows: [adjA] } = await pool.query(
      `INSERT INTO credit_adjustments
         (customer_id, reconciliation_exception_id, amount_cents, currency_code, reason,
          proposed_by, status, applied_at, idempotency_key)
       VALUES ($1, $2, 500, 'USD', 'Goodwill credit for the missing refund', $3, 'applied', NOW(), $4)
       RETURNING id`,
      [customer.id, excAId, admin.id, 'g13h-adj-a-' + runId],
    );
    adjAId = adjA.id;
    const { rows: [adjUnlinked] } = await pool.query(
      `INSERT INTO credit_adjustments
         (customer_id, amount_cents, currency_code, reason,
          proposed_by, status, idempotency_key)
       VALUES ($1, -200, 'USD', 'Pending review adjustment', $2, 'pending', $3)
       RETURNING id`,
      [customer.id, admin.id, 'g13h-adj-unlinked-' + runId],
    );
    adjUnlinkedId = adjUnlinked.id;

    // One seeded annotation on excA, by the participant (688).
    await pool.query(
      `INSERT INTO oxsteed_credit_reconciliation_annotations
         (exception_id, author_type, author_user_id, body)
       VALUES ($1, 'participant', $2, 'Checked with the kitchen; till balanced.')`,
      [excAId, owner.id],
    );

    async function ensureCreditAccount({ accountType, customerId: cid = null, partnerId: pid = null }) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const account = await creditService.ensureAccount(client, {
          accountType, customerId: cid, partnerId: pid, currencyCode: 'USD',
        });
        await client.query('COMMIT');
        return account.id;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  async function makeUser(role = 'customer') {
    const id = crypto.randomUUID();
    const email = `t${id}@example.invalid`;
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active, totp_enabled)
       VALUES ($1, $2, 'x', 'Test', 'Fixture', $3, TRUE, TRUE, TRUE)`,
      [id, email, role],
    );
    return { id, email, role };
  }

  async function makeLocation(restaurant, name, { isPrimary = false, status = 'active' } = {}) {
    const { rows: [row] } = await pool.query(
      `INSERT INTO restaurant_locations (restaurant_id, name, is_primary, status)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [restaurant, name, isPrimary, status],
    );
    return Number(row.id);
  }

  async function makeDevice({ restaurantId: rid, locationId = null, appKey = 'credit_kiosk', config = {}, mode = null }) {
    const token = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const { rows: [device] } = await pool.query(
      `INSERT INTO restaurant_app_devices
         (restaurant_id, location_id, app_key, device_name, mode, status, config,
          device_token_hash, device_token_expires_at, paired_at)
       VALUES ($1, $2, $3, 'Fixture device', $4, 'paired', $5, $6, NOW() + INTERVAL '90 days', NOW())
       RETURNING id`,
      [rid, locationId, appKey, mode, JSON.stringify(config), hash],
    );
    const { rows: [registry] } = await pool.query(
      `SELECT id, status FROM restaurant_devices WHERE source_app_device_id = $1`,
      [device.id],
    );
    expect(registry?.status).toBe('active');
    return { device, token };
  }

  async function seedLedgerTx({
    type, status = 'posted', amountCents, debitAccountId, creditAccountId,
    referenceType, referenceId, metadata, createdAt = null,
    actorType = type === 'purchase' ? 'customer' : 'kiosk',
    actorUserId = type === 'purchase' ? customerId : null,
    partnerId: txPartnerId = type === 'purchase' ? partnerId : null,
    agreementId: txAgreementId = type === 'purchase' ? agreementId : null,
  }) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO oxsteed_credit_transactions
         (id, transaction_type, status, debit_account_id, credit_account_id,
          amount_cents, currency_code, idempotency_key, reference_type, reference_id,
          actor_type, actor_user_id, partner_id, agreement_id, metadata, posted_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'USD', $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15, COALESCE($16, NOW()))`,
      [id, type, status, debitAccountId, creditAccountId, amountCents,
        `g13h-${id}`, referenceType, referenceId, actorType, actorUserId, txPartnerId, txAgreementId,
        JSON.stringify(metadata), status === 'posted' ? (createdAt || new Date()) : null, createdAt],
    );
    return id;
  }

  async function seedException({ domain, referenceId, severity, status, summary, details, resolvedAt = null }) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO reconciliation_exceptions
         (id, domain, reference_id, severity, status, summary, details, resolved_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
      [id, domain, referenceId, severity, status, summary, JSON.stringify(details), resolvedAt],
    );
    return id;
  }

  const cashierGet = (device, token, path) => request(app)
    .get(`/api/restaurants/${restaurantId}/credit-kiosks/${device.id}${path}`)
    .set('X-Device-Token', token);
  const cashierPost = (device, token, path, body) => request(app)
    .post(`/api/restaurants/${restaurantId}/credit-kiosks/${device.id}${path}`)
    .set('X-Device-Token', token)
    .send(body || {});
  const hqGet = (user, rid, path) => request(app)
    .get(`/api/restaurants/${rid}/credit-reconciliation${path}`)
    .set('Authorization', `Bearer ${signToken({ id: user.id })}`);
  const hqPost = (user, rid, path, body) => request(app)
    .post(`/api/restaurants/${rid}/credit-reconciliation${path}`)
    .set('Authorization', `Bearer ${signToken({ id: user.id })}`)
    .send(body || {});
  const adminPost = (path, body) => request(app)
    .post(`/api/agent${path}`)
    .set('Authorization', `Bearer ${signToken({ id: adminId })}`)
    .send(body || {});
  const resetKioskLimiter = async (deviceId) => {
    const limiters = [];
    const walk = (stack) => {
      for (const layer of stack || []) {
        if (layer.handle && typeof layer.handle.resetKey === 'function') limiters.push(layer.handle);
        if (layer.handle && Array.isArray(layer.handle.stack)) walk(layer.handle.stack);
        if (layer.route && Array.isArray(layer.route.stack)) walk(layer.route.stack);
      }
    };
    walk(app._router.stack);
    await Promise.all(limiters.map((limiter) => limiter.resetKey(`kiosk:${deviceId}`)));
  };

  beforeEach(async () => {
    await resetKioskLimiter(kioskDevice.id);
    await resetKioskLimiter(otherDevice.id);
  });

  test('686: the cashier summary defaults to the paired location with exact totals', async () => {
    const res = await cashierGet(kioskDevice, kioskToken, `/cashier/reconciliation/summary?${periodQuery}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      location: { id: locPrimary, name: 'Downtown' },
      currencyCode: 'USD',
      openingCents: 5000,
      creditsCents: 4300,
      debitsCents: 0,
      closingCents: 9300,
      transactionCount: 3,
      cashOutCount: 1,
      cashOutCents: 1000,
      platformDifferenceCents: 700,
      openExceptionCount: 1,
      matchedAdjustmentCount: 1,
      matchedAdjustmentCents: 500,
      otherLocations: null,
    });
    expect(res.body.byType).toMatchObject({
      purchase: { count: 2, amountCents: 4300 },
      cash_out: { count: 1, amountCents: 1000 },
    });
    expect(res.body.unattributedRestaurant).toMatchObject({
      transactionCount: 1,
      creditsCents: 3000,
      debitsCents: 0,
    });
    expect(res.body.runs).toHaveLength(2);
    expect(res.body.runs.map((run) => run.status).sort()).toEqual(['balanced', 'difference']);
    expect(res.body.runs.every((run) => run.scope === 'platform')).toBe(true);
  });

  test('686: a location outside the device scope is refused', async () => {
    const res = await cashierGet(kioskDevice, kioskToken, `/cashier/reconciliation/summary?${periodQuery}&locationId=${locSecond}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('location_scope_forbidden');
    const otherRestaurant = await cashierGet(kioskDevice, kioskToken, `/cashier/reconciliation/summary?${periodQuery}&locationId=${locOtherRestaurant}`);
    expect(otherRestaurant.status).toBe(403);
    expect(otherRestaurant.body.code).toBe('location_scope_forbidden');
  });

  test('686: the reconciliation surface needs a cashier device credential', async () => {
    const noToken = await request(app)
      .get(`/api/restaurants/${restaurantId}/credit-kiosks/${kioskDevice.id}/cashier/reconciliation/summary?${periodQuery}`);
    expect(noToken.status).toBe(401);
    const queueBoard = await cashierGet(queueDevice, queueToken, `/cashier/reconciliation/summary?${periodQuery}`);
    expect(queueBoard.status).toBe(403);
    expect(queueBoard.body.code).toBe('credit_kiosk_cashier_device_required');
  });

  test('686: HQ sees the location totals plus the other locations of its own restaurant', async () => {
    const res = await hqGet(owner, restaurantId, `/summary?${periodQuery}&locationId=${locPrimary}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      openingCents: 5000,
      creditsCents: 4300,
      closingCents: 9300,
    });
    expect(res.body.otherLocations).toMatchObject({
      transactionCount: 1,
      creditsCents: 9900,
      debitsCents: 0,
      cashOutCount: 0,
      cashOutCents: 0,
    });
    const uptown = await hqGet(owner, restaurantId, `/summary?${periodQuery}&locationId=${locSecond}`);
    expect(uptown.status).toBe(200);
    expect(uptown.body).toMatchObject({
      openingCents: 0,
      creditsCents: 9900,
      debitsCents: 0,
      closingCents: 9900,
      transactionCount: 1,
    });
    expect(uptown.body.otherLocations).toMatchObject({
      transactionCount: 3,
      creditsCents: 4300,
      cashOutCount: 1,
      cashOutCents: 1000,
    });
  });

  test('686: HQ must name a location, and another restaurant is 404', async () => {
    const missing = await hqGet(owner, restaurantId, `/summary?${periodQuery}`);
    expect(missing.status).toBe(400);
    expect(missing.body.code).toBe('invalid_locationId');
    const foreign = await hqGet(owner, restaurantId, `/summary?${periodQuery}&locationId=${locOtherRestaurant}`);
    expect(foreign.status).toBe(404);
    expect(foreign.body.code).toBe('credit_reconciliation_location_not_found');
    const stranger = await hqGet(owner2, restaurantId, `/summary?${periodQuery}&locationId=${locPrimary}`);
    expect(stranger.status).toBe(404);
    expect(stranger.body.code).toBe('restaurant_not_found');
    const noToken = await request(app)
      .get(`/api/restaurants/${restaurantId}/credit-reconciliation/summary?${periodQuery}&locationId=${locPrimary}`);
    expect(noToken.status).toBe(401);
  });

  test('687: the cashier sees the location exception with its matched adjustment and annotation count', async () => {
    const res = await cashierGet(kioskDevice, kioskToken, '/cashier/reconciliation/exceptions');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.restaurantLevel).toBeNull();
    const [exception] = res.body.exceptions;
    expect(exception).toMatchObject({ id: excAId, status: 'open', annotationCount: 1 });
    expect(exception.adjustments).toHaveLength(1);
    expect(exception.adjustments[0]).toMatchObject({
      id: adjAId,
      amountCents: 500,
      status: 'applied',
      reconciliationExceptionId: excAId,
    });
    expect(exception.annotations).toHaveLength(1);
    expect(exception.annotations[0]).toMatchObject({
      authorType: 'participant',
      body: 'Checked with the kitchen; till balanced.',
    });
    const ids = res.body.exceptions.map((entry) => entry.id);
    expect(ids).not.toContain(excBId);
    expect(ids).not.toContain(excGlobalId);
    expect(ids).not.toContain(excRestaurantId);
  });

  test('687: resolved exceptions list only on request, with their resolve-time notes', async () => {
    const res = await cashierGet(kioskDevice, kioskToken, '/cashier/reconciliation/exceptions?status=resolved');
    expect(res.status).toBe(200);
    expect(res.body.exceptions.map((entry) => entry.id)).toEqual([excResolvedId]);
    expect(res.body.exceptions[0]).toMatchObject({ resolutionNotes: 'Fixed by admin' });
    const badStatus = await cashierGet(kioskDevice, kioskToken, '/cashier/reconciliation/exceptions?status=bogus');
    expect(badStatus.status).toBe(400);
    expect(badStatus.body.code).toBe('invalid_status');
  });

  test('687: HQ sees the restaurant-level exception bucket but never the global finding', async () => {
    const res = await hqGet(owner, restaurantId, `/exceptions?locationId=${locPrimary}`);
    expect(res.status).toBe(200);
    expect(res.body.exceptions.map((entry) => entry.id)).toEqual([excAId]);
    expect(res.body.restaurantLevel.total).toBe(1);
    expect(res.body.restaurantLevel.exceptions.map((entry) => entry.id)).toEqual([excRestaurantId]);
    const allIds = [...res.body.exceptions, ...res.body.restaurantLevel.exceptions].map((entry) => entry.id);
    expect(allIds).not.toContain(excGlobalId);
  });

  test('687: the admin link endpoint links an existing adjustment once', async () => {
    const unknownException = await adminPost(`/credit-adjustments/${adjUnlinkedId}/link-exception`, {
      reconciliationExceptionId: crypto.randomUUID(),
    });
    expect(unknownException.status).toBe(404);
    expect(unknownException.body.code).toBe('reconciliation_exception_not_found');
    const unknownAdjustment = await adminPost(`/credit-adjustments/${crypto.randomUUID()}/link-exception`, {
      reconciliationExceptionId: excBId,
    });
    expect(unknownAdjustment.status).toBe(404);
    expect(unknownAdjustment.body.code).toBe('credit_adjustment_not_found');
    const linked = await adminPost(`/credit-adjustments/${adjUnlinkedId}/link-exception`, {
      reconciliationExceptionId: excBId,
    });
    expect(linked.status).toBe(200);
    expect(linked.body.adjustment).toMatchObject({
      id: adjUnlinkedId,
      reconciliationExceptionId: excBId,
    });
    const again = await adminPost(`/credit-adjustments/${adjUnlinkedId}/link-exception`, {
      reconciliationExceptionId: excAId,
    });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('credit_adjustment_exception_already_linked');
    const { rows: [audit] } = await pool.query(
      `SELECT action_type FROM oxsteed_credit_audit_events
        WHERE resource_type = 'credit_adjustment' AND resource_id = $1
          AND action_type = 'credit.agent_adjustment.exception_linked'`,
      [adjUnlinkedId],
    );
    expect(audit?.action_type).toBe('credit.agent_adjustment.exception_linked');
  });

  test('687: propose accepts a reconciliation exception link, and rejects an unknown one', async () => {
    const unknown = await adminPost('/credit-adjustments', {
      customerId, amountCents: 100, currencyCode: 'USD', reason: 'Link test, unknown exception',
      idempotencyKey: `g13h-propose-unknown-${runId}`, reconciliationExceptionId: crypto.randomUUID(),
    });
    expect(unknown.status).toBe(404);
    expect(unknown.body.code).toBe('reconciliation_exception_not_found');
    const proposed = await adminPost('/credit-adjustments', {
      customerId, amountCents: 100, currencyCode: 'USD', reason: 'Link test propose',
      idempotencyKey: `g13h-propose-1-${runId}`, reconciliationExceptionId: excAId,
    });
    expect(proposed.status).toBe(201);
    expect(proposed.body.adjustment).toMatchObject({
      reconciliationExceptionId: excAId,
      status: 'pending',
    });
    expect(proposed.body.replayed).toBe(false);
  });

  test('687: the linked adjustment appears on its own exception afterwards', async () => {
    const res = await hqGet(owner, restaurantId, `/exceptions?locationId=${locSecond}`);
    expect(res.status).toBe(200);
    expect(res.body.exceptions.map((entry) => entry.id)).toEqual([excBId]);
    expect(res.body.exceptions[0].adjustments).toHaveLength(1);
    expect(res.body.exceptions[0].adjustments[0]).toMatchObject({
      id: adjUnlinkedId,
      amountCents: -200,
      reconciliationExceptionId: excBId,
    });
  });

  test('688: the cashier annotates the open exception; the annotation carries author and time', async () => {
    const res = await cashierPost(kioskDevice, kioskToken, `/cashier/reconciliation/exceptions/${excAId}/annotations`, {
      body: 'Till counted twice, matches the summary.',
    });
    expect(res.status).toBe(201);
    expect(res.body.annotation).toMatchObject({
      exceptionId: excAId,
      authorType: 'cashier',
      authorDeviceId: Number(kioskDevice.id),
      body: 'Till counted twice, matches the summary.',
    });
    expect(new Date(res.body.annotation.createdAt).getTime()).not.toBeNaN();
    const listed = await cashierGet(kioskDevice, kioskToken, `/cashier/reconciliation/exceptions/${excAId}/annotations`);
    expect(listed.status).toBe(200);
    expect(listed.body.annotations).toHaveLength(2);
    expect(listed.body.annotations[0]).toMatchObject({ authorType: 'cashier' });
    expect(listed.body.annotations[1]).toMatchObject({ authorType: 'participant' });
  });

  test('688: another location, a resolved exception, a global finding, and empty text are all refused', async () => {
    const otherLocation = await cashierPost(kioskDevice, kioskToken, `/cashier/reconciliation/exceptions/${excBId}/annotations`, { body: 'Not mine.' });
    expect(otherLocation.status).toBe(404);
    expect(otherLocation.body.code).toBe('reconciliation_exception_not_found');
    const resolved = await cashierPost(kioskDevice, kioskToken, `/cashier/reconciliation/exceptions/${excResolvedId}/annotations`, { body: 'Too late.' });
    expect(resolved.status).toBe(409);
    expect(resolved.body.code).toBe('reconciliation_annotation_closed');
    const global = await cashierPost(kioskDevice, kioskToken, `/cashier/reconciliation/exceptions/${excGlobalId}/annotations`, { body: 'Platform?' });
    expect(global.status).toBe(404);
    expect(global.body.code).toBe('reconciliation_exception_not_found');
    const empty = await cashierPost(kioskDevice, kioskToken, `/cashier/reconciliation/exceptions/${excAId}/annotations`, { body: '   ' });
    expect(empty.status).toBe(400);
    expect(empty.body.code).toBe('invalid_annotation');
  });

  test('688: HQ annotates the restaurant-level exception as the participant', async () => {
    const res = await hqPost(owner, restaurantId, `/exceptions/${excRestaurantId}/annotations?locationId=${locPrimary}`, {
      body: 'HQ is chasing the partner team on this one.',
    });
    expect(res.status).toBe(201);
    expect(res.body.annotation).toMatchObject({
      exceptionId: excRestaurantId,
      authorType: 'participant',
      authorUserId: owner.id,
    });
  });

  test('689: the period-close review shows the summary, cycle, settlements, and the non-approval', async () => {
    const res = await cashierGet(kioskDevice, kioskToken, `/cashier/reconciliation/period-close?${periodQuery}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      location: { id: locPrimary },
      settlementApproval: { required: 'two_admins', approvedByThisReview: false },
      review: null,
      exceptionTotal: 1,
      // 500 is the seeded applied adjustment; 100 is the propose-test
      // adjustment linked to the same exception earlier in this suite.
      matchedAdjustmentCents: 600,
    });
    expect(res.body.summary).toMatchObject({ closingCents: 9300 });
    expect(res.body.settlementCycle).toMatchObject({ id: cycleId, status: 'scheduled' });
    expect(res.body.settlements).toHaveLength(1);
    expect(res.body.settlements[0]).toMatchObject({ id: settlementId, status: 'pending', netCents: 4900 });
  });

  test('689: recording the review snapshots the summary, is idempotent, and never approves the settlement', async () => {
    const first = await cashierPost(kioskDevice, kioskToken, '/cashier/reconciliation/period-close', {
      periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString(), currencyCode: 'USD',
    });
    expect(first.status).toBe(201);
    expect(first.body.alreadyReviewed).toBe(false);
    expect(first.body.settlementApproval).toMatchObject({ approvedByThisReview: false });
    expect(first.body.review).toMatchObject({
      locationId: locPrimary,
      reviewedByType: 'cashier',
      reviewedByDeviceId: Number(kioskDevice.id),
    });
    expect(first.body.review.summary).toMatchObject({ closingCents: 9300 });
    const { rows: [settlement] } = await pool.query(
      `SELECT status FROM oxsteed_credit_settlements WHERE id = $1`,
      [settlementId],
    );
    expect(settlement.status).toBe('pending');
    const second = await cashierPost(kioskDevice, kioskToken, '/cashier/reconciliation/period-close', {
      periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString(), currencyCode: 'USD',
    });
    expect(second.status).toBe(200);
    expect(second.body.alreadyReviewed).toBe(true);
    expect(second.body.review.id).toBe(first.body.review.id);
  });

  test('689: HQ records a review for an earlier period as the participant', async () => {
    const start = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const end = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const res = await hqPost(owner, restaurantId, '/period-close', {
      locationId: locPrimary,
      periodStart: start.toISOString(), periodEnd: end.toISOString(), currencyCode: 'USD',
    });
    expect(res.status).toBe(201);
    expect(res.body.alreadyReviewed).toBe(false);
    expect(res.body.settlementApproval).toMatchObject({ approvedByThisReview: false });
    expect(res.body.review).toMatchObject({
      reviewedByType: 'participant',
      reviewedByUserId: owner.id,
    });
    // Only the pre-period purchase (now - 3d) falls in this window.
    expect(res.body.summary).toMatchObject({ openingCents: 0, creditsCents: 5000, closingCents: 5000 });
    expect(res.body.review.summary).toMatchObject({ closingCents: 5000 });
  });

  test('690: the cashier export is CSV with the summary columns and only this location rows', async () => {
    const res = await cashierGet(kioskDevice, kioskToken, `/cashier/reconciliation/export.csv?${periodQuery}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toContain(`oxsteed-credit-location-reconciliation-${locPrimary}`);
    expect(res.headers['cache-control']).toMatch(/no-store/);
    expect(res.text).toMatch(/Closing \(cents\)[^0-9]*9300/);
    expect(res.text).toMatch(/Open exceptions[^0-9]*1/);
    expect(res.text).toContain(orderATxId);
    expect(res.text).toContain(redemptionTxId);
    expect(res.text).toContain(cashOutTxId);
    expect(res.text).not.toContain(orderBTxId);
    expect(res.text).not.toContain(orderR2TxId);
  });

  test('690: HQ exports the other location, and the export stays location-scoped', async () => {
    const res = await hqGet(owner, restaurantId, `/export.csv?${periodQuery}&locationId=${locSecond}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text).toContain(orderBTxId);
    expect(res.text).not.toContain(orderATxId);
    expect(res.text).toMatch(/Closing \(cents\)[^0-9]*9900/);
    const refused = await cashierGet(kioskDevice, kioskToken, `/cashier/reconciliation/export.csv?${periodQuery}&locationId=${locSecond}`);
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('location_scope_forbidden');
    const missing = await hqGet(owner, restaurantId, `/export.csv?${periodQuery}`);
    expect(missing.status).toBe(400);
    expect(missing.body.code).toBe('invalid_locationId');
  });
});
