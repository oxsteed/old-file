'use strict';
const { mockQuery, resetMocks } = require('./setup');
jest.mock('../services/chatThreadAccess', () => ({
  ...jest.requireActual('../services/chatThreadAccess'),
  assertConversationParticipant: jest.fn(async () => ({ id: 'conv', job_id: 'job-1' })),
}));
const ctrl = require('../controllers/chatAgreementsController');

beforeEach(resetMocks);

test('job-thread chat agreement links to the records-room agreement (P1-163)', async () => {
  mockQuery.mockImplementation(async (sql) => {
    if (/FROM work_agreements/.test(sql)) return { rows: [{ id: 'wa-1' }] };
    if (/chat_agreements|agreement/i.test(sql)) return { rows: [{ id: 'a1', conversation_id: 'conv', status: 'shared', version: 1, title: 'T' }] };
    return { rows: [] };
  });
  const res = { json: jest.fn(), status: jest.fn(() => res) };
  const next = jest.fn();
  await ctrl.getAgreement({ params: { id: 'a1' }, query: {}, headers: {}, body: {}, user: { id: 'u1' } }, res, next);
  expect(next).not.toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ jobId: 'job-1', recordsRoomAgreementId: 'wa-1' }));
});
