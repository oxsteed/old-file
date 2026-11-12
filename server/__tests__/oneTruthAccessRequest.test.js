'use strict';

const { mockQuery, resetMocks } = require('./setup');

const mockHasGlobalGrant = jest.fn();
const mockRequestInvestigationAccess = jest.fn();
jest.mock('../middleware/adminAuth', () => ({
  hasGlobalGrant: (...args) => mockHasGlobalGrant(...args),
}));
jest.mock('../services/investigationAccessService', () => ({
  requestInvestigationAccess: (...args) => mockRequestInvestigationAccess(...args),
  checkInvestigationAccess: jest.fn(),
  logInvestigationRead: jest.fn(),
  logOneTruthRead: jest.fn(),
  InvestigationAccessError: class InvestigationAccessError extends Error {},
}));

const { requestOneTruthAccess } = require('../controllers/oneTruthController');

function response() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  mockHasGlobalGrant.mockResolvedValue(false);
  mockRequestInvestigationAccess.mockResolvedValue({ id: 7, status: 'pending' });
});

test('accepts a delegated manage_users approver and forwards the grant request', async () => {
  mockHasGlobalGrant.mockResolvedValue(true);
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 'delegated-approver', role: 'admin' }] });
  const res = response();

  await requestOneTruthAccess({
    user: { id: 'requester-admin' },
    body: {
      approverEmail: 'approver@example.com',
      purpose: 'Review a suspected duplicate account investigation',
      scopeUserIds: ['00000000-0000-4000-8000-000000000001'],
      investigationRef: 'case-7',
    },
  }, res, jest.fn());

  expect(res.status).toHaveBeenCalledWith(201);
  expect(mockHasGlobalGrant).toHaveBeenCalledWith('delegated-approver', 'manage_users');
  expect(mockRequestInvestigationAccess).toHaveBeenCalledWith(expect.objectContaining({
    requesterId: 'requester-admin',
    approverId: 'delegated-approver',
    grantScope: 'fraud_analyst',
  }));
});

test('rejects an admin without the manage_users grant before creating a request', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 'blocked-approver', role: 'admin' }] });
  const res = response();

  await requestOneTruthAccess({
    user: { id: 'requester-admin' },
    body: {
      approverEmail: 'approver@example.com',
      purpose: 'Review a suspected duplicate account investigation',
      scopeUserIds: ['00000000-0000-4000-8000-000000000001'],
    },
  }, res, jest.fn());

  expect(res.status).toHaveBeenCalledWith(400);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'approver_not_authorized' }));
  expect(mockRequestInvestigationAccess).not.toHaveBeenCalled();
});
