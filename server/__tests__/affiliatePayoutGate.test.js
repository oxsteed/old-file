'use strict';

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/auditService', () => ({ logAdminAction: jest.fn().mockResolvedValue({}) }));

const dualApproval = require('../services/dualApprovalService');
const Payout = require('../controllers/PayoutController');

beforeEach(() => {
  resetMocks();
  process.env.PAYOUT_PROCESSOR_ENABLED = 'true';
  jest.spyOn(dualApproval, 'requestMoneyMovementApproval').mockResolvedValue({
    queued: true,
    approval: {
      id: 4,
      status: 'pending',
      amount_cents: 1400,
      movement_type: 'affiliate_payout',
      reference_key: 'affiliate-payout:9',
    },
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('legacy payout gate queues the payable net and binds the checker to it', async () => {
  mockQuery.mockImplementation(async (sql) => {
    if (/SELECT ap\.\*/.test(sql)) {
      return {
        rows: [{
          id: 9,
          status: 'pending',
          helper_id: 'helper',
          net_payout_cents: 1400,
          total_commission_cents: 1500,
          processor_fee_cents: 100,
        }],
      };
    }
    return { rows: [] };
  });
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  await Payout.processPayout({
    user: { id: 'admin' },
    params: { payout_id: 9 },
    get: () => 'synthetic-payout-key',
    body: { payment_processor: 'stripe' },
  }, res);

  expect(dualApproval.requestMoneyMovementApproval).toHaveBeenCalledWith(expect.objectContaining({
    movementType: 'affiliate_payout',
    referenceKey: 'affiliate-payout:9',
    amountCents: 1400,
    payload: expect.objectContaining({ payoutId: 9, expectedAmountCents: 1400 }),
  }));
  expect(res.status).toHaveBeenCalledWith(202);
});
