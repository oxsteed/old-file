'use strict';

/**
 * Parity tests: SLA canonical definition.
 *
 * Old divergent behavior: GET /support/sla (admin SLA dashboard) recomputed
 * breach from HARDCODED per-priority intervals (urgent 15m / high 1h /
 * normal 4h / low 24h for first response; 12h/24h/48h/96h for resolution),
 * ignoring the business-configured support_sla_targets table that
 * slaMetricsController (business-scoped endpoints) honors via the stored
 * sla_*_target / sla_*_breached columns.
 *
 * Canonical (registry): each conversation's target resolves as
 *   COALESCE(stored per-conversation target,           -- targets in effect at creation
 *            current configured target for business+priority,
 *            legacy hardcoded default)                -- last resort only
 * and the dashboard counts met/violated against that target.
 */
const crypto = require('crypto');
const schema = `mreg_sla_${crypto.randomBytes(6).toString('hex')}`;
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

// Test-local aggregation using the registry's canonical SQL fragments —
// the same fragments the /support/sla route uses.
async function slaStats(businessId) {
  const frTarget = registry.slaFirstResponseTargetSql('sc', 'sla_tgt');
  const join = registry.slaTargetsJoinSql('sc', 'sla_tgt');
  const { rows } = await db.query(`
    SELECT
      COUNT(*) FILTER (WHERE sc.first_response_at IS NOT NULL OR NOW() > (${frTarget}))::INT AS eligible,
      COUNT(*) FILTER (WHERE sc.first_response_at IS NOT NULL AND sc.first_response_at <= (${frTarget}))::INT AS met,
      COUNT(*) FILTER (WHERE (sc.first_response_at IS NULL AND NOW() > (${frTarget}))
                             OR (sc.first_response_at IS NOT NULL AND sc.first_response_at > (${frTarget})))::INT AS violated
    FROM support_conversations sc
    ${join}
    WHERE sc.status <> 'merged'
      AND ($1::INTEGER IS NULL OR sc.business_id = $1::INTEGER)
  `, [businessId]);
  return rows[0];
}

// The OLD hardcoded computation (what the route did before the fix).
async function oldHardcodedStats(businessId) {
  const hard = `(CASE sc.priority WHEN 'urgent' THEN INTERVAL '15 minutes' WHEN 'high' THEN INTERVAL '1 hour' WHEN 'low' THEN INTERVAL '24 hours' ELSE INTERVAL '4 hours' END)`;
  const { rows } = await db.query(`
    SELECT
      COUNT(*) FILTER (WHERE sc.first_response_at IS NOT NULL OR NOW() - sc.created_at > ${hard})::INT AS eligible,
      COUNT(*) FILTER (WHERE sc.first_response_at IS NOT NULL AND sc.first_response_at - sc.created_at <= ${hard})::INT AS met,
      COUNT(*) FILTER (WHERE (sc.first_response_at IS NOT NULL AND sc.first_response_at - sc.created_at > ${hard})
                             OR (sc.first_response_at IS NULL AND NOW() - sc.created_at > ${hard}))::INT AS violated
    FROM support_conversations sc
    WHERE sc.status <> 'merged'
      AND ($1::INTEGER IS NULL OR sc.business_id = $1::INTEGER)
  `, [businessId]);
  return rows[0];
}

describeDb('metrics registry: SLA target parity', () => {
  beforeAll(async () => {
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`CREATE TABLE ${schema}.support_conversations (
      id SERIAL PRIMARY KEY, business_id INTEGER, priority VARCHAR(20) DEFAULT 'normal',
      status VARCHAR(20) DEFAULT 'open', created_at TIMESTAMPTZ DEFAULT NOW(),
      first_response_at TIMESTAMPTZ, sla_first_response_target TIMESTAMPTZ,
      sla_resolution_target TIMESTAMPTZ)`);
    await db.query(`CREATE TABLE ${schema}.support_sla_targets (
      id SERIAL PRIMARY KEY, business_id INTEGER NOT NULL, priority VARCHAR(20) NOT NULL,
      first_response_target_minutes INTEGER NOT NULL, resolution_target_hours INTEGER NOT NULL,
      active BOOLEAN DEFAULT TRUE)`);
  });

  afterAll(async () => {
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await db.end();
  });

  beforeEach(async () => {
    await db.query(`TRUNCATE ${schema}.support_conversations, ${schema}.support_sla_targets`);
    // Business 1 configures a GENEROUS first-response target: 8h for normal.
    await db.query(`INSERT INTO support_sla_targets
      (business_id, priority, first_response_target_minutes, resolution_target_hours)
      VALUES (1, 'normal', 480, 72)`);
    // A: normal, created 5h ago, no response, no stored target.
    //    Old hardcoded 4h -> violation. Canonical (configured 8h) -> not yet due.
    await db.query(`INSERT INTO support_conversations (business_id, priority, created_at)
      VALUES (1, 'normal', NOW() - INTERVAL '5 hours')`);
    // B: stored per-conversation target (30m) already passed -> breached even
    //    though the configured target (8h) has not.
    await db.query(`INSERT INTO support_conversations
      (business_id, priority, created_at, sla_first_response_target)
      VALUES (1, 'normal', NOW() - INTERVAL '1 hour', NOW() - INTERVAL '30 minutes')`);
    // C: business 2 has NO configured targets; normal, created 5h ago, no
    //    response -> legacy 4h default -> violation (old behavior preserved).
    await db.query(`INSERT INTO support_conversations (business_id, priority, created_at)
      VALUES (2, 'normal', NOW() - INTERVAL '5 hours')`);
    // D: responded within the configured target -> met.
    await db.query(`INSERT INTO support_conversations
      (business_id, priority, created_at, first_response_at)
      VALUES (1, 'normal', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '90 minutes')`);
  });

  test('configured targets win over the old hardcoded intervals', async () => {
    const canonical = await slaStats(1);
    const old = await oldHardcodedStats(1);
    // Old: A violated (5h > 4h), B NOT flagged (old ignores stored targets),
    // D met -> violated=1. The old formula both over-counts (A, which the
    // business gave 8h) and under-counts (B, whose 30m target already passed).
    expect(old.violated).toBe(1);
    // Canonical: A not yet due under the configured 8h; B breached via its
    // stored 30m target; D met -> violated=1, met=1, eligible=2
    expect(canonical.violated).toBe(1);
    expect(canonical.met).toBe(1);
    expect(canonical.eligible).toBe(2);
  });

  test('stored per-conversation targets take precedence over current config', async () => {
    const canonical = await slaStats(1);
    // B is the only violated row for business 1
    expect(canonical.violated).toBe(1);
  });

  test('legacy defaults apply where no target was ever configured', async () => {
    const canonical = await slaStats(2);
    const old = await oldHardcodedStats(2);
    // Business 2 matches the old behavior exactly (legacy default fallback)
    expect(canonical.violated).toBe(old.violated);
    expect(canonical.violated).toBe(1);
  });

  test('met requires an actual first response (avg excludes unresponded)', async () => {
    const frTarget = registry.slaFirstResponseTargetSql('sc', 'sla_tgt');
    const join = registry.slaTargetsJoinSql('sc', 'sla_tgt');
    const { rows } = await db.query(`
      SELECT ROUND(AVG(EXTRACT(EPOCH FROM (sc.first_response_at - sc.created_at))))::INT AS avg_seconds,
             COUNT(*) FILTER (WHERE sc.first_response_at IS NOT NULL)::INT AS responded
      FROM support_conversations sc
      ${join}
      WHERE sc.business_id = 1 AND sc.status <> 'merged'
    `);
    // Only D responded (30m = 1800s); A/B/C must not pollute the average
    expect(rows[0].responded).toBe(1);
    expect(rows[0].avg_seconds).toBe(1800);
    expect(frTarget).toContain('sla_first_response_target');
  });
});
