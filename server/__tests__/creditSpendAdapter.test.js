'use strict';

/**
 * Phase 2 — Credit Everywhere: spend adapter tests.
 *
 * Covers: surface/mode matrix enforcement, participant resolution failure,
 * deterministic idempotency, rail-off / freeze fail-closed, impersonation
 * block, and guest risk caps. The adapter's money paths are exercised with
 * a mocked tx client; the underlying journal functions are not re-tested
 * here (covered by oxsteedCredit suites).
 */

const adapter = require('../services/creditSpendAdapter');
const creditService = require('../services/oxsteedCreditService');

jest.mock('../services/creditParticipantService', () => {
  const actual = jest.requireActual('../services/creditParticipantService');
  return { ...actual, resolveParticipant: jest.fn() };
});
const participantService = require('../services/creditParticipantService');

function mockClient(queryImpl) {
  return { query: jest.fn(queryImpl) };
}

// information_schema says credit_participants does NOT exist → legacy fallback.
function legacyClient(partnerRows = [{ id: 42 }]) {
  return mockClient(async (text) => {
    if (text.includes('information_schema.tables')) return { rows: [] };
    if (text.includes('oxsteed_credit_partners')) return { rows: partnerRows };
    return { rows: [] };
  });
}

// credit_participants table exists; resolution delegated to the mocked
// participant service.
function participantClient() {
  return mockClient(async (text) => {
    if (text.includes('information_schema.tables')) return { rows: [{}] };
    return { rows: [] };
  });
}

function mockResolvedParticipant(overrides = {}) {
  return {
    participant: {
      id: 'cp-1',
      participant_type: 'restaurant',
      status: 'active',
      didit_verified: true,
      allowed_surfaces: ['food_online', 'chat', 'pos', 'jobs'],
      ...overrides.participant,
    },
    partner: { id: 42, status: 'active', ...overrides.partner },
    agreement: null,
  };
}

beforeEach(() => {
  participantService.resolveParticipant.mockReset();
  participantService.resolveParticipant.mockResolvedValue(mockResolvedParticipant());
});

const baseArgs = {
  participantRef: { type: 'restaurant', subjectId: 7 },
  customerId: 'cust-1',
  amountCents: 1000,
  currency: 'USD',
  surface: 'food_online',
  referenceType: 'food_order',
  referenceId: 'order-1',
  actorUserId: 'cust-1',
};

describe('surface/mode matrix', () => {
  test('debit surfaces accept debit (explicit)', async () => {
    const client = legacyClient();
    const purchase = { transaction: { id: 'tx-1' }, replayed: false };
    const spy = jest.spyOn(creditService, 'purchaseWithCreditInTransaction').mockResolvedValue(purchase);
    jest.spyOn(creditService, 'assertCreditRailEnabled').mockResolvedValue(undefined);
    try {
      const result = await adapter.spendWithCreditInTransaction(client, { ...baseArgs, mode: 'debit' });
      expect(result.mode).toBe('debit');
      expect(result.surface).toBe('food_online');
      expect(result.purchase).toBe(purchase);
      expect(spy).toHaveBeenCalledTimes(1);
      const callArgs = spy.mock.calls[0][1];
      expect(callArgs.partnerId).toBe(42);
      expect(callArgs.customerId).toBe('cust-1');
    } finally {
      spy.mockRestore();
      creditService.assertCreditRailEnabled.mockRestore?.();
    }
  });

  test('mode defaults to the surface matrix value', async () => {
    const client = legacyClient();
    const purchase = { transaction: { id: 'tx-1' } };
    const spy = jest.spyOn(creditService, 'purchaseWithCreditInTransaction').mockResolvedValue(purchase);
    const railSpy = jest.spyOn(creditService, 'assertCreditRailEnabled').mockResolvedValue(undefined);
    try {
      const result = await adapter.spendWithCreditInTransaction(client, { ...baseArgs });
      expect(result.mode).toBe('debit');
    } finally {
      spy.mockRestore();
      railSpy.mockRestore();
    }
  });

  test('wrong mode for surface is rejected', async () => {
    const client = legacyClient();
    await expect(
      adapter.spendWithCreditInTransaction(client, { ...baseArgs, mode: 'hold' })
    ).rejects.toMatchObject({ code: 'credit_surface_mode_mismatch', status: 400 });
  });

  test('pos requires hold mode', async () => {
    const client = legacyClient();
    await expect(
      adapter.spendWithCreditInTransaction(client, { ...baseArgs, surface: 'pos', mode: 'debit' })
    ).rejects.toMatchObject({ code: 'credit_surface_mode_mismatch' });
  });

  test('pos hold routes to createCreditHoldInTransaction', async () => {
    const client = legacyClient();
    const hold = { hold: { id: 'hold-1' }, replayed: false };
    const spy = jest.spyOn(creditService, 'createCreditHoldInTransaction').mockResolvedValue(hold);
    const railSpy = jest.spyOn(creditService, 'assertCreditRailEnabled').mockResolvedValue(undefined);
    try {
      const result = await adapter.spendWithCreditInTransaction(client, { ...baseArgs, surface: 'pos' });
      expect(result.mode).toBe('hold');
      expect(result.hold).toBe(hold);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
      railSpy.mockRestore();
    }
  });

  test('unknown surface is rejected', async () => {
    const client = legacyClient();
    await expect(
      adapter.spendWithCreditInTransaction(client, { ...baseArgs, surface: 'teleport' })
    ).rejects.toMatchObject({ code: 'credit_surface_unknown', status: 400 });
  });
});

describe('participant resolution', () => {
  test('missing participant fails closed', async () => {
    const client = legacyClient([]); // no partner rows
    const railSpy = jest.spyOn(creditService, 'assertCreditRailEnabled').mockResolvedValue(undefined);
    try {
      await expect(
        adapter.spendWithCreditInTransaction(client, baseArgs)
      ).rejects.toMatchObject({ code: 'credit_partner_not_eligible' });
    } finally {
      railSpy.mockRestore();
    }
  });

  test('non-restaurant participant type without the new table fails closed', async () => {
    const client = legacyClient();
    const railSpy = jest.spyOn(creditService, 'assertCreditRailEnabled').mockResolvedValue(undefined);
    try {
      await expect(
        adapter.spendWithCreditInTransaction(client, {
          ...baseArgs,
          participantRef: { type: 'helper', subjectId: 'h-1' },
        })
      ).rejects.toMatchObject({ code: 'credit_participant_not_found' });
    } finally {
      railSpy.mockRestore();
    }
  });

  test('credit_participants table is preferred when present', async () => {
    const client = participantClient();
    participantService.resolveParticipant.mockResolvedValue(mockResolvedParticipant({
      participant: { participant_type: 'business', allowed_surfaces: ['chat'] },
      partner: { id: 77, status: 'active' },
    }));
    const purchase = { transaction: { id: 'tx-2' } };
    const spy = jest.spyOn(creditService, 'purchaseWithCreditInTransaction').mockResolvedValue(purchase);
    const railSpy = jest.spyOn(creditService, 'assertCreditRailEnabled').mockResolvedValue(undefined);
    try {
      const result = await adapter.spendWithCreditInTransaction(client, {
        ...baseArgs,
        surface: 'chat',
        participantRef: { type: 'business', subjectId: 'b-9' },
      });
      expect(result.partnerId).toBe(77);
      expect(spy.mock.calls[0][1].partnerId).toBe(77);
      expect(participantService.resolveParticipant).toHaveBeenCalledWith(
        client,
        { type: 'business', subjectId: 'b-9' }
      );
    } finally {
      spy.mockRestore();
      railSpy.mockRestore();
    }
  });

  test('suspended participant fails closed', async () => {
    const client = participantClient();
    participantService.resolveParticipant.mockResolvedValue(mockResolvedParticipant({
      participant: { status: 'suspended' },
    }));
    const railSpy = jest.spyOn(creditService, 'assertCreditRailEnabled').mockResolvedValue(undefined);
    try {
      await expect(
        adapter.spendWithCreditInTransaction(client, {
          ...baseArgs,
          participantRef: { type: 'business', subjectId: 'b-9' },
        })
      ).rejects.toMatchObject({ code: 'credit_participant_not_active' });
    } finally {
      railSpy.mockRestore();
    }
  });

  test('surface not in allowed_surfaces fails closed', async () => {
    const client = participantClient();
    participantService.resolveParticipant.mockResolvedValue(mockResolvedParticipant({
      participant: { allowed_surfaces: ['chat'] },
    }));
    const railSpy = jest.spyOn(creditService, 'assertCreditRailEnabled').mockResolvedValue(undefined);
    try {
      await expect(
        adapter.spendWithCreditInTransaction(client, baseArgs)
      ).rejects.toMatchObject({ code: 'credit_surface_not_allowed' });
    } finally {
      railSpy.mockRestore();
    }
  });
});

describe('rail, freeze, impersonation', () => {
  test('rail-off fails closed before any spend', async () => {
    const client = legacyClient();
    const railSpy = jest.spyOn(creditService, 'assertCreditRailEnabled').mockRejectedValue(
      Object.assign(new Error('suspended'), { code: 'credit_rail_suspended', status: 503 })
    );
    const purchaseSpy = jest.spyOn(creditService, 'purchaseWithCreditInTransaction');
    try {
      await expect(adapter.spendWithCreditInTransaction(client, baseArgs))
        .rejects.toMatchObject({ code: 'credit_rail_suspended' });
      expect(purchaseSpy).not.toHaveBeenCalled();
    } finally {
      railSpy.mockRestore();
      purchaseSpy.mockRestore();
    }
  });

  test('impersonated session cannot spend', async () => {
    const client = legacyClient();
    const purchaseSpy = jest.spyOn(creditService, 'purchaseWithCreditInTransaction');
    try {
      await expect(
        adapter.spendWithCreditInTransaction(client, { ...baseArgs, isImpersonated: true })
      ).rejects.toMatchObject({ code: 'impersonation_blocked', status: 403 });
      expect(purchaseSpy).not.toHaveBeenCalled();
    } finally {
      purchaseSpy.mockRestore();
    }
  });
});

describe('idempotency', () => {
  test('deterministic key derived from surface + reference', async () => {
    const client = legacyClient();
    const purchase = { transaction: { id: 'tx-3' } };
    const spy = jest.spyOn(creditService, 'purchaseWithCreditInTransaction').mockResolvedValue(purchase);
    const railSpy = jest.spyOn(creditService, 'assertCreditRailEnabled').mockResolvedValue(undefined);
    try {
      const a = await adapter.spendWithCreditInTransaction(client, { ...baseArgs });
      const b = await adapter.spendWithCreditInTransaction(client, { ...baseArgs });
      expect(a.idempotencyKey).toBe(b.idempotencyKey);
      expect(a.idempotencyKey).toBe('credit-spend:food_online:food_order:order-1');
      expect(spy.mock.calls[0][1].idempotencyKey).toBe(a.idempotencyKey);
    } finally {
      spy.mockRestore();
      railSpy.mockRestore();
    }
  });

  test('caller-supplied key wins', async () => {
    const client = legacyClient();
    const purchase = { transaction: { id: 'tx-4' } };
    const spy = jest.spyOn(creditService, 'purchaseWithCreditInTransaction').mockResolvedValue(purchase);
    const railSpy = jest.spyOn(creditService, 'assertCreditRailEnabled').mockResolvedValue(undefined);
    try {
      const result = await adapter.spendWithCreditInTransaction(client, {
        ...baseArgs,
        idempotencyKey: 'caller-key-123',
      });
      expect(result.idempotencyKey).toBe('caller-key-123');
    } finally {
      spy.mockRestore();
      railSpy.mockRestore();
    }
  });
});

describe('guest spend', () => {
  test('guest over the cap is rejected', async () => {
    const client = legacyClient();
    await expect(
      adapter.spendWithCreditInTransaction(client, {
        ...baseArgs,
        customerId: null,
        guestSessionId: 'sess-1',
        amountCents: 6000,
      })
    ).rejects.toMatchObject({ code: 'credit_guest_cap_exceeded' });
  });

  test('guest under the cap proceeds', async () => {
    const client = legacyClient();
    const purchase = { transaction: { id: 'tx-5' } };
    const spy = jest.spyOn(creditService, 'purchaseWithCreditInTransaction').mockResolvedValue(purchase);
    const railSpy = jest.spyOn(creditService, 'assertCreditRailEnabled').mockResolvedValue(undefined);
    try {
      const result = await adapter.spendWithCreditInTransaction(client, {
        ...baseArgs,
        customerId: null,
        guestSessionId: 'sess-1',
        amountCents: 1000,
      });
      expect(result.mode).toBe('debit');
      expect(spy.mock.calls[0][1].metadata.guestSessionId).toBe('sess-1');
    } finally {
      spy.mockRestore();
      railSpy.mockRestore();
    }
  });

  test('no customer and no guest session is rejected', async () => {
    const client = legacyClient();
    await expect(
      adapter.spendWithCreditInTransaction(client, { ...baseArgs, customerId: null })
    ).rejects.toMatchObject({ code: 'credit_spender_required' });
  });
});

describe('finalize', () => {
  test('finalizeCreditSpend captures the hold', async () => {
    const client = mockClient(async () => ({ rows: [] }));
    const capture = { transaction: { id: 'cap-1' } };
    const spy = jest.spyOn(creditService, 'captureCreditHoldInTransaction').mockResolvedValue(capture);
    try {
      const result = await adapter.finalizeCreditSpendInTransaction(client, {
        holdId: 'hold-9',
        customerId: 'cust-1',
        finalAmountCents: 900,
        actorUserId: 'ops-1',
      });
      expect(result.mode).toBe('finalize');
      expect(result.capture).toBe(capture);
      expect(spy.mock.calls[0][1].holdId).toBe('hold-9');
      expect(spy.mock.calls[0][1].amountCents).toBe(900);
    } finally {
      spy.mockRestore();
    }
  });

  test('finalize without holdId is rejected', async () => {
    const client = mockClient(async () => ({ rows: [] }));
    await expect(
      adapter.finalizeCreditSpendInTransaction(client, { customerId: 'cust-1', finalAmountCents: 100 })
    ).rejects.toMatchObject({ code: 'credit_hold_id_required' });
  });
});
