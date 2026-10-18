'use strict';

/**
 * Parity tests: NPS canonical sources.
 *
 * Three tables carry NPS-ish data; only two are NPS sources:
 *   - support_nps_index: support_conversation_reviews (proper NPS index =
 *     %promoters (score >= 9) − %detractors (score <= 6)). Already used by
 *     the support CSAT summary route.
 *   - consulting_avg_nps: consulting_session_feedback (AVG of nps_score).
 *     The feedback_trends view aggregates consulting_session_followups'
 *     feedback_rating — a rating trend with NO nps_score column — and must
 *     never be labeled or consumed as NPS.
 */
const crypto = require('crypto');
const schema = `mreg_nps_${crypto.randomBytes(6).toString('hex')}`;
const url = process.env.STATEMENT_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/credit_statement_test') {
    throw new Error('fixtures require the disposable statement test database');
  }
  target.searchParams.set('options', `-c search_path=${schema},public`);
  process.env.DATABASE_URL = target.toString();
}
jest.unmock('pg');
jest.unmock('../db');

const db = require('../db');
const registry = require('../analytics/metricsRegistry');

const describeDb = url ? describe : describe.skip;

describeDb('metrics registry: NPS canonical sources', () => {
  beforeAll(async () => {
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`CREATE TABLE ${schema}.support_conversations (
      id SERIAL PRIMARY KEY, business_id INTEGER)`);
    await db.query(`CREATE TABLE ${schema}.support_conversation_reviews (
      id SERIAL PRIMARY KEY, conversation_id INTEGER NOT NULL,
      nps_score INTEGER, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await db.query(`CREATE TABLE ${schema}.consulting_session_feedback (
      id SERIAL PRIMARY KEY, nps_score INTEGER)`);
    await db.query(`CREATE TABLE ${schema}.consulting_session_followups (
      id SERIAL PRIMARY KEY, feedback_rating INTEGER)`);
  });

  afterAll(async () => {
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await db.end();
  });

  beforeEach(async () => {
    await db.query(`TRUNCATE ${schema}.support_conversation_reviews, ${schema}.support_conversations, ${schema}.consulting_session_feedback, ${schema}.consulting_session_followups`);
    await db.query(`INSERT INTO support_conversations (id, business_id) VALUES (1, 7)`);
    // Support reviews: 2 promoters (10,9), 2 passives (8,7), 1 detractor (5),
    // 1 NULL (must be ignored) -> index = (2-1)/5*100 = 20.0
    await db.query(`INSERT INTO support_conversation_reviews (conversation_id, nps_score) VALUES
      (1, 10), (1, 9), (1, 8), (1, 7), (1, 5), (1, NULL)`);
    // Consulting feedback: avg of (8,9,10) = 9.0
    await db.query(`INSERT INTO consulting_session_feedback (nps_score) VALUES (8), (9), (10), (NULL)`);
    // Followup RATINGS (not NPS): perfect 5s — must not leak into either metric
    await db.query(`INSERT INTO consulting_session_followups (feedback_rating) VALUES (5), (5), (5)`);
  });

  test('support NPS index uses promoters-minus-detractors from conversation reviews', async () => {
    const { nps_index, responses } = await registry.supportNpsIndex(db, { businessId: 7 });
    expect(nps_index).toBeCloseTo(20.0, 1);
    expect(responses).toBe(5);
  });

  test('support NPS is null with no responses', async () => {
    await db.query(`TRUNCATE ${schema}.support_conversation_reviews`);
    const { nps_index, responses } = await registry.supportNpsIndex(db, { businessId: 7 });
    expect(nps_index).toBeNull();
    expect(responses).toBe(0);
  });

  test('consulting NPS averages nps_score from session feedback only', async () => {
    const { avg_nps, responses } = await registry.consultingAvgNps(db);
    expect(avg_nps).toBeCloseTo(9.0, 5);
    expect(responses).toBe(3);
  });

  test('followup ratings cannot move either NPS metric', async () => {
    // Even with 100 perfect followup ratings, NPS is unchanged: the
    // feedback_trends source is a rating trend, not an NPS source.
    for (let i = 0; i < 100; i++) {
      await db.query(`INSERT INTO consulting_session_followups (feedback_rating) VALUES (5)`);
    }
    const c = await registry.consultingAvgNps(db);
    expect(c.avg_nps).toBeCloseTo(9.0, 5);
    const s = await registry.supportNpsIndex(db, {});
    expect(s.nps_index).toBeCloseTo(20.0, 1);
  });

  test('support NPS scopes to the business', async () => {
    await db.query(`INSERT INTO support_conversations (id, business_id) VALUES (2, 8)`);
    await db.query(`INSERT INTO support_conversation_reviews (conversation_id, nps_score) VALUES (2, 0), (2, 0)`);
    const other = await registry.supportNpsIndex(db, { businessId: 8 });
    expect(other.nps_index).toBeCloseTo(-100.0, 1);
    const own = await registry.supportNpsIndex(db, { businessId: 7 });
    expect(own.nps_index).toBeCloseTo(20.0, 1);
  });
});
