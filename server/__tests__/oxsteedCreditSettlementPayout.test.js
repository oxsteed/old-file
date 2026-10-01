'use strict';

const { mockQuery, resetMocks } = require('./setup');
const {
  initiateSettlementPayout,
  confirmSettlementPayoutFromTransfer,
  failSettlementPayoutFromTransfer,
} = require('../services/oxsteedCreditAdminService');

const stripe = require('stripe');
const stripeInstance = stripe.__mockInstance;
stripeInstance.transfers = { create: jest.fn(), retrieve: jest.fn() };

const ADMIN_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const SETTLEMENT_ID = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const PARTNER_ID = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';
const TRANSFER_ID = 'tr_test_123';

function baseSettlementRow(overrides = {}) {
  return {
    id: SETTLEMENT_ID,
    partner_id: PARTNER_ID,
    agreement_id: 'dddddddd-dddd-4ddd-dddd-dddddddddddd',
    restaurant_id: 123,
    settlement_currency_code: 'USD',
    currency_code: 'USD',
    period_start: '2026-09-01',
    period_end: '2026-09-30',
    gross_cents: 5000,
    refund_cents: 0,
    fee_cents: 0,
    net_cents: 5000,
    status: 'approved',
    payment_reference: null,
    stripe_transfer_id: null,
    payout_status: 'none',
    payout_initiated_by: null,
    payout_initiated_at: null,
    approved_by: ADMIN_ID,
    partner_status: 'active',
    restaurant_name: 'Test Kitchen',
    ...overrides,
  };
}

const restaurantRow = { business_id: 456, owner_user_id: 'eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee' };

let businessRow = { stripe_account_id: 'acct_business_1' };
let connectAccountRows = [];
let settlementRow = baseSettlementRow();

function accountRowFor(type) {
  const isTreasury = type === 'platform_treasury';
  return {
    id: isTreasury ? 102 : 101,
    account_type: type,
    balance_cents: isTreasury ? 1000000 : 10000,
    reserved_cents: 0,
    status: 'active',
    ledger_version: 1,
    last_entry_hash: null,
  };
}

function installDbRouter() {
  mockQuery.mockImplementation((sql, params = []) => {
    const s = String(sql);
    if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return { rows: [] };
    if (s.includes('FROM feature_flags')) return { rows: [{ is_enabled: true }] };
    if (s.includes('FROM oxsteed_credit_rail_freezes')) return { rows: [] };
    if (s.includes('FROM oxsteed_credit_settlements s')) return { rows: [settlementRow] };
    if (s.includes('FROM food_restaurants')) return { rows: [restaurantRow] };
    if (s.includes('FROM businesses b')) return { rows: businessRow ? [businessRow] : [] };
    if (s.includes('FROM connect_accounts')) return { rows: connectAccountRows };
    if (s.includes('UPDATE oxsteed_credit_settlements')) {
      if (s.includes("payout_status = 'initiated'")) {
        return { rows: [{ ...settlementRow, stripe_transfer_id: params[0], payout_status: 'initiated', payout_initiated_by: params[1] }] };
      }
      if (s.includes("status = 'paid'")) {
        return { rows: [{ ...settlementRow, status: 'paid', payment_reference: params[0] }] };
      }
      if (s.includes("payout_status = 'paid'")) return { rows: [{ ...settlementRow, payout_status: 'paid' }] };
      if (s.includes("payout_status = 'failed'")) return { rows: [{ ...settlementRow, payout_status: 'failed' }] };
      return { rows: [settlementRow] };
    }
    if (s.includes('oxsteed_credit_audit_events')) return { rows: [] };
    if (s.includes('INSERT INTO incident_log')) return { rows: [] };
    if (s.includes('INSERT INTO oxsteed_credit_transactions')) {
      return { rows: [{ id: 'tx-9001', transaction_type: 'settlement', status: 'posted', metadata: { paymentReference: `stripe_transfer:${TRANSFER_ID}` } }] };
    }
    if (s.includes('FROM oxsteed_credit_transactions')) return { rows: [] };
    if (s.includes('INSERT INTO oxsteed_credit_accounts')) return { rows: [] };
    if (s.includes('id = ANY')) {
      return { rows: [accountRowFor('partner_payable'), accountRowFor('platform_treasury')] };
    }
    if (s.includes('FROM oxsteed_credit_reserve_policies')) {
      // Phase 3 reserve regime: default policy (10% ratio, $500 floor).
      return { rows: [{ id: 1, partner_id: null, currency_code: 'USD', ratio_bps: 1000, floor_cents: 50000, is_default: true }] };
    }
    if (s.includes('FROM oxsteed_credit_sanctions_screenings')) {
      // Phase 5: the payout beneficiary screens clear (fresh), so the
      // payout sanctions gate passes in these success-path tests.
      return { rows: [{ id: 'san-1', subject_type: 'partner', subject_id: PARTNER_ID, provider: 'manual_review', result: 'clear', hit_context: null, payload_hash: 'h', screened_at: new Date().toISOString(), cleared_at: null, cleared_by: null, clear_reason: null, created_at: new Date().toISOString() }] };
    }
    if (s.includes('FROM oxsteed_credit_accounts') && !s.includes('FROM oxsteed_credit_accounts a')) {
      // Phase 3 reserve balance reads (no table alias in that query shape).
      // The reserve is funded above the default floor so the payout gate passes.
      const balances = { partner_reserve: 100000, partner_payable: 0 };
      return { rows: [{ balance_cents: balances[params[0]] ?? 0 }] };
    }
    if (s.includes('FROM oxsteed_credit_accounts a')) {
      return { rows: [accountRowFor(params[0])] };
    }
    if (s.includes('WITH ledger_write')) return { rows: [{ id: params[3], balance_cents: params[0] }] };
    if (s.includes('INSERT INTO oxsteed_credit_transaction_entries')) return { rows: [{ id: 1 }] };
    return { rows: [] };
  });
}

beforeEach(() => {
  resetMocks();
  businessRow = { stripe_account_id: 'acct_business_1' };
  connectAccountRows = [];
  settlementRow = baseSettlementRow();
  installDbRouter();
  stripeInstance.transfers.create.mockReset();
  stripeInstance.transfers.retrieve.mockReset();
  stripeInstance.transfers.create.mockResolvedValue({ id: TRANSFER_ID, amount: 5000, currency: 'usd', metadata: { oxsteed_credit_settlement_id: SETTLEMENT_ID } });
  stripeInstance.transfers.retrieve.mockResolvedValue({ id: TRANSFER_ID, amount: 5000, currency: 'usd', reversed: false, metadata: { oxsteed_credit_settlement_id: SETTLEMENT_ID } });
});

describe('initiateSettlementPayout', () => {
  test('creates a Stripe transfer and stores it, leaving the settlement approved', async () => {
    const result = await initiateSettlementPayout({
      settlementId: SETTLEMENT_ID,
      actorUserId: ADMIN_ID,
      idempotencyKey: 'payout-attempt-1',
      requestIp: '203.0.113.9',
    });

    expect(result.settlement.status).toBe('approved');
    expect(result.stripeTransferId).toBe(TRANSFER_ID);

    expect(stripeInstance.transfers.create).toHaveBeenCalledTimes(1);
    const [transferArgs, transferOpts] = stripeInstance.transfers.create.mock.calls[0];
    expect(transferArgs).toMatchObject({
      amount: 5000,
      currency: 'usd',
      destination: 'acct_business_1',
      metadata: { oxsteed_credit_settlement_id: SETTLEMENT_ID },
    });
    expect(transferOpts).toMatchObject({ idempotencyKey: `credit-settlement-payout:${SETTLEMENT_ID}` });

    const updateCall = mockQuery.mock.calls.find(
      ([sql]) => sql.includes('UPDATE oxsteed_credit_settlements') && sql.includes("payout_status = 'initiated'")
    );
    expect(updateCall).toBeDefined();
    expect(updateCall[1][0]).toBe(TRANSFER_ID);
    expect(updateCall[1][1]).toBe('acct_business_1');
    expect(updateCall[1][2]).toBe(ADMIN_ID);
    expect(updateCall[0]).toContain('payout_destination_account');

    const auditCall = mockQuery.mock.calls.find(([sql]) => sql.includes('oxsteed_credit_audit_events') && String(sql).includes('INSERT'));
    expect(auditCall).toBeDefined();
    expect(auditCall[1][0]).toBe('credit.settlement.payout_initiated');
  });

  test('falls back to the owner personal Connect account when the business has none', async () => {
    businessRow = null;
    connectAccountRows = [{ stripe_account_id: 'acct_owner_1' }];

    await initiateSettlementPayout({
      settlementId: SETTLEMENT_ID,
      actorUserId: ADMIN_ID,
      idempotencyKey: 'payout-attempt-2',
      requestIp: '203.0.113.9',
    });

    const [transferArgs] = stripeInstance.transfers.create.mock.calls[0];
    expect(transferArgs.destination).toBe('acct_owner_1');
  });

  test('throws 409 credit_settlement_payout_no_connected_account when no Stripe account exists', async () => {
    businessRow = null;
    connectAccountRows = [];

    const err = await initiateSettlementPayout({
      settlementId: SETTLEMENT_ID,
      actorUserId: ADMIN_ID,
      idempotencyKey: 'payout-attempt-3',
      requestIp: '203.0.113.9',
    }).catch((e) => e);

    expect(err.status || err.statusCode).toBe(409);
    expect(err.code).toBe('credit_settlement_payout_no_connected_account');
    expect(stripeInstance.transfers.create).not.toHaveBeenCalled();
  });

  test('rejects non-approved settlements', async () => {
    settlementRow = baseSettlementRow({ status: 'pending' });
    const err = await initiateSettlementPayout({
      settlementId: SETTLEMENT_ID, actorUserId: ADMIN_ID, idempotencyKey: 'k1', requestIp: '203.0.113.9',
    }).catch((e) => e);
    expect(err.code).toBe('credit_settlement_payout_not_approved');
    expect(stripeInstance.transfers.create).not.toHaveBeenCalled();
  });

  test('rejects zero-net settlements', async () => {
    settlementRow = baseSettlementRow({ net_cents: 0 });
    const err = await initiateSettlementPayout({
      settlementId: SETTLEMENT_ID, actorUserId: ADMIN_ID, idempotencyKey: 'k2', requestIp: '203.0.113.9',
    }).catch((e) => e);
    expect(err.code).toBe('credit_settlement_payout_zero_net');
    expect(stripeInstance.transfers.create).not.toHaveBeenCalled();
  });

  test('rejects a second initiation with 409 state conflict', async () => {
    settlementRow = baseSettlementRow({ payout_status: 'initiated', stripe_transfer_id: TRANSFER_ID });
    const err = await initiateSettlementPayout({
      settlementId: SETTLEMENT_ID, actorUserId: ADMIN_ID, idempotencyKey: 'k3', requestIp: '203.0.113.9',
    }).catch((e) => e);
    expect(err.code).toBe('credit_settlement_payout_state_conflict');
    expect(stripeInstance.transfers.create).not.toHaveBeenCalled();
  });

  test('fails closed with 503 credit_stripe_unavailable when the Stripe key is unset', async () => {
    const saved = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    try {
      const err = await initiateSettlementPayout({
        settlementId: SETTLEMENT_ID, actorUserId: ADMIN_ID, idempotencyKey: 'k4', requestIp: '203.0.113.9',
      }).catch((e) => e);
      expect(err.status || err.statusCode).toBe(503);
      expect(err.code).toBe('credit_stripe_unavailable');
    } finally {
      process.env.STRIPE_SECRET_KEY = saved;
    }
  });
});

describe('confirmSettlementPayoutFromTransfer', () => {
  function initiatedSettlement() {
    settlementRow = baseSettlementRow({
      stripe_transfer_id: TRANSFER_ID,
      payout_status: 'initiated',
      payout_initiated_by: ADMIN_ID,
    });
  }

  test('marks the settlement paid with a verified stripe_transfer reference and posts the settlement journal', async () => {
    initiatedSettlement();

    const result = await confirmSettlementPayoutFromTransfer(TRANSFER_ID);

    expect(result.settlement.status).toBe('paid');
    expect(result.settlement.paymentReference).toBe(`stripe_transfer:${TRANSFER_ID}`);
    expect(result.paymentReference).toBe(`stripe_transfer:${TRANSFER_ID}`);
    expect(stripeInstance.transfers.retrieve).toHaveBeenCalledWith(TRANSFER_ID);

    const journalInsert = mockQuery.mock.calls.find(([sql]) => sql.includes('INSERT INTO oxsteed_credit_transactions'));
    expect(journalInsert).toBeDefined();
    expect(journalInsert[1][0]).toBe('settlement');

    const payoutUpdate = mockQuery.mock.calls.find(
      ([sql]) => sql.includes('UPDATE oxsteed_credit_settlements') && sql.includes("payout_status = 'paid'")
    );
    expect(payoutUpdate).toBeDefined();
  });

  test('replay of a confirmation is an idempotent no-op', async () => {
    settlementRow = baseSettlementRow({ stripe_transfer_id: TRANSFER_ID, payout_status: 'paid', status: 'paid', payment_reference: `stripe_transfer:${TRANSFER_ID}` });

    const result = await confirmSettlementPayoutFromTransfer(TRANSFER_ID);

    expect(result.ignored).toBe(true);
    expect(result.replayed).toBe(true);
    expect(stripeInstance.transfers.retrieve).not.toHaveBeenCalled();
  });

  test('returns ignored for an unknown transfer id', async () => {
    settlementRow = null;
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return { rows: [] };
      if (s.includes('FROM feature_flags')) return { rows: [{ is_enabled: true }] };
      if (s.includes('FROM oxsteed_credit_rail_freezes')) return { rows: [] };
      return { rows: [] };
    });

    const result = await confirmSettlementPayoutFromTransfer('tr_unknown');
    expect(result).toEqual({ ignored: true });
  });

  test('throws when the Stripe API verification fails (fail closed)', async () => {
    initiatedSettlement();
    stripeInstance.transfers.retrieve.mockRejectedValue(new Error('stripe down'));

    const err = await confirmSettlementPayoutFromTransfer(TRANSFER_ID).catch((e) => e);
    expect(err.code).toBe('credit_settlement_payout_verification_failed');

    const statusUpdate = mockQuery.mock.calls.find(([sql]) => sql.includes("status = 'paid'"));
    expect(statusUpdate).toBeUndefined();
  });

  test('throws when the transfer amount does not match the settlement net', async () => {
    initiatedSettlement();
    stripeInstance.transfers.retrieve.mockResolvedValue({ id: TRANSFER_ID, amount: 9999, currency: 'usd', reversed: false, metadata: { oxsteed_credit_settlement_id: SETTLEMENT_ID } });

    const err = await confirmSettlementPayoutFromTransfer(TRANSFER_ID).catch((e) => e);
    expect(err.code).toBe('credit_settlement_payout_verification_mismatch');
  });

  test('a reversed transfer sets payout_status failed and raises a critical incident', async () => {
    initiatedSettlement();
    stripeInstance.transfers.retrieve.mockResolvedValue({ id: TRANSFER_ID, amount: 5000, currency: 'usd', reversed: true, metadata: { oxsteed_credit_settlement_id: SETTLEMENT_ID } });

    const result = await confirmSettlementPayoutFromTransfer(TRANSFER_ID);

    expect(result.payoutStatus).toBe('failed');
    const failedUpdate = mockQuery.mock.calls.find(
      ([sql]) => sql.includes('UPDATE oxsteed_credit_settlements') && sql.includes("payout_status = 'failed'")
    );
    expect(failedUpdate).toBeDefined();

    const incidentInsert = mockQuery.mock.calls.find(([sql]) => sql.includes('INSERT INTO incident_log'));
    expect(incidentInsert).toBeDefined();
    expect(incidentInsert[1][0]).toBe('oxsteed_credit_settlement_payout_failed');
    expect(incidentInsert[1][1]).toBe('critical');
    expect(incidentInsert[1][4]).toBe(`credit-settlement-payout-failed:${SETTLEMENT_ID}`);
  });
});

describe('failSettlementPayoutFromTransfer', () => {
  test('records failure, incident, and audit event', async () => {
    settlementRow = baseSettlementRow({ stripe_transfer_id: TRANSFER_ID, payout_status: 'initiated', payout_initiated_by: ADMIN_ID });

    const result = await failSettlementPayoutFromTransfer(TRANSFER_ID, 'transfer_failed');

    expect(result.payoutStatus).toBe('failed');
    expect(result.requiresManualReversal).toBe(false);
    const incidentInsert = mockQuery.mock.calls.find(([sql]) => sql.includes('INSERT INTO incident_log'));
    expect(incidentInsert).toBeDefined();
    expect(incidentInsert[1][1]).toBe('critical');
    const auditCall = mockQuery.mock.calls.find(
      ([sql, params]) => sql.includes('oxsteed_credit_audit_events') && params && params[0] === 'credit.settlement.payout_failed'
    );
    expect(auditCall).toBeDefined();
  });

  test('does not overwrite an already-paid payout and flags manual reversal', async () => {
    settlementRow = baseSettlementRow({ stripe_transfer_id: TRANSFER_ID, payout_status: 'paid', status: 'paid' });

    const result = await failSettlementPayoutFromTransfer(TRANSFER_ID, 'transfer_failed');

    expect(result.payoutStatus).toBe('paid');
    expect(result.requiresManualReversal).toBe(true);
    const failedUpdate = mockQuery.mock.calls.find(
      ([sql]) => sql.includes('UPDATE oxsteed_credit_settlements') && sql.includes("payout_status = 'failed'")
    );
    expect(failedUpdate).toBeUndefined();
    const incidentInsert = mockQuery.mock.calls.find(([sql]) => sql.includes('INSERT INTO incident_log'));
    expect(incidentInsert).toBeDefined();
  });

  test('is idempotent on an already-failed payout', async () => {
    settlementRow = baseSettlementRow({ stripe_transfer_id: TRANSFER_ID, payout_status: 'failed' });

    const result = await failSettlementPayoutFromTransfer(TRANSFER_ID, 'transfer_failed');
    expect(result).toMatchObject({ ignored: true, replayed: true });
  });
});
