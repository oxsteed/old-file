'use strict';
const { resetMocks } = require('./setup');
const mockRefundSpy = jest.fn(async () => ({ id: 'refund-txn' }));
jest.mock('../services/oxsteedCreditService', () => ({
  ...jest.requireActual('../services/oxsteedCreditService'),
  refundCreditForReferenceInTransaction: (...args) => mockRefundSpy(...args),
}));
const directController = require('../controllers/directController');

beforeEach(() => { resetMocks(); mockRefundSpy.mockClear(); });

describe('Direct cancel refunds (P1-176)', () => {
  const refund = directController._refundDirectPaymentOnCancel;

  test('credit-paid request is refunded against the original spend', async () => {
    const out = await refund({ id: 42, payment_status: 'paid', payment_method: 'oxsteed_credit', quote_amount_cents: 5000 }, { id: 'u' }, 'changed plans');
    expect(mockRefundSpy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      referenceType: 'direct_quote', referenceId: '42', amountCents: 5000, idempotencyKey: 'direct:cancel-refund:42',
    }));
    expect(out.paymentStatus).toBe('refunded');
  });

  test('off-platform payment is flagged for a manual refund', async () => {
    const out = await refund({ id: 7, payment_status: 'confirmed', payment_method: 'zelle' }, { id: 'u' });
    expect(mockRefundSpy).not.toHaveBeenCalled();
    expect(out.metadata.refundRequired).toBe(true);
  });

  test('unpaid request needs nothing', async () => {
    expect(await refund({ id: 7, payment_status: 'unpaid' }, { id: 'u' })).toEqual({});
  });
});
