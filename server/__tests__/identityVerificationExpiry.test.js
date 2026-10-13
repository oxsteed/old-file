'use strict';

/**
 * P3-10-F09 (appeal SLA arming) and P3-10-F10 (expiry notification).
 */

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue({ success: true }),
}));

const { sendNotification } = require('../services/notificationService');
const {
  getCustomerVerificationTier,
  requestIdentityVerificationAppeal,
  reviewIdentityVerificationAppeal,
  warnExpiringIdentityVerifications,
  IDENTITY_EXPIRY_WARNING_DAYS,
} = require('../services/identityVerificationService');

const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const VERIFICATION_ID = '33333333-3333-4333-8333-333333333333';
const fakeClient = () => ({ query: mockQuery });

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

function verificationRow(overrides = {}) {
  return {
    id: VERIFICATION_ID,
    customer_id: CUSTOMER_ID,
    requested_tier: 2,
    tier: 2,
    status: 'verified',
    provider: 'manual_review',
    provider_reference: 'manual:ref',
    appeal_status: null,
    expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('expired verification notification (P3-10-F10)', () => {
  test('the lazy expiry flip notifies the customer', async () => {
    const expired = verificationRow({
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    mockQuery.mockImplementation(async (text) => {
      const sql = String(text);
      if (sql.includes('FROM oxsteed_credit_identity_verifications')) return { rows: [expired] };
      if (sql.includes("SET status = 'expired'")) return { rows: [{ id: VERIFICATION_ID }] };
      return { rows: [], rowCount: 0 };
    });

    const result = await getCustomerVerificationTier(fakeClient(), CUSTOMER_ID);

    expect(result.tier).toBe(0);
    expect(result.status).toBe('expired');
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: CUSTOMER_ID,
        type: 'credit_identity_verification_expired',
        action_url: '/wallet',
        idempotencyKey: `credit-identity:${VERIFICATION_ID}:expired`,
      })
    );
  });

  test('no notification while the verification is still valid', async () => {
    const valid = verificationRow();
    mockQuery.mockImplementation(async (text) => {
      const sql = String(text);
      if (sql.includes('FROM oxsteed_credit_identity_verifications')) return { rows: [valid] };
      return { rows: [], rowCount: 0 };
    });

    const result = await getCustomerVerificationTier(fakeClient(), CUSTOMER_ID);

    expect(result.tier).toBe(2);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  test('no duplicate notification when the flip already happened', async () => {
    const alreadyExpired = verificationRow({ status: 'expired' });
    mockQuery.mockImplementation(async (text) => {
      const sql = String(text);
      if (sql.includes('FROM oxsteed_credit_identity_verifications')) return { rows: [alreadyExpired] };
      return { rows: [], rowCount: 0 };
    });

    await getCustomerVerificationTier(fakeClient(), CUSTOMER_ID);

    expect(sendNotification).not.toHaveBeenCalled();
    const flip = mockQuery.mock.calls.find(([sql]) => String(sql).includes("SET status = 'expired'"));
    expect(flip).toBeUndefined();
  });
});

describe('appeal review SLA (P3-10-F09)', () => {
  test('submitting an appeal arms appeal_sla_due_at', async () => {
    const rejected = verificationRow({ status: 'rejected', tier: 0 });
    const appealed = verificationRow({ status: 'rejected', tier: 0, appeal_status: 'pending' });
    mockQuery.mockImplementation(async (text) => {
      const sql = String(text);
      if (sql.includes('WHERE id = $1 AND customer_id = $2 FOR UPDATE')) return { rows: [rejected] };
      if (sql.includes('UPDATE oxsteed_credit_identity_verifications')) return { rows: [appealed] };
      if (sql.includes('INSERT INTO oxsteed_credit_audit_events')) return { rows: [] };
      return { rows: [], rowCount: 0 };
    });

    const result = await requestIdentityVerificationAppeal({
      verificationId: VERIFICATION_ID,
      customerId: CUSTOMER_ID,
      reason: 'The document was valid.',
    });

    expect(result.verification.appealStatus).toBe('pending');
    const update = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE oxsteed_credit_identity_verifications')
    );
    expect(String(update[0])).toContain('appeal_sla_due_at = NOW()');
  });

  test('deciding an appeal clears appeal_sla_due_at', async () => {
    const pendingAppeal = verificationRow({ status: 'rejected', tier: 0, appeal_status: 'pending' });
    const decided = verificationRow({ status: 'rejected', tier: 0, appeal_status: 'rejected' });
    mockQuery.mockImplementation(async (text) => {
      const sql = String(text);
      if (sql.includes('WHERE id = $1 FOR UPDATE')) return { rows: [pendingAppeal] };
      if (sql.includes('UPDATE oxsteed_credit_identity_verifications')) return { rows: [decided] };
      if (sql.includes('INSERT INTO oxsteed_credit_audit_events')) return { rows: [] };
      return { rows: [], rowCount: 0 };
    });

    await reviewIdentityVerificationAppeal({
      verificationId: VERIFICATION_ID,
      decision: 'reject',
      actorUserId: ACTOR_ID,
      reason: 'Still unreadable',
    });

    const update = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE oxsteed_credit_identity_verifications')
    );
    expect(String(update[0])).toContain('appeal_sla_due_at = NULL');
  });
});

describe('proactive expiry warnings (P3-10-F10)', () => {
  test('warns customers whose verification expires inside the warning window', async () => {
    const expiring = verificationRow({
      expires_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    });
    mockQuery.mockImplementation(async (text) => {
      const sql = String(text);
      if (sql.includes('FROM oxsteed_credit_identity_verifications')) return { rows: [expiring] };
      return { rows: [], rowCount: 0 };
    });

    const result = await warnExpiringIdentityVerifications({ client: fakeClient() });

    expect(result.warned).toBe(1);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    const expiryDay = new Date(expiring.expires_at).toISOString().slice(0, 10);
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: CUSTOMER_ID,
        type: 'credit_identity_verification_expiring',
        action_url: '/wallet',
        idempotencyKey: `credit-identity:${VERIFICATION_ID}:expiring:${expiryDay}`,
      })
    );
  });

  test('skips verifications expiring outside the warning window', async () => {
    // The sweep query itself filters by the window; simulate an empty
    // result for an out-of-window verification.
    mockQuery.mockImplementation(async () => ({ rows: [], rowCount: 0 }));

    const result = await warnExpiringIdentityVerifications({ client: fakeClient() });

    expect(result.warned).toBe(0);
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
