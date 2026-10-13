'use strict';

// Review P1-3-F07: the proposal-sign timeout worker.

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/notificationService', () => ({ sendNotification: jest.fn().mockResolvedValue({ success: true }) }));

const { activateTimedOutProposals } = require('../jobs/workAgreementProposalTimeout');

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

test('activates timed-out proposals and notifies both parties', async () => {
  const row = { id: 'a1', job_id: 'j1', helper_id: 'h1', customer_id: 'c1', version_id: 'v1', created_by: 'h1' };
  mockQuery
    .mockResolvedValueOnce({ rows: [row] })   // candidate SELECT
    .mockResolvedValueOnce({ rowCount: 1 });  // UPDATE status -> active

  const result = await activateTimedOutProposals(7);

  expect(result).toEqual({ checked: 1, activated: 1 });
  expect(String(mockQuery.mock.calls[1][0])).toMatch(/UPDATE work_agreements SET status = 'active'/);
  const { sendNotification } = require('../services/notificationService');
  expect(sendNotification).toHaveBeenCalledTimes(2);
  expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
    type: 'work_agreement_auto_activated',
    userId: 'h1',
    idempotencyKey: 'wa-auto-activated:a1',
  }));
  expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
    type: 'work_agreement_auto_activated',
    userId: 'c1',
  }));
});

test('skips candidates already activated by a concurrent run', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 'a1', job_id: 'j1', helper_id: 'h1', customer_id: 'c1' }] })
    .mockResolvedValueOnce({ rowCount: 0 }); // guarded UPDATE matched nothing

  const result = await activateTimedOutProposals(7);

  expect(result).toEqual({ checked: 1, activated: 0 });
  const { sendNotification } = require('../services/notificationService');
  expect(sendNotification).not.toHaveBeenCalled();
});

test('the candidate query only matches stale author-unsigned proposals', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });

  await activateTimedOutProposals(7);

  const [sql, params] = mockQuery.mock.calls[0];
  expect(String(sql)).toMatch(/a\.status = 'pending_signatures'/);
  // counterparty (not the author) signed the current version ...
  expect(String(sql)).toMatch(/s\.signer_id <> v\.created_by/);
  // ... and the signature is older than the timeout ...
  expect(String(sql)).toMatch(/make_interval\(days => \$1\)/);
  // ... and the author never signed it
  expect(String(sql)).toMatch(/s2\.signer_id = v\.created_by/);
  expect(params).toEqual([7]);
});
