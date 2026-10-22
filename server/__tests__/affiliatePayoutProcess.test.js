'use strict';

// Review P3-787: affiliate payouts are admin-only Connect transfers that end
// completed or failed (with commissions re-queued), never stuck processing.
const { mockQuery, resetMocks } = require('./setup');

const mockTransfers = { create: jest.fn() };
jest.mock('stripe', () => () => ({ transfers: mockTransfers }));
jest.mock('../services/auditService', () => ({ logAdminAction: jest.fn().mockResolvedValue({}) }));
jest.mock('../services/sanctionsScreeningService', () => ({ assertSanctionsClear: jest.fn().mockResolvedValue({ cleared: false }) }));

const { processPayout } = require('../controllers/affiliatePayoutsController');

function route(handlers) {
  mockQuery.mockImplementation(async (sql, params) => {
    const t = String(sql);
    for (const [re, v] of handlers) if (re.test(t)) return typeof v === 'function' ? v(params) : v;
    return { rows: [] };
  });
}

const base = [
  [/FROM affiliate_payouts ap\s+JOIN affiliate_programs/, { rows: [{ id: 7, affiliate_program_id: 3, owner_id: 'owner', status: 'pending', total_commission_cents: 1500 }] }],
  [/FROM users\s+WHERE id =/, { rows: [{ w9_completed: true, didit_status: 'verified', didit_verified_at: new Date().toISOString() }] }],
  [/FROM connect_accounts/, { rows: [{ stripe_account_id: 'acct_owner', payouts_enabled: true }] }],
  [/SET status = 'processing'/, { rows: [{ id: 7, total_commission_cents: 1500 }] }],
  // Money-flows audit: the affiliate payout entry honors the credit-rail
  // kill switch. The rail reads as enabled and unfrozen here.
  [/FROM feature_flags/, { rows: [{ is_enabled: true }] }],
  [/FROM oxsteed_credit_rail_freezes/, { rows: [] }],
];

beforeEach(() => { resetMocks(); mockTransfers.create.mockReset(); });

test('transfers to the owner Connect account and completes the payout', async () => {
  route([...base, [/SET status = 'completed'/, { rows: [{ id: 7, status: 'completed' }] }]]);
  mockTransfers.create.mockResolvedValue({ id: 'tr_1' });
  const res = { json: jest.fn() }; const next = jest.fn();
  await processPayout({ user: { id: 'admin' }, params: { payoutId: 7 } }, res, next);
  expect(next).not.toHaveBeenCalled();
  expect(mockTransfers.create).toHaveBeenCalledWith(
    expect.objectContaining({ amount: 1500, destination: 'acct_owner' }),
    // Money-flows audit: canonical per-payout Stripe idempotency key shared
    // with the legacy admin payout route, so a crash-after-accept
    // re-claimed by the other route dedupes at Stripe.
    { idempotencyKey: 'affiliate-payout:7' }
  );
  expect(mockQuery.mock.calls.some(([s]) => /affiliate_commissions SET status = 'paid'/.test(s))).toBe(true);
  // Money-flows audit: the transfer is recorded in payout_transactions like
  // the legacy admin route, keyed on the canonical idempotency key.
  const txnInsert = mockQuery.mock.calls.find(([s]) => /INSERT INTO payout_transactions/.test(s));
  expect(txnInsert).toBeDefined();
  expect(txnInsert[1]).toEqual([7, 'affiliate-payout:7', 'tr_1']);
  expect(res.json).toHaveBeenCalledWith({ success: true, data: { id: 7, status: 'completed' } });
});

test('a failed transfer marks the payout failed and re-queues commissions', async () => {
  route(base);
  mockTransfers.create.mockRejectedValue(new Error('insufficient funds'));
  const next = jest.fn();
  await processPayout({ user: { id: 'admin' }, params: { payoutId: 7 } }, { json: jest.fn() }, next);
  expect(next.mock.calls[0][0].code).toBe('stripe_error');
  expect(mockQuery.mock.calls.some(([s]) => /SET status = 'failed'/.test(s))).toBe(true);
  expect(mockQuery.mock.calls.some(([s]) => /affiliate_commissions SET status = 'pending', payout_id = NULL/.test(s))).toBe(true);
});

test('no payout-ready account: refuses before claiming', async () => {
  route([base[0], [/FROM connect_accounts/, { rows: [] }]]);
  const next = jest.fn();
  await processPayout({ user: { id: 'admin' }, params: { payoutId: 7 } }, { json: jest.fn() }, next);
  expect(next.mock.calls[0][0].code).toBe('no_payout_account');
  expect(mockTransfers.create).not.toHaveBeenCalled();
});

test('requires fresh identity before claiming an affiliate payout', async () => {
  route([
    base[0],
    [/FROM connect_accounts/, { rows: [{ stripe_account_id: 'acct_owner', payouts_enabled: true }] }],
    [/FROM users/, { rows: [{ w9_completed: true, didit_status: 'verified', didit_verified_at: '2020-01-01T00:00:00.000Z' }] }],
  ]);
  const next = jest.fn();
  await processPayout({ user: { id: 'admin' }, params: { payoutId: 7 } }, { json: jest.fn() }, next);
  expect(next.mock.calls[0][0].code).toBe('affiliate_tax_identity_required');
  expect(mockTransfers.create).not.toHaveBeenCalled();
});

test('the payout entry fails closed when the credit rail is off', async () => {
  route([
    base[0],
    base[1],
    base[2],
    base[3],
    [/FROM feature_flags/, { rows: [{ is_enabled: false }] }],
    [/FROM oxsteed_credit_rail_freezes/, { rows: [] }],
  ]);
  const next = jest.fn();
  await processPayout({ user: { id: 'admin' }, params: { payoutId: 7 } }, { json: jest.fn() }, next);
  expect(next.mock.calls[0][0].code).toBe('credit_rail_suspended');
  expect(mockTransfers.create).not.toHaveBeenCalled();
});

test('the route requires an admin with the financials grant', () => {
  const src = require('fs').readFileSync(require.resolve('../routes/affiliatePayouts.js'), 'utf8');
  expect(src).toMatch(/'\/:payoutId\/process',\s*requireAdmin,\s*rejectImpersonated,\s*requirePermission\('view_financials'\)/);
});

test('ADM-040: the process route blocks impersonated sessions', () => {
  const src = require('fs').readFileSync(require.resolve('../routes/affiliatePayouts.js'), 'utf8');
  expect(src).toMatch(/'\/:payoutId\/process',[^;]*rejectImpersonated/);
});
