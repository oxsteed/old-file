'use strict';

// Item 2: server-side identity-verification gate on helper listing.
// toggleListing's own check used to trust email_verified +
// onboarding_completed alone. General registration stamps
// onboarding_completed at OTP verification, before identity verification
// lands, so that check alone would publish an unverified helper.
// The controller now also requires the canonical helperOnboarding
// identity derivation (id_verified OR identity_verified OR
// didit_status = 'verified'); Didit 'skipped' does not satisfy it.
// Unlisting is never gated. Uses the mocked-pool harness (setup.js).

const { mockQuery, resetMocks } = require('./setup');
const { toggleListing, getMyListingStatus } = require('../controllers/helpersController');

jest.mock('../services/socketService', () => ({
  isOnline: jest.fn(() => false),
}));

jest.mock('../services/helperAvailabilityService', () => ({
  getTemplate: jest.fn().mockResolvedValue({ byDay: {} }),
  formatTime: (v) => v,
  getHelperTimeZone: jest.fn().mockResolvedValue('UTC'),
  zonedDateStr: () => '2026-01-01',
  addDaysISO: (iso, days) => iso,
  computeAvailability: jest.fn().mockResolvedValue({ summary: [], hasTemplate: false }),
  listSlots: jest.fn().mockResolvedValue([]),
}));

const USER_ID = '00000000-0000-4000-8000-000000000001';

function baseUser(overrides = {}) {
  return {
    email_verified: true,
    onboarding_completed: true,
    is_suspended: false,
    id_verified: false,
    identity_verified: false,
    didit_status: null,
    ...overrides,
  };
}

function runToggle(userRow, isListed) {
  mockQuery.mockImplementation((sql, params) => {
    if (sql.includes('FROM users WHERE id')) {
      return Promise.resolve({ rows: [userRow] });
    }
    if (sql.includes('UPDATE helper_profiles')) {
      return Promise.resolve({ rows: [{ is_listed: params[0] }] });
    }
    return Promise.resolve({ rows: [] });
  });
  const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
  const next = jest.fn();
  const req = { user: { id: USER_ID }, body: { is_listed: isListed } };
  return toggleListing(req, res, next).then(() => ({ res, next }));
}

function statusOf(err) {
  return err && (err.statusCode || err.status);
}

describe('toggleListing identity gate', () => {
  beforeEach(() => {
    resetMocks();
  });

  test('general-flow helper (email + onboarding stamped, no identity) cannot list', async () => {
    const { next } = await runToggle(baseUser(), true);
    expect(next).toHaveBeenCalled();
    const err = next.mock.calls[0][0];
    expect(statusOf(err)).toBe(403);
    expect(err.code).toBe('listing_requires_identity_verification');
    expect(mockQuery.mock.calls.some(([sql]) => sql.includes('UPDATE helper_profiles'))).toBe(false);
  });

  test('Didit skipped does not satisfy the identity gate', async () => {
    const { next } = await runToggle(baseUser({ didit_status: 'skipped' }), true);
    expect(next).toHaveBeenCalled();
    const err = next.mock.calls[0][0];
    expect(statusOf(err)).toBe(403);
    expect(err.code).toBe('listing_requires_identity_verification');
  });

  test('verified helper (id_verified) can list', async () => {
    const { res, next } = await runToggle(baseUser({ id_verified: true }), true);
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true, is_listed: true });
  });

  test('verified helper (didit_status verified only) can list', async () => {
    const { res, next } = await runToggle(baseUser({ didit_status: 'verified' }), true);
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true, is_listed: true });
  });

  test('unlisting is never gated, even for an unverified helper', async () => {
    const { res, next } = await runToggle(baseUser(), false);
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true, is_listed: false });
  });

  test('existing gates are preserved: suspended helper still gets listing_not_ready', async () => {
    const { next } = await runToggle(baseUser({ is_suspended: true }), true);
    expect(next).toHaveBeenCalled();
    const err = next.mock.calls[0][0];
    expect(statusOf(err)).toBe(403);
    expect(err.code).toBe('listing_not_ready');
  });

  test('existing gates are preserved: unverified email still gets listing_not_ready', async () => {
    const { next } = await runToggle(baseUser({ email_verified: false }), true);
    expect(next).toHaveBeenCalled();
    const err = next.mock.calls[0][0];
    expect(statusOf(err)).toBe(403);
    expect(err.code).toBe('listing_not_ready');
  });

  test('adjacent route getMyListingStatus is unaffected', async () => {
    mockQuery.mockImplementation(() => Promise.resolve({ rows: [{ is_listed: true }] }));
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    const next = jest.fn();
    await getMyListingStatus({ user: { id: USER_ID } }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ is_listed: true });
  });
});
