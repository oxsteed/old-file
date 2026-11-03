'use strict';
const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/accountDeletionGuard', () => ({ findFinancialBlockers: jest.fn(), cancelSubscriptionsForDeletion: jest.fn() }));
jest.mock('../services/incidentStore', () => ({ recordIncident: jest.fn() }));

const guard = require('../services/accountDeletionGuard');
const incidentStore = require('../services/incidentStore');
const deletion = require('../jobs/scheduledDeletionJob');

beforeEach(() => {
  resetMocks();
  incidentStore.recordIncident.mockClear();
  incidentStore.recordIncident.mockResolvedValue({ persisted: true });
  mockQuery.mockImplementation(async () => ({ rows: [], rowCount: 0 }));
});

test('Oct 25 #3: a blocked scheduled deletion records a deduped high incident', async () => {
  guard.findFinancialBlockers.mockResolvedValue(['credit_balance']);
  await deletion.hardDeleteUser({ id: 'subject', email: 'fixture@example.invalid', deletion_scheduled_at: '2026-10-01T00:00:00Z' });
  expect(incidentStore.recordIncident).toHaveBeenCalledWith(expect.objectContaining({
    type: 'account_deletion_financial_blocker', severity: 'high', dedupeKey: 'account-deletion-blocked:subject',
  }));
});

test('Oct 25 #3: an unblocked deletion with no credit records proceeds past the guard', async () => {
  guard.findFinancialBlockers.mockResolvedValue([]);
  await deletion.hardDeleteUser({ id: 'subject', email: 'fixture@example.invalid', deletion_scheduled_at: null });
  expect(incidentStore.recordIncident).not.toHaveBeenCalledWith(expect.objectContaining({
    type: 'account_deletion_financial_blocker',
  }));
});
