'use strict';

// Review W3 (P2-478, P2-479, P2-480, P2-481) controller behaviour.
const { mockQuery, resetMocks } = require('./setup');
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue(undefined),
  sendBulkNotification: jest.fn().mockResolvedValue(undefined),
}));
const { sendNotification } = require('../services/notificationService');
const jobController = require('../controllers/jobController');
const bidController = require('../controllers/bidController');

const res = () => {
  const r = {};
  r.status = jest.fn(() => r);
  r.json = jest.fn(() => r);
  return r;
};

beforeEach(() => { resetMocks(); sendNotification.mockClear(); });

describe('helper completion (P2-478)', () => {
  test('a helper on a protected job with an authorized payment requests confirmation instead of completing', async () => {
    const job = { id: 'j1', client_id: 'c1', assigned_helper_id: 'h1', status: 'in_progress', transaction_mode: 'guided_protected', title: 'Fence' };
    mockQuery
      .mockResolvedValueOnce({ rows: [job], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'p1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ ...job, completion_requested_at: 'now', completion_auto_confirm_at: 'later' }], rowCount: 1 });
    const r = res(); const next = jest.fn();
    await jobController.completeJob({ params: { id: 'j1' }, user: { id: 'h1' } }, r, next);
    expect(next).not.toHaveBeenCalled();
    expect(r.status).toHaveBeenCalledWith(202);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ pending_confirmation: true }));
    expect(mockQuery.mock.calls.some(([sql]) => /SET status = 'completed'/.test(sql))).toBe(false);
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: 'c1', type: 'job_completion_requested' }));
  });

  test('the auto-confirm sweep skips jobs with any open, under-review or in-progress dispute', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await jobController.autoConfirmHelperCompletions();
    expect(mockQuery.mock.calls[0][0]).toMatch(/'open', 'in_progress', 'under_review'/);
  });
});

test('GET /jobs/me/list?role=helper lists assigned jobs without the client\'s private notes (P2-479)', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
  const r = res();
  await jobController.getMyJobs({ query: { role: 'helper' }, user: { id: 'h1' }, headers: {} }, r, jest.fn());
  const [sql, params] = mockQuery.mock.calls[0];
  expect(sql).toMatch(/WHERE assigned_helper_id = \$1/);
  expect(sql).toMatch(/NULL::text AS private_notes/);
  expect(params[0]).toBe('h1');
});

describe('bid edit validation (P2-480)', () => {
  test.each([
    [{ amount: -5 }, 'amount'],
    [{ amount: 20_000_000 }, 'amount'],
    [{ message: '   ' }, 'message'],
    [{ eta_hours: 0 }, 'eta_hours'],
  ])('%j is rejected', async (body, field) => {
    const next = jest.fn();
    await bidController.updateBid({ params: { id: 'b1' }, user: { id: 'h1' }, body }, res(), next);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 400 });
    expect(next.mock.calls[0][0].details || next.mock.calls[0][0].fields || {}).toHaveProperty(field);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('a bid on a job that stopped accepting bids cannot be edited', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ job_id: 'j1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'j1', status: 'accepted', revision: 1 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'b1', helper_id: 'h1', status: 'pending', job_revision: 1 }], rowCount: 1 });
    const next = jest.fn();
    await bidController.updateBid({ params: { id: 'b1' }, user: { id: 'h1' }, body: { amount: 50 } }, res(), next);
    expect(next.mock.calls[0][0]).toMatchObject({ code: 'job_not_accepting_bids' });
  });
});

test('instant payouts draw from instant_available (P2-481)', () => {
  const src = require('fs').readFileSync(require.resolve('../controllers/paymentController.js'), 'utf8');
  expect(src).toMatch(/balance\.instant_available/);
  expect(src).toMatch(/exports\.getPayoutBalance/);
  expect(require('fs').readFileSync(require.resolve('../routes/payments.js'), 'utf8')).toMatch(/\/payout\/balance/);
});
