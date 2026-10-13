'use strict';

// P3-10-F06: the Didit auto-grant tier path was dead code because
// requestMyIdentityVerification never passed providerName, so
// requestIdentityVerification always fell back to 'manual_review'.
// These tests pin the controller's provider allow-list behavior.

const { resetMocks } = require('./setup');

const mockRequestIdentityVerification = jest.fn();

jest.mock('../services/identityVerificationService', () => ({
  requestIdentityVerification: (...args) => mockRequestIdentityVerification(...args),
  requestIdentityVerificationAppeal: jest.fn(),
  getCustomerVerificationTier: jest.fn(),
  getCustomerLatestVerification: jest.fn(),
  TIER1_TOPUP_MAX_CENTS: 50000,
  TIER2_TOPUP_MAX_CENTS: 250000,
}));

const controller = require('../controllers/oxsteedCreditController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  resetMocks();
  mockRequestIdentityVerification.mockReset();
  mockRequestIdentityVerification.mockResolvedValue({ status: 'pending', verificationId: 'v-1', replayed: false });
});

test('defaults to the didit provider so verified Didit identities auto-grant', async () => {
  const res = mockRes();
  const next = jest.fn();
  await controller.requestMyIdentityVerification(
    { user: { id: 'cust-1' }, body: {}, ip: '127.0.0.1' },
    res,
    next
  );
  expect(next).not.toHaveBeenCalled();
  expect(mockRequestIdentityVerification).toHaveBeenCalledWith(expect.objectContaining({
    customerId: 'cust-1',
    providerName: 'didit',
  }));
  expect(res.status).toHaveBeenCalledWith(201);
});

test('passes through an explicit allow-listed manual_review provider', async () => {
  const res = mockRes();
  await controller.requestMyIdentityVerification(
    { user: { id: 'cust-1' }, body: { requestedTier: 1, providerName: 'manual_review' }, ip: '127.0.0.1' },
    res,
    jest.fn()
  );
  expect(mockRequestIdentityVerification).toHaveBeenCalledWith(expect.objectContaining({
    providerName: 'manual_review',
    requestedTier: 1,
  }));
});

test('falls back to didit for an unknown provider name (allow-list, never passthrough)', async () => {
  const res = mockRes();
  await controller.requestMyIdentityVerification(
    { user: { id: 'cust-1' }, body: { providerName: 'self_attested' }, ip: '127.0.0.1' },
    res,
    jest.fn()
  );
  expect(mockRequestIdentityVerification).toHaveBeenCalledWith(expect.objectContaining({
    providerName: 'didit',
  }));
});
