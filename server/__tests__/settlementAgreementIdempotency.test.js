'use strict';

// Background-jobs audit (Oct 30 item 3): the settlement cycle's agreement
// idempotency key was partner-only, so once the first agreement was
// ended, every later cycle 409ed on the hash mismatch and the partner
// never settled again. The key is now scoped per cycle, so a later cycle
// mints under its own key. The admin service is faked with the same
// key-to-hash 409 rule the real one enforces.

jest.mock('../services/oxsteedCreditAdminService', () => ({
  createAgreement: jest.fn(),
  transitionAgreement: jest.fn(),
}));

const { mockQuery, resetMocks } = require('./setup');
const { createAgreement, transitionAgreement } = require('../services/oxsteedCreditAdminService');
const { ensureSettlementAgreement } = require('../jobs/oxsteedCreditSettlementCycle');

function fakeAdminService() {
  const byKey = new Map();
  createAgreement.mockImplementation(async ({ idempotencyKey, startsAt, metadata }) => {
    const existing = byKey.get(idempotencyKey);
    if (existing) {
      // Same key + same content replays; different content 409s, exactly
      // like the real service's idempotency hash check.
      if (existing.startsAt !== startsAt || existing.cycleType !== metadata.cycle_type) {
        const err = new Error('Idempotency key conflict');
        err.statusCode = 409;
        throw err;
      }
      return { agreement: existing.agreement };
    }
    const agreement = { id: `agr-${byKey.size + 1}`, status: 'draft' };
    byKey.set(idempotencyKey, { agreement, startsAt, cycleType: metadata.cycle_type });
    return { agreement };
  });
  transitionAgreement.mockImplementation(async ({ agreementId, targetStatus }) => {
    const entry = [...byKey.values()].find((e) => e.agreement.id === agreementId);
    entry.agreement.status = targetStatus;
    return { agreement: entry.agreement };
  });
  return byKey;
}

const partner = { id: 'partner-1' };
const cycle1 = {
  cycleType: 'weekly',
  periodStart: new Date('2026-11-01T00:00:00Z'),
  periodEnd: new Date('2026-11-08T00:00:00Z'),
};
const cycle2 = {
  cycleType: 'weekly',
  periodStart: new Date('2026-11-08T00:00:00Z'),
  periodEnd: new Date('2026-11-15T00:00:00Z'),
};

beforeEach(() => {
  jest.clearAllMocks();
  resetMocks();
});

describe('settlement agreement idempotency key is cycle-scoped (Oct 30 item 3)', () => {
  test('the key names the partner, the cycle type, and the period start', async () => {
    fakeAdminService();
    await ensureSettlementAgreement(partner, cycle1);
    expect(createAgreement).toHaveBeenCalledTimes(1);
    const key = createAgreement.mock.calls[0][0].idempotencyKey;
    expect(key).toBe('credit-settlement-cycle-agreement:partner-1:weekly:2026-11-01');
  });

  test('a later cycle mints under its own key after the first agreement was ended', async () => {
    const byKey = fakeAdminService();
    const first = await ensureSettlementAgreement(partner, cycle1);
    expect(first.created).toBe(true);
    // The operator ends the first agreement; the next cycle must not 409.
    const firstEntry = byKey.get('credit-settlement-cycle-agreement:partner-1:weekly:2026-11-01');
    firstEntry.agreement.status = 'ended';
    const second = await ensureSettlementAgreement(partner, cycle2);
    expect(second.created).toBe(true);
    expect(second.agreementId).not.toBe(first.agreementId);
    expect(createAgreement).toHaveBeenCalledTimes(2);
    expect(createAgreement.mock.calls[1][0].idempotencyKey)
      .toBe('credit-settlement-cycle-agreement:partner-1:weekly:2026-11-08');
  });

  test('a same-cycle replay reuses the key instead of minting a duplicate', async () => {
    fakeAdminService();
    const first = await ensureSettlementAgreement(partner, cycle1);
    const replay = await ensureSettlementAgreement(partner, cycle1);
    expect(replay.agreementId).toBe(first.agreementId);
    expect(replay.created).toBe(false);
    expect(createAgreement).toHaveBeenCalledTimes(2);
    expect(createAgreement.mock.calls[0][0].idempotencyKey)
      .toBe(createAgreement.mock.calls[1][0].idempotencyKey);
  });
});
