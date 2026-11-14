'use strict';

// Unit tests for the Domain 9 (2026-11-13) careers batch caps, with a fake
// db that records every query: item 6 (candidate-alert hits INSERT capped
// at 1,000 with a truncated flag) and P1 (offer expiry sweep bounded per
// tick). The LIMIT itself is enforced by Postgres; these tests prove the
// bound is wired into the SQL and the truncated flag is recorded. The
// end-to-end cap is covered in careersMarketplace.db.test.js.

const candidates = require('../services/careers/marketplace/candidates');
const offers = require('../services/careers/offers');

function fakeDb(handlers) {
  const seen = [];
  return {
    seen,
    async query(sql, params = []) {
      seen.push({ sql, params });
      for (const [match, fn] of handlers) {
        if (sql.includes(match)) return fn(sql, params, seen);
      }
      throw new Error(`unexpected query: ${sql.slice(0, 120)}`);
    },
  };
}

function alertRow(over = {}) {
  return {
    id: 11,
    business_id: 7,
    created_by: null, // skips deliver(); the cap, not the notice, is under test
    name: 'Grill cooks',
    criteria: { near_location: 3, radius_km: 25, skills: [], available_now: false },
    paused: false,
    ...over,
  };
}

function candidateAlertsDb({ hitCount, probeRows }) {
  return fakeDb([
    ['FROM career_candidate_alerts a JOIN businesses', async () => ({ rows: [alertRow()] })],
    ['FROM restaurant_locations WHERE id', async () => ({ rows: [{ latitude: 25.77, longitude: -80.19 }] })],
    ['INSERT INTO career_candidate_alert_hits', async () => ({
      rows: Array.from({ length: hitCount }, (_, i) => ({ user_id: `user-${i}` })),
    })],
    ['NOT EXISTS (SELECT 1 FROM career_candidate_alert_hits h', async () => ({ rows: probeRows })],
    ['UPDATE career_candidate_alerts SET last_run_at', async () => ({ rows: [] })],
  ]);
}

describe('item 6: candidate-alert hits cap', () => {
  test('hits INSERT carries LIMIT 1000 and a full run that still has matches is flagged truncated', async () => {
    const db = candidateAlertsDb({ hitCount: candidates.MAX_HITS_PER_ALERT_RUN, probeRows: [{ '?column?': 1 }] });
    const result = await candidates.runCandidateAlerts(db);
    expect(result).toEqual({ alerts: 1, notified: 0, truncated: 1 });

    const insert = db.seen.find((q) => q.sql.includes('INSERT INTO career_candidate_alert_hits'));
    expect(insert.sql).toMatch(/LIMIT \$8/);
    expect(insert.params[7]).toBe(candidates.MAX_HITS_PER_ALERT_RUN);
    expect(candidates.MAX_HITS_PER_ALERT_RUN).toBe(1000);

    // The probe ran (cap reached) and found one more match.
    expect(db.seen.some((q) => q.sql.includes('NOT EXISTS (SELECT 1 FROM career_candidate_alert_hits h'))).toBe(true);
    const update = db.seen.find((q) => q.sql.includes('UPDATE career_candidate_alerts SET last_run_at'));
    expect(update.params).toEqual([11, expect.any(Date), true, candidates.MAX_HITS_PER_ALERT_RUN]);
  });

  test('a run under the cap records truncated=false and pays no probe query', async () => {
    const db = candidateAlertsDb({ hitCount: 2, probeRows: [] });
    const result = await candidates.runCandidateAlerts(db);
    expect(result).toEqual({ alerts: 1, notified: 0, truncated: 0 });
    expect(db.seen.some((q) => q.sql.includes('NOT EXISTS (SELECT 1 FROM career_candidate_alert_hits h'))).toBe(false);
    const update = db.seen.find((q) => q.sql.includes('UPDATE career_candidate_alerts SET last_run_at'));
    expect(update.params).toEqual([11, expect.any(Date), false, 2]);
  });

  test('a run that lands exactly on the cap with no further match is not flagged', async () => {
    const db = candidateAlertsDb({ hitCount: candidates.MAX_HITS_PER_ALERT_RUN, probeRows: [] });
    const result = await candidates.runCandidateAlerts(db);
    expect(result).toEqual({ alerts: 1, notified: 0, truncated: 0 });
    const update = db.seen.find((q) => q.sql.includes('UPDATE career_candidate_alerts SET last_run_at'));
    expect(update.params[2]).toBe(false);
  });
});

describe('P1: offer expiry sweep cap', () => {
  test('both UPDATE...RETURNING claims carry the 200-per-tick bound', async () => {
    const expiredOffers = [
      { id: 1, application_id: 10 },
      { id: 2, application_id: 11 },
      { id: 3, application_id: 12 },
    ];
    const db = fakeDb([
      ['UPDATE career_offers SET status', async () => ({ rows: expiredOffers })],
      ['FROM career_applications a JOIN career_openings', async () => ({ rows: [] })], // no app: skip notify
      ['UPDATE career_offers SET expiry_warned_at', async () => ({ rows: [] })],
      ['UPDATE career_invitations SET status', async () => ({ rowCount: 0 })],
    ]);
    const result = await offers.sweepOffers(db);
    expect(result).toEqual({ expired: 3, warned: 0, invitationsExpired: 0 });

    const expire = db.seen.find((q) => q.sql.includes('UPDATE career_offers SET status'));
    expect(expire.sql).toMatch(/LIMIT \$1/);
    expect(expire.params).toEqual([offers.SWEEP_BATCH_LIMIT]);
    expect(offers.SWEEP_BATCH_LIMIT).toBe(200);
    const warn = db.seen.find((q) => q.sql.includes('UPDATE career_offers SET expiry_warned_at'));
    expect(warn.sql).toMatch(/LIMIT \$1/);
    expect(warn.params).toEqual([offers.SWEEP_BATCH_LIMIT]);
    // The three claimed offers each had their application looked up once.
    expect(db.seen.filter((q) => q.sql.includes('FROM career_applications a JOIN career_openings'))).toHaveLength(3);
  });
});
