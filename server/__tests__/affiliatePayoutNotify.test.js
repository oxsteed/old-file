'use strict';

// Notifications audit item 54: affiliate payout processing and voiding
// notified nobody (zero notify calls in the controller, the void service,
// and the batch paths).
// Reproduction: a completed payout sends no affiliate notice, and a
// refund-void sends no void notice.

const { mockQuery, resetMocks } = require('./setup');

const mockTransfers = { create: jest.fn() };
jest.mock('stripe', () => () => ({ transfers: mockTransfers }));
jest.mock('../services/auditService', () => ({ logAdminAction: jest.fn().mockResolvedValue({}) }));
jest.mock('../services/sanctionsScreeningService', () => ({ assertSanctionsClear: jest.fn().mockResolvedValue({ cleared: false }) }));
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue({ success: true }),
}));

const { sendNotification } = require('../services/notificationService');
const { processPayout } = require('../controllers/affiliatePayoutsController');
const { voidClaimedCommissionsForRefund, notifyVoidedAffiliates } = require('../services/affiliatePayoutVoidOnRefund');
const { tNotif } = require('../utils/i18n');

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
  [/FROM feature_flags/, { rows: [{ is_enabled: true }] }],
  [/FROM oxsteed_credit_rail_freezes/, { rows: [] }],
];

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  mockTransfers.create.mockReset();
});

test('a completed affiliate payout notifies the affiliate (in-app + email leg)', async () => {
  route([...base, [/SET status = 'completed'/, { rows: [{ id: 7, status: 'completed' }] }]]);
  mockTransfers.create.mockResolvedValue({ id: 'tr_1' });
  const res = { json: jest.fn() };
  const next = jest.fn();
  await processPayout({ user: { id: 'admin' }, params: { payoutId: 7 } }, res, next);
  expect(next).not.toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledWith({ success: true, data: { id: 7, status: 'completed' } });
  expect(sendNotification).toHaveBeenCalledTimes(1);
  expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
    userId: 'owner',
    type: 'affiliate_payout_processed',
    action_url: '/affiliate',
    idempotencyKey: 'affiliate-payout:processed:7',
  }));
  expect(sendNotification.mock.calls[0][0].data).toMatchObject({
    payout_id: 7,
    amount_cents: 1500,
    transfer_id: 'tr_1',
  });
});

test('a failed transfer sends no payout-processed notice', async () => {
  route(base);
  mockTransfers.create.mockRejectedValue(new Error('insufficient funds'));
  const next = jest.fn();
  await processPayout({ user: { id: 'admin' }, params: { payoutId: 7 } }, { json: jest.fn() }, next);
  expect(next.mock.calls[0][0].code).toBe('stripe_error');
  expect(sendNotification).not.toHaveBeenCalled();
});

test('a refund-void notifies the affiliate whose commissions were voided', async () => {
  const client = { query: jest.fn() };
  client.query.mockImplementation(async (sql) => {
    const t = String(sql);
    if (t.includes('FOR UPDATE OF ap')) return { rows: [{ payout_id: 7 }] };
    if (t.includes('UPDATE affiliate_commissions ac')) {
      return { rows: [{ id: 11, commission_cents: 500, payout_id: 7, affiliate_program_id: 3 }] };
    }
    return { rows: [], rowCount: 1 };
  });
  const result = await voidClaimedCommissionsForRefund(client, 42);
  expect(result.voidedCount).toBe(1);
  expect(result.payouts).toEqual([{ payoutId: 7, programId: 3, voidedCents: '500', voidedCount: 1 }]);

  route([[/FROM affiliate_programs/, { rows: [{ helper_id: 'owner' }] }]]);
  await notifyVoidedAffiliates(result);
  expect(sendNotification).toHaveBeenCalledTimes(1);
  expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
    userId: 'owner',
    type: 'affiliate_payout_voided',
    action_url: '/affiliate',
    idempotencyKey: 'affiliate-payout:voided:7:42',
  }));
  expect(sendNotification.mock.calls[0][0].data).toMatchObject({
    payout_id: 7,
    voided_cents: 500,
    voided_count: 1,
    order_id: 42,
  });
});

test('no voided commissions means no void notice', async () => {
  const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
  const result = await voidClaimedCommissionsForRefund(client, 42);
  expect(result.voidedCount).toBe(0);
  await notifyVoidedAffiliates(result);
  expect(sendNotification).not.toHaveBeenCalled();
});

test('both affiliate payout notice types have copy in every language', () => {
  for (const type of ['affiliate_payout_processed', 'affiliate_payout_voided']) {
    for (const lang of ['en', 'es', 'fr', 'ht', 'ar']) {
      const text = tNotif(type, lang, { amount: '$15.00', payoutId: 7 });
      expect(text.title).toBeTruthy();
      expect(text.body).toBeTruthy();
    }
  }
});
