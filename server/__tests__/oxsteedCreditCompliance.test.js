'use strict';

/**
 * Tests for the Phase 5 compliance perimeter (gap 8):
 * identity verification tiers, sanctions screening, transaction
 * monitoring rules, SLA breach incidents, and step-up challenges.
 * The DB is the shared pg mock from ./setup (mockQuery); withTransaction
 * is mocked to run against pool.query, so tests queue mock responses
 * linearly.
 */

process.env.OXSTEED_CREDIT_STEPUP_PEPPER = 'test-pepper';

const crypto = require('crypto');
const { mockQuery, resetMocks } = require('./setup');
const {
  assertIdentityVerificationTier,
  reviewIdentityVerification,
  TIER1_TOPUP_MAX_CENTS,
  TIER2_TOPUP_MAX_CENTS,
} = require('../services/identityVerificationService');
const {
  assertSanctionsClear,
  SCREENING_PROVIDERS,
} = require('../services/sanctionsScreeningService');
const { openComplianceCase } = require('../services/complianceCaseService');
const {
  runTransactionMonitoring,
  checkComplianceCaseSla,
} = require('../services/transactionMonitoringService');
const { verifyStepupChallenge } = require('../services/stepupChallengeService');

const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const VERIFICATION_ID = '33333333-3333-4333-8333-333333333333';

const fakeClient = () => ({ query: mockQuery });

beforeEach(resetMocks);

function verificationRow(overrides = {}) {
  return {
    id: VERIFICATION_ID,
    customer_id: CUSTOMER_ID,
    requested_tier: 2,
    tier: 2,
    status: 'verified',
    provider: 'manual_review',
    provider_reference: 'manual:ref',
    reviewed_by: ACTOR_ID,
    reviewed_at: new Date().toISOString(),
    review_reason: 'Documents checked',
    expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function mockTierRows(rows) {
  mockQuery.mockImplementation(async (text) => {
    const sql = String(text);
    if (sql.includes('FROM oxsteed_credit_identity_verifications')) return { rows };
    return { rows: [], rowCount: 0 };
  });
}

describe('identity verification tiers', () => {
  test('tier 0 blocks all fiat funding with 403', async () => {
    mockTierRows([]);
    await expect(assertIdentityVerificationTier(fakeClient(), {
      customerId: CUSTOMER_ID,
      amountCents: 1000,
      fundingMethod: 'stripe_topup',
    })).rejects.toMatchObject({ code: 'credit_funding_verification_required', status: 403 });
  });

  test('an expired verification grants tier 0', async () => {
    mockTierRows([verificationRow({ expires_at: new Date(Date.now() - 1000).toISOString() })]);
    await expect(assertIdentityVerificationTier(fakeClient(), {
      customerId: CUSTOMER_ID,
      amountCents: 1000,
      fundingMethod: 'stripe_topup',
    })).rejects.toMatchObject({ code: 'credit_funding_verification_required', status: 403 });
  });

  test('tier 1 allows small top-ups and blocks amounts over its cap', async () => {
    mockTierRows([verificationRow({ requested_tier: 1, tier: 1 })]);
    const ok = await assertIdentityVerificationTier(fakeClient(), {
      customerId: CUSTOMER_ID,
      amountCents: TIER1_TOPUP_MAX_CENTS,
      fundingMethod: 'stripe_topup',
    });
    expect(ok.tier).toBe(1);
    await expect(assertIdentityVerificationTier(fakeClient(), {
      customerId: CUSTOMER_ID,
      amountCents: TIER1_TOPUP_MAX_CENTS + 1,
      fundingMethod: 'stripe_topup',
    })).rejects.toMatchObject({ code: 'credit_funding_tier_limit', status: 403 });
  });

  test('tier 2 allows up to the rail ceiling', async () => {
    mockTierRows([verificationRow()]);
    const ok = await assertIdentityVerificationTier(fakeClient(), {
      customerId: CUSTOMER_ID,
      amountCents: TIER2_TOPUP_MAX_CENTS,
      fundingMethod: 'stripe_topup',
    });
    expect(ok.tier).toBe(2);
  });

  test('admin approval upgrades the customer to the requested tier', async () => {
    const pending = verificationRow({ status: 'pending', tier: 0, reviewed_by: null, reviewed_at: null });
    const approved = verificationRow({ status: 'verified', tier: 2 });
    mockQuery.mockImplementation(async (text) => {
      const sql = String(text);
      if (sql.includes('WHERE id = $1 FOR UPDATE')) return { rows: [pending] };
      if (sql.includes('UPDATE oxsteed_credit_identity_verifications')) return { rows: [approved] };
      if (sql.includes('INSERT INTO oxsteed_credit_audit_events')) return { rows: [] };
      return { rows: [], rowCount: 0 };
    });
    const result = await reviewIdentityVerification({
      verificationId: VERIFICATION_ID,
      decision: 'approve',
      actorUserId: ACTOR_ID,
      reason: 'ID checked against records',
    });
    expect(result.verification.status).toBe('verified');
    expect(result.verification.tier).toBe(2);
    const auditCall = mockQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO oxsteed_credit_audit_events'));
    expect(auditCall).toBeTruthy();
    expect(auditCall[1][0]).toBe('credit.identity.verification_reviewed');
  });

  test('admin rejection closes the row without granting a tier', async () => {
    const pending = verificationRow({ status: 'pending', tier: 0, reviewed_by: null, reviewed_at: null });
    const rejected = verificationRow({ status: 'rejected', tier: 0 });
    mockQuery.mockImplementation(async (text) => {
      const sql = String(text);
      if (sql.includes('WHERE id = $1 FOR UPDATE')) return { rows: [pending] };
      if (sql.includes('UPDATE oxsteed_credit_identity_verifications')) return { rows: [rejected] };
      if (sql.includes('INSERT INTO oxsteed_credit_audit_events')) return { rows: [] };
      return { rows: [], rowCount: 0 };
    });
    const result = await reviewIdentityVerification({
      verificationId: VERIFICATION_ID,
      decision: 'reject',
      actorUserId: ACTOR_ID,
      reason: 'Document unreadable',
    });
    expect(result.verification.status).toBe('rejected');
    expect(result.verification.tier).toBe(0);
  });
});

function screeningRow(overrides = {}) {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    subject_type: 'customer',
    subject_id: CUSTOMER_ID,
    provider: 'manual_review',
    result: 'clear',
    hit_context: null,
    payload_hash: 'hash',
    screened_at: new Date().toISOString(),
    cleared_at: null,
    cleared_by: null,
    clear_reason: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('sanctions screening', () => {
  test('a fresh clear screening passes the gate', async () => {
    mockQuery.mockImplementation(async (text) => {
      const sql = String(text);
      if (sql.includes('FROM oxsteed_credit_sanctions_screenings')) return { rows: [screeningRow()] };
      return { rows: [], rowCount: 0 };
    });
    const result = await assertSanctionsClear(fakeClient(), {
      subjectType: 'customer',
      subjectId: CUSTOMER_ID,
    });
    expect(result.cleared).toBe(false);
    expect(result.screening.result).toBe('clear');
  });

  test('an unscreened subject fails closed with 403 credit_sanctions_match', async () => {
    const hit = screeningRow({ result: 'hit', hit_context: 'manual_review_required' });
    mockQuery.mockImplementation(async (text) => {
      const sql = String(text);
      if (sql.includes('FROM oxsteed_credit_sanctions_screenings') && sql.includes('ORDER BY screened_at')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO oxsteed_credit_sanctions_screenings')) return { rows: [hit] };
      return { rows: [], rowCount: 0 };
    });
    await expect(assertSanctionsClear(fakeClient(), {
      subjectType: 'customer',
      subjectId: CUSTOMER_ID,
    })).rejects.toMatchObject({ code: 'credit_sanctions_match', status: 403 });
  });

  test('an admin-cleared hit passes while the screening is fresh', async () => {
    mockQuery.mockImplementation(async (text) => {
      const sql = String(text);
      if (sql.includes('FROM oxsteed_credit_sanctions_screenings')) {
        return { rows: [screeningRow({ result: 'hit', hit_context: 'manual_review_required', cleared_at: new Date().toISOString(), cleared_by: ACTOR_ID, clear_reason: 'False positive confirmed' })] };
      }
      return { rows: [], rowCount: 0 };
    });
    const result = await assertSanctionsClear(fakeClient(), {
      subjectType: 'customer',
      subjectId: CUSTOMER_ID,
    });
    expect(result.cleared).toBe(true);
  });

  test('a provider error fails closed with 503 and raises an incident', async () => {
    const provider = SCREENING_PROVIDERS.manual_review;
    const original = provider.screenSubject;
    provider.screenSubject = async () => { throw new Error('vendor down'); };
    try {
      const errored = screeningRow({ result: 'error', hit_context: 'vendor down' });
      mockQuery.mockImplementation(async (text) => {
        const sql = String(text);
        if (sql.includes('FROM oxsteed_credit_sanctions_screenings') && sql.includes('ORDER BY screened_at')) {
          return { rows: [] };
        }
        if (sql.includes('INSERT INTO oxsteed_credit_sanctions_screenings')) return { rows: [errored] };
        if (sql.includes('INSERT INTO incident_log')) return { rows: [{ id: 'inc-1' }] };
        if (sql.includes('UPDATE incident_log')) return { rows: [] };
        return { rows: [], rowCount: 0 };
      });
      await expect(assertSanctionsClear(fakeClient(), {
        subjectType: 'partner',
        subjectId: '99',
      })).rejects.toMatchObject({ code: 'credit_sanctions_screening_unavailable', status: 503 });
      const incidentCall = mockQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO incident_log'));
      expect(incidentCall).toBeTruthy();
      expect(incidentCall[1][0]).toBe('oxsteed_credit_sanctions_screening_failed');
    } finally {
      provider.screenSubject = original;
    }
  });
});

function caseRow(overrides = {}) {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    case_type: 'structuring',
    subject_type: 'customer',
    subject_id: CUSTOMER_ID,
    severity: 'high',
    status: 'open',
    evidence: {},
    sla_due_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
    assigned_to: null,
    resolved_by: null,
    resolved_at: null,
    resolution_note: null,
    dedupe_key: 'structuring:customer:' + CUSTOMER_ID,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function mockMonitoringQueries({ structuring = [], velocity = [], rapidOut = [], newPayouts = [] } = {}) {
  mockQuery.mockImplementation(async (text, params) => {
    const sql = String(text);
    if (sql.includes('HAVING COUNT(*)')) return { rows: structuring };
    if (sql.includes('period_volume')) return { rows: velocity };
    if (sql.includes('FROM oxsteed_credit_topups')) return { rows: rapidOut };
    if (sql.includes('FROM oxsteed_credit_settlements')) return { rows: newPayouts };
    if (sql.includes('INSERT INTO oxsteed_credit_compliance_cases')) {
      const caseType = Array.isArray(params) && params[0] ? String(params[0]) : 'structuring';
      return { rows: [caseRow({ case_type: caseType })] };
    }
    return { rows: [], rowCount: 0 };
  });
}

describe('transaction monitoring rules', () => {
  const periodStart = new Date('2026-09-30T00:00:00.000Z');
  const periodEnd = new Date('2026-10-01T00:00:00.000Z');

  test('structuring rule fires and opens a case', async () => {
    mockMonitoringQueries({
      structuring: [{ customer_id: CUSTOMER_ID, tx_count: '3', total_cents: '2850000', min_cents: '900000', max_cents: '990000' }],
    });
    const result = await runTransactionMonitoring({ periodStart, periodEnd, client: fakeClient() });
    expect(result.structuringHits).toBe(1);
    expect(result.casesOpened).toBe(1);
    expect(result.caseIds).toHaveLength(1);
  });

  test('velocity spike rule fires and opens a case', async () => {
    mockMonitoringQueries({
      velocity: [{ customer_id: CUSTOMER_ID, period_cents: '600000', baseline_daily_avg_cents: '100000' }],
    });
    const result = await runTransactionMonitoring({ periodStart, periodEnd, client: fakeClient() });
    expect(result.velocityHits).toBe(1);
    expect(result.casesOpened).toBe(1);
  });

  test('rapid fund-out rule fires and opens a case', async () => {
    mockMonitoringQueries({
      rapidOut: [{
        customer_id: CUSTOMER_ID,
        topup_id: 'top-1',
        topup_cents: '100000',
        funded_at: new Date('2026-09-30T12:00:00.000Z'),
        outbound_tx_id: 'tx-1',
        outbound_type: 'transfer',
        outbound_cents: '95000',
        outbound_at: new Date('2026-09-30T13:00:00.000Z'),
      }],
    });
    const result = await runTransactionMonitoring({ periodStart, periodEnd, client: fakeClient() });
    expect(result.rapidFundOutHits).toBe(1);
    expect(result.casesOpened).toBe(1);
  });

  test('new destination payout rule fires for a first large paid settlement', async () => {
    mockMonitoringQueries({
      newPayouts: [{
        settlement_id: 'set-1',
        partner_id: '7',
        net_cents: '600000',
        currency_code: 'USD',
        paid_at: new Date('2026-09-30T12:00:00.000Z'),
      }],
    });
    const result = await runTransactionMonitoring({ periodStart, periodEnd, client: fakeClient() });
    expect(result.newDestinationPayoutHits).toBe(1);
    expect(result.casesOpened).toBe(1);
  });

  test('no rule fires on a clean period', async () => {
    mockMonitoringQueries({});
    const result = await runTransactionMonitoring({ periodStart, periodEnd, client: fakeClient() });
    expect(result.casesOpened).toBe(0);
    expect(result.structuringHits).toBe(0);
    expect(result.velocityHits).toBe(0);
    expect(result.rapidFundOutHits).toBe(0);
    expect(result.newDestinationPayoutHits).toBe(0);
  });

  test('re-running the same period replays cases without duplicating them', async () => {
    mockQuery.mockImplementation(async (text) => {
      const sql = String(text);
      if (sql.includes('HAVING COUNT(*)')) {
        return { rows: [{ customer_id: CUSTOMER_ID, tx_count: '3', total_cents: '2850000', min_cents: '900000', max_cents: '990000' }] };
      }
      if (sql.includes('period_volume')) return { rows: [] };
      if (sql.includes('FROM oxsteed_credit_topups')) return { rows: [] };
      if (sql.includes('FROM oxsteed_credit_settlements')) return { rows: [] };
      if (sql.includes('INSERT INTO oxsteed_credit_compliance_cases')) {
        // Conflict: dedupe key already taken; replay the existing case.
        if (sql.includes('ON CONFLICT')) return { rows: [] };
        return { rows: [caseRow()] };
      }
      if (sql.includes('WHERE dedupe_key = $1')) return { rows: [caseRow()] };
      return { rows: [], rowCount: 0 };
    });
    const result = await runTransactionMonitoring({ periodStart, periodEnd, client: fakeClient() });
    expect(result.structuringHits).toBe(1);
    expect(result.casesOpened).toBe(0);
    expect(result.caseIds).toHaveLength(0);
  });
});

describe('compliance case SLA breaches', () => {
  test('breached cases raise critical incidents', async () => {
    const breached = caseRow({
      sla_due_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    mockQuery.mockImplementation(async (text) => {
      const sql = String(text);
      if (sql.includes('FROM oxsteed_credit_compliance_cases')) return { rows: [breached] };
      if (sql.includes('INSERT INTO incident_log')) return { rows: [{ id: 'inc-9' }] };
      if (sql.includes('UPDATE incident_log')) return { rows: [] };
      return { rows: [], rowCount: 0 };
    });
    const result = await checkComplianceCaseSla({ client: fakeClient() });
    expect(result.breachedCount).toBe(1);
    expect(result.incidents).toHaveLength(1);
    const incidentCall = mockQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO incident_log'));
    expect(incidentCall[1][0]).toBe('oxsteed_credit_compliance_sla_breach');
    expect(incidentCall[1][1]).toBe('critical');
  });

  test('no incidents when nothing breached the SLA', async () => {
    mockQuery.mockImplementation(async () => ({ rows: [], rowCount: 0 }));
    const result = await checkComplianceCaseSla({ client: fakeClient() });
    expect(result.breachedCount).toBe(0);
    expect(result.incidents).toHaveLength(0);
  });
});

function challengeRow(overrides = {}) {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    actor_user_id: CUSTOMER_ID,
    action_type: 'topup',
    amount_cents: 150000,
    currency_code: 'USD',
    code_hash: 'ab'.repeat(32),
    attempts: 0,
    max_attempts: 5,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    consumed_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('step-up challenges', () => {
  test('missing challenge id or code fails with 403', async () => {
    await expect(verifyStepupChallenge({
      challengeId: null,
      actorUserId: CUSTOMER_ID,
      actionType: 'topup',
      code: '123456',
    })).rejects.toMatchObject({ code: 'credit_stepup_challenge_required', status: 403 });
  });

  test('an expired challenge is rejected', async () => {
    mockQuery.mockImplementation(async (text) => {
      const sql = String(text);
      if (sql.includes('FROM oxsteed_credit_stepup_challenges')) {
        return { rows: [challengeRow({ expires_at: new Date(Date.now() - 1000).toISOString() })] };
      }
      return { rows: [], rowCount: 0 };
    });
    await expect(verifyStepupChallenge({
      challengeId: '66666666-6666-4666-8666-666666666666',
      actorUserId: CUSTOMER_ID,
      actionType: 'topup',
      code: '123456',
    })).rejects.toMatchObject({ code: 'credit_stepup_challenge_expired', status: 403 });
  });

  test('a wrong code is rejected and counted', async () => {
    mockQuery.mockImplementation(async (text) => {
      const sql = String(text);
      if (sql.includes('FROM oxsteed_credit_stepup_challenges')) return { rows: [challengeRow()] };
      if (sql.includes('UPDATE oxsteed_credit_stepup_challenges')) return { rows: [] };
      return { rows: [], rowCount: 0 };
    });
    await expect(verifyStepupChallenge({
      challengeId: '66666666-6666-4666-8666-666666666666',
      actorUserId: CUSTOMER_ID,
      actionType: 'topup',
      code: '000000',
    })).rejects.toMatchObject({ code: 'credit_stepup_challenge_invalid', status: 403 });
    const attemptCall = mockQuery.mock.calls.find(([sql]) => String(sql).includes('SET attempts = $2'));
    expect(attemptCall).toBeTruthy();
    expect(attemptCall[1][1]).toBe(1);
  });

  test('the correct code verifies and consumes the challenge', async () => {
    const code = '123456';
    const codeHash = crypto.createHmac('sha256', 'test-pepper').update(`stepup:${code}`).digest('hex');
    mockQuery.mockImplementation(async (text) => {
      const sql = String(text);
      if (sql.includes('FROM oxsteed_credit_stepup_challenges')) return { rows: [challengeRow({ code_hash: codeHash })] };
      if (sql.includes('UPDATE oxsteed_credit_stepup_challenges')) return { rows: [] };
      return { rows: [], rowCount: 0 };
    });
    const result = await verifyStepupChallenge({
      challengeId: '66666666-6666-4666-8666-666666666666',
      actorUserId: CUSTOMER_ID,
      actionType: 'topup',
      code,
    });
    expect(result.verified).toBe(true);
    const consumeCall = mockQuery.mock.calls.find(([sql]) => String(sql).includes('SET consumed_at = NOW()'));
    expect(consumeCall).toBeTruthy();
  });

  test('a challenge for another actor or action is rejected', async () => {
    mockQuery.mockImplementation(async (text) => {
      const sql = String(text);
      if (sql.includes('FROM oxsteed_credit_stepup_challenges')) return { rows: [challengeRow()] };
      return { rows: [], rowCount: 0 };
    });
    await expect(verifyStepupChallenge({
      challengeId: '66666666-6666-4666-8666-666666666666',
      actorUserId: ACTOR_ID,
      actionType: 'topup',
      code: '123456',
    })).rejects.toMatchObject({ code: 'credit_stepup_challenge_invalid', status: 403 });
  });
});

describe('openComplianceCase idempotency', () => {
  test('replays the existing case on a dedupe conflict', async () => {
    mockQuery.mockImplementation(async (text) => {
      const sql = String(text);
      if (sql.includes('INSERT INTO oxsteed_credit_compliance_cases')) return { rows: [] };
      if (sql.includes('WHERE dedupe_key = $1')) return { rows: [caseRow()] };
      return { rows: [], rowCount: 0 };
    });
    const { case: c, replayed } = await openComplianceCase(fakeClient(), {
      caseType: 'structuring',
      subjectType: 'customer',
      subjectId: CUSTOMER_ID,
      dedupeKey: 'structuring:' + CUSTOMER_ID + ':2026-09-30',
    });
    expect(replayed).toBe(true);
    expect(c.id).toBe('55555555-5555-4555-8555-555555555555');
  });
});
