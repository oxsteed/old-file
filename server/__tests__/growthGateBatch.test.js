'use strict';

// Notifications audit item 40: growthNightlyRollups awaited gate.allow()
// twice per row, sequentially, even though the contexts were already built
// and decide() is pure. gate.js exposed no batch API.
// Reproduction: allowMany does not exist, so a block cannot decide once
// per user.

jest.mock('../db', () => ({ query: jest.fn(), connect: jest.fn() }));

const gate = require('../growth/gate');

const ROLLOUT = {
  id: 1,
  policy_version: 'v1',
  state: 'effective',
  effective_at: '2026-01-01T00:00:00.000Z',
  legal_review_ref: 'ref',
  translations_reviewed: true,
  rights_verified: true,
};
const JURISDICTION = { code: 'default', basis: 'notice', offersBasis: 'notice', saleShare: false, reviewed: true };

function ctxFor(id, consents) {
  const user = {
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
  return {
    enabled: true,
    rollout: ROLLOUT,
    user,
    eligibility: user,
    subjectKey: `sk:${id}`,
    consents,
    trustedSignals: ['s1'],
    jurisdiction: JURISDICTION,
    impersonated: false,
    gpc: false,
  };
}

beforeEach(() => {
  process.env.GROWTH_TRACKING_HARD_OFF = 'false';
});

afterEach(() => {
  delete process.env.GROWTH_TRACKING_HARD_OFF;
});

test('allowMany decides a whole block from already-built contexts', async () => {
  const contexts = new Map([
    ['user-a', ctxFor('user-a', { activity_offers: true })],
    ['user-b', ctxFor('user-b', { activity_offers: false })],
  ]);
  const decisions = gate.allowMany(contexts, 'activity_offers');
  expect(decisions).toBeInstanceOf(Map);
  expect(decisions.get('user-a')).toMatchObject({ allowed: true, context: contexts.get('user-a') });
  expect(decisions.get('user-b')).toMatchObject({ allowed: false, reason: 'offers_withdrawn' });
  // Same verdicts as the single-input API, per user.
  for (const [id, ctx] of contexts) {
    const single = await gate.allow(ctx, 'activity_offers');
    expect(decisions.get(id).allowed).toBe(single.allowed);
    expect(decisions.get(id).reason).toBe(single.reason);
  }
});

test('allowMany accepts an array of [id, context] pairs', () => {
  const decisions = gate.allowMany([['user-a', ctxFor('user-a', { activity_offers: true })]], 'activity_offers');
  expect(decisions.get('user-a').allowed).toBe(true);
});

test('allowMany denies a missing context instead of throwing', () => {
  const decisions = gate.allowMany(new Map([['user-a', null], ['user-b', undefined]]), 'activity_offers');
  expect(decisions.get('user-a')).toMatchObject({ allowed: false });
  expect(decisions.get('user-b')).toMatchObject({ allowed: false });
});

test('allowMany denies every context for an unknown purpose', () => {
  const decisions = gate.allowMany(new Map([['user-a', ctxFor('user-a', {})]]), 'no_such_purpose');
  expect(decisions.get('user-a')).toMatchObject({ allowed: false, reason: 'unknown_purpose' });
});
