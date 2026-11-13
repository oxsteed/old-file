'use strict';

// Review P3-821: main-app payment disputes have an admin lifecycle.
const { mockQuery, resetMocks } = require('./setup');
const mockSend = jest.fn().mockResolvedValue({});
jest.mock('../services/notificationService', () => ({ sendNotification: (...a) => mockSend(...a) }));
const mockAudit = jest.fn().mockResolvedValue({});
jest.mock('../services/auditService', () => ({ logAdminAction: (...a) => mockAudit(...a) }));

const ctrl = require('../controllers/paymentDisputeAdminController');

const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });
beforeEach(() => { resetMocks(); mockSend.mockClear(); mockAudit.mockClear(); });

function route(current) {
  mockQuery.mockImplementation(async (sql) => {
    if (/FOR UPDATE/.test(sql)) return { rows: current ? [current] : [] };
    if (/UPDATE main_app_payment_disputes/.test(sql)) return { rows: [{ ...current, status: 'approved' }] };
    return { rows: [] };
  });
}

test('an open dispute can be approved; audited and the filer is notified', async () => {
  route({ id: 4, status: 'open', user_id: 'u1' });
  const r = res();
  await ctrl.decidePaymentDispute({ params: { id: '4' }, body: { status: 'approved', note: 'Refunded via job payment tools', refundReference: 're_test_1' }, user: { id: 'admin' } }, r, jest.fn());
  expect(r.status).toHaveBeenCalledWith(200);
  expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'payment_dispute_decision', throwOnError: true }));
  expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', type: 'payment_dispute_updated' }));
});

test('terminal disputes cannot be reopened', async () => {
  route({ id: 4, status: 'denied', user_id: 'u1' });
  const r = res();
  await ctrl.decidePaymentDispute({ params: { id: '4' }, body: { status: 'approved', note: 'x', refundReference: 're_test_1' }, user: { id: 'admin' } }, r, jest.fn());
  expect(r.status).toHaveBeenCalledWith(409);
  expect(mockSend).not.toHaveBeenCalled();
});

// Finding 37: a closure decision with neither a refund reference nor an
// explicit no-refund reason is rejected before the row is stamped.
test('an approved decision needs a refund reference or a no-refund reason', async () => {
  route({ id: 4, status: 'open', user_id: 'u1' });
  const r = res();
  await ctrl.decidePaymentDispute({ params: { id: '4' }, body: { status: 'approved', note: 'Closing' }, user: { id: 'admin' } }, r, jest.fn());
  expect(r.status).toHaveBeenCalledWith(400);
  expect(mockSend).not.toHaveBeenCalled();
});

test('an approved decision with a no-refund reason closes without a refund', async () => {
  route({ id: 4, status: 'open', user_id: 'u1' });
  const r = res();
  await ctrl.decidePaymentDispute({ params: { id: '4' }, body: { status: 'approved', note: 'Closing', noRefundReason: 'Duplicate claim, already refunded on the order' }, user: { id: 'admin' } }, r, jest.fn());
  expect(r.status).toHaveBeenCalledWith(200);
  expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', type: 'payment_dispute_updated' }));
});

test('a decision note is required', async () => {
  const r = res();
  await ctrl.decidePaymentDispute({ params: { id: '4' }, body: { status: 'approved' }, user: { id: 'admin' } }, r, jest.fn());
  expect(r.status).toHaveBeenCalledWith(400);
  expect(mockQuery).not.toHaveBeenCalled();
});

test('routes are admin-only with the disputes grant, and closing decisions carry impersonation + limiter + step-up guards', () => {
  const src = require('fs').readFileSync(require.resolve('../routes/admin.js'), 'utf8');
  expect(src).toMatch(/'\/payment-disputes\/:id\/decision', requireAdmin, rejectImpersonated, requirePermission\('manage_disputes'\), strictLimiter, requireAdminActionStepupIf\(/);
  expect(src).toMatch(/'\/payment-disputes\/stepup-challenges', requireAdmin, rejectImpersonated, requirePermission\('manage_disputes'\), strictLimiter, issueAdminActionStepup\('payment_dispute_decision', resolveDisputeAmountCents\)/);
});
