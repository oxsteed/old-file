'use strict';
const { mockQuery, resetMocks } = require('./setup');

jest.mock('../jobs/scheduledDeletionJob', () => ({ hardDeleteUser: jest.fn() }));
jest.mock('../services/accountDeletionGuard', () => ({ findFinancialBlockers: jest.fn(), cancelSubscriptionsForDeletion: jest.fn() }));
jest.mock('../growth/rights', () => ({ removePersonalizedOffers: jest.fn() }));
jest.mock('../jobs/jobLockingService', () => ({ withFencedJobLock: jest.fn(async (_name, fn) => fn({
  db: require('../db'), assertActive() {}, fencedTransaction: async fn => fn(require('../db')),
})) }));
jest.mock('../growth/queue', () => ({ eraseSubject: jest.fn() }));
jest.mock('../growth/clickhouse', () => ({ getClient: jest.fn() }));
jest.mock('../services/incidentStore', () => ({ recordIncident: jest.fn() }));

const erasure = require('../services/ccpaErasureService');
const deletion = require('../jobs/scheduledDeletionJob');
const guard = require('../services/accountDeletionGuard');
const rights = require('../growth/rights');
const clickhouse = require('../growth/clickhouse');
const incidentStore = require('../services/incidentStore');
const growthErasure = require('../jobs/growthErasure');
const guideHelpCache = require('../services/guideHelpCache');
const { _buildSuspectPairsIndexed } = require('../controllers/oneTruthController');

const previousEnv = { pepper: process.env.GROWTH_SUBJECT_PEPPER, ch: process.env.GROWTH_CLICKHOUSE_URL, maxPairs: process.env.ONE_TRUTH_MAX_PAIRS };
beforeEach(() => {
  resetMocks();
  incidentStore.recordIncident.mockClear();
  rights.removePersonalizedOffers.mockClear();
  deletion.hardDeleteUser.mockReset();
  guard.findFinancialBlockers.mockResolvedValue([]);
  guard.cancelSubscriptionsForDeletion.mockResolvedValue(undefined);
  rights.removePersonalizedOffers.mockResolvedValue({ offer_deliveries_skipped: 0, personalized_recipients_removed: 0 });
  incidentStore.recordIncident.mockResolvedValue({ persisted: true });
  delete process.env.GROWTH_SUBJECT_PEPPER;
  delete process.env.GROWTH_CLICKHOUSE_URL;
  delete process.env.GROWTH_ERASURE_MAX_VERIFICATION_ATTEMPTS;
  delete process.env.ONE_TRUTH_MAX_PAIRS;
});
afterEach(() => {
  for (const [key, value] of [['GROWTH_SUBJECT_PEPPER', previousEnv.pepper], ['GROWTH_CLICKHOUSE_URL', previousEnv.ch], ['ONE_TRUTH_MAX_PAIRS', previousEnv.maxPairs]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

describe('Oct 25 #3: RESTRICT references land in needs_review, never silent retry', () => {
  test('credit_adjustments proposer blocks erasure with a named reference', async () => {
    mockQuery.mockImplementation(async sql => ({
      rows: String(sql).includes('FROM credit_adjustments')
        ? [{ customer_ref: false, proposed_ref: true, approved_ref: false }]
        : [],
    }));
    await expect(erasure.assertNoRestrictReferences('subject'))
      .rejects.toMatchObject({ statusCode: 409, code: 'ccpa_restrict_reference', detail: 'credit_adjustments.proposed_by' });
  });

  test('no restrict reference passes the check', async () => {
    mockQuery.mockImplementation(async () => ({ rows: [] }));
    await expect(erasure.assertNoRestrictReferences('subject')).resolves.toBeUndefined();
  });

  test('an unhandled 23503 from hardDeleteUser lands in needs_review, not pending', async () => {
    const failure = new Error('update or delete on table "users" violates foreign key constraint');
    failure.code = '23503';
    deletion.hardDeleteUser.mockRejectedValue(failure);
    const db = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ request_id: 9, subject_id: 'subject', attempts: 1 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] }) };
    mockQuery.mockImplementation(async sql => ({
      rows: String(sql).startsWith('SELECT id,role') ? [{ id: 'subject', role: 'customer' }] : [],
    }));
    await erasure.processErasureJobs({ db });
    expect(db.query.mock.calls[1][1][2]).toBe('needs_review');
    expect(db.query.mock.calls[1][1][3]).toBe('23503');
  });
});

describe('Oct 25 #17: opt-out completion records a suppression action', () => {
  function mockOptOutRequest() {
    mockQuery.mockImplementation(async sql => {
      const text = String(sql);
      if (text.startsWith('SELECT * FROM ccpa_data_requests')) {
        return { rows: [{ id: 11, user_id: 'subject', status: 'pending', request_type: 'opt_out', email: 'fixture@example.invalid', data_provided: null }] };
      }
      return { rows: [], rowCount: 0 };
    });
  }

  test('without a growth identity, the audit row and request stamp still record the opt-out', async () => {
    mockOptOutRequest();
    const result = await erasure.completeRequest(11, 'admin');
    expect(result.completed).toBe(true);
    expect(result.suppression).toMatchObject({ source: 'ccpa_opt_out', growth_suppression: 'unavailable' });
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes("action_type") && String(sql).includes('ccpa_opt_out_suppression'))).toBe(true);
    // The suppression stamp is merged into data_provided by its own UPDATE
    // (the JSON payload travels as a bound parameter, not SQL text).
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('SET') && String(sql).includes('data_provided'))).toBe(true);
    const completedCall = mockQuery.mock.calls.find(([sql]) => String(sql).includes("status='completed'"));
    expect(completedCall).toBeDefined();
  });

  test('with a growth identity, the suppression list and pending deliveries are actioned', async () => {
    process.env.GROWTH_SUBJECT_PEPPER = 'p'.repeat(32);
    rights.removePersonalizedOffers.mockResolvedValue({ offer_deliveries_skipped: 2, personalized_recipients_removed: 1 });
    mockOptOutRequest();
    const result = await erasure.completeRequest(11, 'admin');
    expect(result.suppression).toMatchObject({ growth_suppression: 'recorded', offer_deliveries_skipped: 2, personalized_recipients_removed: 1 });
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO marketing_suppressions'))).toBe(true);
    expect(rights.removePersonalizedOffers).toHaveBeenCalled();
  });
});

describe('Oct 25 #14: growth erasure verification failure is capped and parked', () => {
  function mockErasureRun(bumpedAttempts) {
    process.env.GROWTH_CLICKHOUSE_URL = 'http://localhost:8123';
    const store = {
      command: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue({ json: async () => [{ remaining: 1 }] }),
    };
    clickhouse.getClient.mockReturnValue(store);
    mockQuery.mockImplementation(async sql => {
      const text = String(sql);
      if (text.includes('FROM growth_erasure_queue') && text.includes('SELECT *')) {
        return { rows: [{ id: 4, subject_key: 's'.repeat(64), device_keys: [] }] };
      }
      if (text.includes('verification_attempts = verification_attempts + 1')) {
        return { rows: [{ id: 4, verification_attempts: bumpedAttempts }] };
      }
      return { rows: [] };
    });
  }

  test('verificationCap defaults to 3 and honors the env override', () => {
    expect(growthErasure.verificationCap()).toBe(3);
    expect(growthErasure.verificationCap({ GROWTH_ERASURE_MAX_VERIFICATION_ATTEMPTS: '5' })).toBe(5);
    expect(growthErasure.verificationCap({ GROWTH_ERASURE_MAX_VERIFICATION_ATTEMPTS: '0' })).toBe(3);
  });

  test('below the cap the run still throws so the next hour retries', async () => {
    mockErasureRun(1);
    await expect(growthErasure.run()).rejects.toThrow('growth_erasure_verification_failed');
    expect(incidentStore.recordIncident).not.toHaveBeenCalled();
  });

  test('at the cap the batch parks with a high incident instead of throwing', async () => {
    mockErasureRun(3);
    const result = await growthErasure.run();
    expect(result).toMatchObject({ completed: 0, parked: 1, verificationAttempts: 3 });
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes("status = 'parked'"))).toBe(true);
    expect(incidentStore.recordIncident).toHaveBeenCalledWith(expect.objectContaining({
      type: 'growth_erasure_verification_parked', severity: 'high', dedupeKey: 'growth:erasure:verification-parked',
    }));
  });
});

describe('Oct 25 #12: indexed suspect path is capped like the scoped path', () => {
  test('pairs across many small groups abort at maxPairs instead of growing unbounded', async () => {
    process.env.ONE_TRUTH_MAX_PAIRS = '5';
    const groups = [
      { phone: '1', user_ids: ['a', 'b', 'c'] },
      { phone: '2', user_ids: ['d', 'e', 'f'] },
    ];
    const client = { query: jest.fn()
      .mockResolvedValueOnce({ rows: groups })
      .mockResolvedValueOnce({ rows: [] }) };
    await expect(_buildSuspectPairsIndexed(client, ['a', 'b', 'c', 'd', 'e', 'f'], { mode: 'pairwise' }))
      .rejects.toMatchObject({ statusCode: 413, code: 'one_truth_pair_limit_exceeded' });
  });
});

describe('Oct 25 #17: suppression is recorded before the completed stamp', () => {
  test('the suppression audit row precedes the completed update in call order', async () => {
    mockQuery.mockImplementation(async sql => {
      const text = String(sql);
      if (text.startsWith('SELECT * FROM ccpa_data_requests')) {
        return { rows: [{ id: 13, user_id: 'subject', status: 'pending', request_type: 'opt_out', email: 'fixture@example.invalid', data_provided: null }] };
      }
      return { rows: [], rowCount: 0 };
    });
    const result = await erasure.completeRequest(13, 'admin');
    expect(result.completed).toBe(true);
    expect(result.suppression.source).toBe('ccpa_opt_out');
    const completedCall = mockQuery.mock.calls.find(([sql]) => String(sql).includes("status='completed'"));
    const suppressionCall = mockQuery.mock.calls.find(([sql]) => String(sql).includes('ccpa_opt_out_suppression'));
    expect(suppressionCall).toBeDefined();
    expect(mockQuery.mock.calls.indexOf(suppressionCall)).toBeLessThan(mockQuery.mock.calls.indexOf(completedCall));
  });
});

describe('Oct 25 #19: guide cache invalidation from the edit path', () => {
  test('invalidateGuideCache deletes every key for the guide id across revisions', async () => {
    const deleted = [];
    const redis = {
      scan: jest.fn()
        .mockResolvedValueOnce(['7', ['ox:ai:guide:v4-2026-10-19:g1:step:1:lang:en:q:aa']])
        .mockResolvedValueOnce(['0', ['ox:ai:guide:v4-2026-10-19:g1:step:2:lang:en:q:bb']]),
      del: jest.fn(async (...keys) => { deleted.push(...keys); return keys.length; }),
    };
    expect(await guideHelpCache.invalidateGuideCache(redis, 'g1')).toBe(2);
    expect(redis.scan.mock.calls[0][1]).toBe('MATCH');
    expect(redis.scan.mock.calls[0][2]).toContain('g1');
    expect(deleted).toHaveLength(2);
  });

  test('invalidation fails open when Redis is missing or errors', async () => {
    expect(await guideHelpCache.invalidateGuideCache(null, 'g1')).toBe(0);
    const redis = { scan: jest.fn().mockRejectedValue(new Error('down')), del: jest.fn() };
    expect(await guideHelpCache.invalidateGuideCache(redis, 'g1')).toBe(0);
    expect(redis.del).not.toHaveBeenCalled();
  });
});
