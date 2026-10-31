'use strict';
const { mockQuery, resetMocks } = require('./setup');
jest.mock('../utils/email', () => ({ sendEmail: jest.fn() }));
const { hardDeleteUser, hardDeleteExpiredAccounts } = require('../jobs/scheduledDeletionJob');
const payout = require('../services/deliveryDriverPayoutService');
const ccpa = require('../services/ccpaErasureService');
const { sendCCPANotification } = require('../controllers/ccpaController');
const { sendEmail } = require('../utils/email');
const refresh = require('../services/cancellationStatsRefresh');
const superAdmin = require('../controllers/superAdminController');
const investor = require('../controllers/investorController');
beforeEach(() => { resetMocks(); sendEmail.mockReset(); });
const userId = '11111111-1111-4111-8111-111111111111';

test('hard delete refuses food-wallet value before any erasure, even without Credit records', async () => {
  mockQuery.mockImplementation(async sql => {
    if (sql.includes('to_regclass')) return { rows: [{ t: 'food_customer_wallet_accounts' }] };
    if (sql.includes('FROM food_customer_wallet_accounts')) return { rows: [{ balance: '2500' }] };
    return { rows: [{ n: 0, balance: 0, reserved: 0 }] };
  });
  await expect(hardDeleteUser({ id: userId }, { throwOnError: true })).rejects.toMatchObject({ code: 'account_financial_review', statusCode: 409 });
  expect(mockQuery.mock.calls.some(([sql]) => sql.includes('DELETE FROM'))).toBe(false);
  expect(mockQuery.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
});

test.each(['food_customer_wallet_accounts', 'food_restaurants', 'money_movement_approvals', 'restaurant_payouts'])('retains identity for %s history after balances are zero', async table => {
  mockQuery.mockImplementation(async (sql, params) => {
    if (sql.includes('information_schema.tables')) return { rows: [{ exists: params[0] === table }] };
    if (sql.includes('AS has_credit_records')) return { rows: [{ has_credit_records: true }] };
    return { rows: [], rowCount: 0 };
  });
  await hardDeleteUser({ id: userId }, { throwOnError: true });
  expect(mockQuery.mock.calls.some(([sql]) => sql.includes('DELETE FROM users'))).toBe(false);
  expect(mockQuery.mock.calls.some(([sql]) => sql.includes("email = CONCAT('deleted_'"))).toBe(true);
});

test('scheduled deletion drains the second page after the first 50, including blocked candidates', async () => {
  const candidates = Array.from({ length: 60 }, (_, i) => ({ id: `11111111-1111-4111-8111-${String(i).padStart(12,'0')}`, deletion_scheduled_at: '2026-10-01T00:00:00Z', remaining_due: 60 }));
  let pages = 0;
  mockQuery.mockImplementation(async sql => {
    if (sql.includes('COUNT(*) OVER()')) return { rows: pages++ === 0 ? candidates.slice(0,50) : candidates.slice(50) };
    return { rows: [] };
  });
  await hardDeleteExpiredAccounts();
  expect(pages).toBe(2);
  expect(mockQuery.mock.calls.filter(([sql]) => sql === 'BEGIN')).toHaveLength(60);
});

test('paid payout replay preserves the first payment reference and timestamp', async () => {
  const row = { id: 1, status: 'paid', payment_reference: 'first', paid_at: 'original' };
  const client = { query: jest.fn().mockResolvedValue({ rows: [row] }) };
  expect(await payout.markPayoutPaid(client, 1, userId, 'first')).toEqual(row);
  expect(client.query).toHaveBeenCalledTimes(1);
  expect(client.query.mock.calls[0][0]).toContain('FOR UPDATE');
  await expect(payout.markPayoutPaid(client, 1, userId, 'other')).rejects.toMatchObject({ statusCode: 409 });
});

test('payout writes require the previously locked source status', async () => {
  // Fixture carries a recorded approver: a null approver now fails closed
  // with approver_unknown before the UPDATE (audit item 8), so the
  // status-guard assertion below needs a normally-approved row.
  const client = { query: jest.fn().mockResolvedValueOnce({ rows: [{ status: 'approved', approved_by_user_id: 'approver-1' }] }).mockResolvedValueOnce({ rows: [] }) };
  await expect(payout.markPayoutPaid(client, 1, userId, 'ref')).rejects.toMatchObject({ statusCode: 409 });
  expect(client.query.mock.calls[1][0]).toContain("AND status = 'approved'");
});

test('access requests cannot be completed with a status-only update', async () => {
  mockQuery.mockImplementation(async sql => ({ rows: sql.includes('SELECT * FROM ccpa_data_requests') ? [{ id: 5, status: 'pending', request_type: 'access' }] : [] }));
  await expect(ccpa.completeRequest(5, userId)).rejects.toMatchObject({ code: 'ccpa_data_delivery_required' });
  expect(mockQuery.mock.calls.some(([sql]) => sql.includes("status='completed'"))).toBe(false);
});

test('data delivery is recorded only after provider acceptance and binds the delivered data hash', async () => {
  mockQuery.mockImplementation(async sql => {
    if (sql.includes('SELECT * FROM ccpa_data_requests')) return { rows: [{ id: 5, user_id: userId, status: 'processing', request_type: 'access', email: 'fixture@example.invalid' }] };
    if (sql.includes('FROM users WHERE')) return { rows: [{ id: userId, email: 'fixture@example.invalid', preferred_language: 'fr' }] };
    return { rows: [] };
  });
  const req = { params: { requestId: 5 }, body: { attachData: true }, user: { id: 'admin' } };
  const res = { json: jest.fn() }, next = jest.fn();
  sendEmail.mockResolvedValue({ success: false });
  await sendCCPANotification(req, res, next);
  expect(mockQuery.mock.calls.some(([sql]) => sql.includes('jsonb_set'))).toBe(false);
  next.mockClear();
  sendEmail.mockResolvedValue({ success: true, id: 'provider-test-id' });
  await sendCCPANotification(req, res, next);
  expect(next).not.toHaveBeenCalled();
  const receipt = mockQuery.mock.calls.find(([sql]) => sql.includes('jsonb_set'));
  expect(JSON.parse(receipt[1][1])).toMatchObject({ status: 'accepted', provider_reference: 'provider-test-id', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
});

test('failed cancellation refresh never advances the refresh timestamp', async () => {
  const client = { query: jest.fn().mockRejectedValue(new Error('refresh failed')) };
  await expect(refresh.refresh(client)).rejects.toThrow('refresh failed');
  expect(client.query).toHaveBeenCalledTimes(1);
});

test.each([['admin',superAdmin],['investor',investor]])('%s revenue chart cannot mix currencies', async (_name, controller) => {
  mockQuery.mockImplementation(async sql => ({ rows: sql.includes('information_schema.tables') ? [{ exists: true }] : [] }));
  const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
  await controller.getRevenueChart({ query: { currency: 'EUR' } },res);
  const chart = mockQuery.mock.calls.find(([sql]) => sql.includes('date_trunc($1, created_at)'));
  expect(chart[0]).toContain('UPPER(currency) = UPPER($3)');
  expect(chart[1][2].toUpperCase()).toBe('EUR');
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ currency: expect.stringMatching(/^eur$/i) }));
  mockQuery.mockClear();
  await controller.getRevenueChart({ query: { currency: 'USD,EUR' } },res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(mockQuery).not.toHaveBeenCalled();
});
