'use strict';
// Cost audit 2026-11-13 item 9: a nightly rollup block must build gate
// contexts once (for the outer eligibility pass) and reuse them inside
// the write transaction, rebuilding only users whose gate inputs moved
// between the build and the write. A consent withdrawal in that window
// must still be caught by the in-transaction revalidation.
const { mockQuery, resetMocks } = require('./setup');

jest.mock('../jobs/jobLockingService', () => ({
  withFencedJobLock: jest.fn(async (_name, fn) =>
    fn({
      db: require('../db'),
      assertActive() {},
      fencedTransaction: async (tx) => tx(require('../db')),
    }),
  ),
}));
jest.mock('../growth/rollups/domain', () => ({
  collectDomainDay: jest.fn(async () => ({ sources: { food: 0 } })),
  addDemand: jest.fn(),
  addSupply: jest.fn(),
  key3: jest.fn(),
}));
jest.mock('../growth/propensity', () => ({ computeAll: jest.fn() }));
jest.mock('../growth/geo/resolve', () => ({
  resolveBatch: jest.fn(async () => [null]),
}));
let mockClickhouseClient;
jest.mock('../growth/clickhouse', () => ({
  getClient: jest.fn(() => mockClickhouseClient),
}));

const ROLLOUT = {
  id: 1,
  policy_version: 'v1',
  state: 'effective',
  effective_at: '2026-01-01T00:00:00.000Z',
  legal_review_ref: 'ref',
  translations_reviewed: true,
  rights_verified: true,
};
const RULES = [{ code: 'default', activity_basis: 'notice', offers_basis: 'notice', sale_share_control: false, reviewed_at: '2026-01-01T00:00:00.000Z' }];
const JURISDICTION = { code: 'default', basis: 'notice', offersBasis: 'notice', saleShare: false, reviewed: true };

function userRow(id) {
  return {
    id,
    role: 'helper',
    is_active: true,
    is_banned: false,
    deleted_at: null,
    is_suspended: false,
    country: 'US',
    country_confirmed: true,
    city: 'Springfield',
    state: 'OH',
    zip_code: '45501',
    preferred_language: 'en',
    created_at: '2026-01-01T00:00:00.000Z',
    adult_confirmed: true,
    is_internal: false,
  };
}
function ctxFor(id, subjectKey, consents) {
  return {
    enabled: true,
    rollout: ROLLOUT,
    user: userRow(id),
    eligibility: userRow(id),
    subjectKey,
    consents,
    trustedSignals: ['s1'],
    jurisdiction: JURISDICTION,
    impersonated: false,
    gpc: false,
  };
}

const gate = require('../growth/gate');
jest.mock('../growth/gate', () => ({
  contexts: jest.fn(),
  allow: jest.fn(async (ctx) => ({
    allowed: ctx?.consents?.activity_offers !== false,
    context: ctx,
  })),
  runtimePolicy: jest.fn(async () => ({ enabled: true, rollout: ROLLOUT, rules: RULES })),
  resolveJurisdiction: jest.fn(() => JURISDICTION),
}));

const { key } = require('../growth/identity');
const propensity = require('../growth/propensity');
const { run } = require('../jobs/growthNightlyRollups');

const prevEnv = {
  off: process.env.GROWTH_TRACKING_HARD_OFF,
  ch: process.env.GROWTH_CLICKHOUSE_URL,
  pepper: process.env.GROWTH_SUBJECT_PEPPER,
};

let skA;
let skB;
let freshConsentsA;
let contextsCalls;

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(Date.parse('2026-10-25T04:00:00Z'));
  process.env.GROWTH_TRACKING_HARD_OFF = 'false';
  process.env.GROWTH_CLICKHOUSE_URL = 'http://clickhouse.test';
  process.env.GROWTH_SUBJECT_PEPPER = 'p'.repeat(32);
  propensity.computeAll.mockReset();
  propensity.computeAll.mockResolvedValue({ users: 0 });
  skA = key('subject', 'user-a');
  skB = key('subject', 'user-b');
  freshConsentsA = [['activity_offers', true, 'v1']];
  contextsCalls = 0;
  // First contexts() call (outer build) returns the eligible ctx; a
  // rebuild call returns the withdrawn ctx for user-a.
  gate.contexts.mockImplementation(async (ids) => {
    contextsCalls += 1;
    const first = contextsCalls === 1;
    const m = new Map();
    for (const id of ids) {
      if (id === 'user-a')
        m.set(id, ctxFor(id, skA, first ? { activity_offers: true } : { activity_offers: false }));
      if (id === 'user-b') m.set(id, ctxFor(id, skB, { activity_offers: false }));
    }
    return m;
  });
  mockClickhouseClient = {
    query: jest.fn(async () => ({
      stream: async function* () {
        yield [
          { json: () => ({ subject_key: skA, postal_ref: 45501, event_name: 'job.posted', entity_type: 'job', entity_id: 'job-1' }) },
          { json: () => ({ subject_key: skB, postal_ref: 45501, event_name: 'job.posted', entity_type: 'job', entity_id: 'job-2' }) },
        ];
      },
    })),
  };
  mockQuery.mockImplementation(async (sql) => {
    if (sql.includes('INSERT INTO growth_rollup_runs')) return { rows: [{ id: 5 }] };
    if (sql.includes('FROM growth_subject_eligibility'))
      return { rows: [{ subject_key: skA, user_id: 'user-a' }, { subject_key: skB, user_id: 'user-b' }] };
    if (sql.includes('growth_rollup_freshness'))
      return { rows: [{ ...userRow('user-a'), consents: freshConsentsA }] };
    if (sql.includes('SELECT DISTINCT ON(i.entity_id)'))
      return { rows: [{ entity_id: 'job-1', node_id: 7, sensitive: false }] };
    return { rows: [] };
  });
});

afterEach(() => {
  jest.useRealTimers();
  for (const [k, v] of Object.entries(prevEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

test('unchanged inputs reuse the outer contexts: one contexts build per block', async () => {
  const result = await run({ day: '2026-10-24' });
  expect(result.profiles).toBe(1);
  expect(gate.contexts).toHaveBeenCalledTimes(1);
  expect(gate.contexts).toHaveBeenCalledWith(['user-a', 'user-b'], expect.objectContaining({ db: expect.anything() }));
  expect(mockQuery.mock.calls.some(([sql]) => sql.includes('INSERT INTO user_interest_profiles'))).toBe(true);
});

test('a consent withdrawn between build and write triggers a rebuild and the row is dropped', async () => {
  freshConsentsA = [['activity_offers', false, 'v1']];
  const result = await run({ day: '2026-10-24' });
  expect(result.profiles).toBe(0);
  expect(gate.contexts).toHaveBeenCalledTimes(2);
  expect(gate.contexts).toHaveBeenNthCalledWith(2, ['user-a'], expect.objectContaining({ db: expect.anything() }));
  expect(mockQuery.mock.calls.some(([sql]) => sql.includes('INSERT INTO user_interest_profiles'))).toBe(false);
});
