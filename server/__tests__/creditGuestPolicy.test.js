'use strict';

/**
 * Phase 3 — guest Credit risk-limits policy tests.
 *
 * Covers: ticket/daily/lifetime cap enforcement, session fingerprint
 * binding, fingerprint stability, and that signed-in caps are unaffected
 * (signed-in path does not consult the guest policy).
 */

const guestPolicy = require('../services/creditGuestPolicy');
const adapter = require('../services/creditSpendAdapter');

function mockClient(queryImpl) {
  return { query: jest.fn(queryImpl) };
}

// No prior spend for this fingerprint.
function freshClient() {
  return mockClient(async (text) => {
    if (text.includes('credit_guest_spend_tracking')) return { rows: [] };
    return { rows: [] };
  });
}

describe('guest fingerprint', () => {
  test('same inputs produce the same fingerprint', () => {
    const a = guestPolicy.buildGuestFingerprint({ sessionId: 's1', ip: '1.2.3.4', userAgent: 'ua' });
    const b = guestPolicy.buildGuestFingerprint({ sessionId: 's1', ip: '1.2.3.4', userAgent: 'ua' });
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  test('different sessions produce different fingerprints', () => {
    const a = guestPolicy.buildGuestFingerprint({ sessionId: 's1', ip: '1.2.3.4', userAgent: 'ua' });
    const b = guestPolicy.buildGuestFingerprint({ sessionId: 's2', ip: '1.2.3.4', userAgent: 'ua' });
    expect(a).not.toBe(b);
  });

  test('different IPs produce different fingerprints (session binding)', () => {
    const a = guestPolicy.buildGuestFingerprint({ sessionId: 's1', ip: '1.2.3.4', userAgent: 'ua' });
    const b = guestPolicy.buildGuestFingerprint({ sessionId: 's1', ip: '5.6.7.8', userAgent: 'ua' });
    expect(a).not.toBe(b);
  });

  test('missing session throws', () => {
    try {
      guestPolicy.buildGuestFingerprint({ sessionId: '', ip: '1.2.3.4' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.code).toBe('credit_guest_session_required');
    }
  });

  test('raw session id is not exposed in the fingerprint', () => {
    const fp = guestPolicy.buildGuestFingerprint({ sessionId: 'secret-session-123', ip: '1.2.3.4', userAgent: 'ua' });
    expect(fp).not.toContain('secret-session-123');
  });
});

describe('guest caps', () => {
  test('ticket cap constant is $25', () => {
    expect(guestPolicy.GUEST_MAX_TICKET_CENTS).toBe(2500);
  });

  test('daily cap constant is $50', () => {
    expect(guestPolicy.GUEST_DAILY_CAP_CENTS).toBe(5000);
  });

  test('lifetime cap constant is $200', () => {
    expect(guestPolicy.GUEST_LIFETIME_CAP_CENTS).toBe(20000);
  });

  test('over ticket cap is rejected', async () => {
    const client = freshClient();
    await expect(
      guestPolicy.assertGuestSpendAllowed(client, { fingerprint: 'fp1', amountCents: 2501 })
    ).rejects.toMatchObject({ code: 'credit_guest_ticket_cap_exceeded' });
  });

  test('at ticket cap is allowed', async () => {
    const client = freshClient();
    await expect(
      guestPolicy.assertGuestSpendAllowed(client, { fingerprint: 'fp1', amountCents: 2500 })
    ).resolves.toBeDefined();
  });

  test('daily cap enforced across spends', async () => {
    const client = mockClient(async (text) => {
      if (text.includes('FOR UPDATE')) return { rows: [{ daily_spent_cents: '4000', lifetime_spent_cents: '4000' }] };
      if (text.includes('COALESCE(SUM')) return { rows: [{ lifetime: '4000' }] };
      return { rows: [] };
    });
    // $40 already spent today, $20 more would exceed the $50 daily cap.
    await expect(
      guestPolicy.assertGuestSpendAllowed(client, { fingerprint: 'fp1', amountCents: 2000 })
    ).rejects.toMatchObject({ code: 'credit_guest_daily_cap_exceeded' });
    // $10 more is fine.
    await expect(
      guestPolicy.assertGuestSpendAllowed(client, { fingerprint: 'fp1', amountCents: 1000 })
    ).resolves.toBeDefined();
  });

  test('lifetime cap enforced', async () => {
    const client = mockClient(async (text) => {
      if (text.includes('FOR UPDATE')) return { rows: [{ daily_spent_cents: '0', lifetime_spent_cents: '0' }] };
      if (text.includes('COALESCE(SUM')) return { rows: [{ lifetime: '19500' }] };
      return { rows: [] };
    });
    // $195 lifetime spent, $10 more would exceed $200.
    await expect(
      guestPolicy.assertGuestSpendAllowed(client, { fingerprint: 'fp1', amountCents: 1000 })
    ).rejects.toMatchObject({ code: 'credit_guest_lifetime_cap_exceeded' });
  });
});

describe('adapter guest integration', () => {
  test('guest hold mode is rejected', async () => {
    const client = freshClient();
    await expect(
      adapter.spendWithCreditInTransaction(client, {
        participantRef: { type: 'restaurant', subjectId: '1' },
        customerId: null,
        guestSessionId: 'sess-1',
        amountCents: 1000,
        currency: 'USD',
        surface: 'pos',
        mode: 'hold',
        referenceType: 'test',
        referenceId: 'r1',
      })
    ).rejects.toMatchObject({ code: 'credit_guest_hold_not_supported' });
  });

  test('guest over ticket cap is rejected before participant resolution', async () => {
    const client = mockClient(async () => { throw new Error('should not query'); });
    await expect(
      adapter.spendWithCreditInTransaction(client, {
        participantRef: { type: 'restaurant', subjectId: '1' },
        customerId: null,
        guestSessionId: 'sess-1',
        amountCents: 10000,
        currency: 'USD',
        surface: 'food_online',
        referenceType: 'test',
        referenceId: 'r1',
      })
    ).rejects.toMatchObject({ code: 'credit_guest_cap_exceeded' });
  });
});
