'use strict';

/**
 * Regression test: submitCampaignForReview must not 500 on the row lock.
 *
 * The submit path re-reads the draft with a LEFT JOIN to logistics_lanes.
 * A bare `FOR UPDATE` over that join is rejected by Postgres with 0A000
 * ("FOR UPDATE cannot be applied..."), so every organizer campaign submit
 * 500'd. The fix targets the lock: `FOR UPDATE OF po`.
 *
 * Runs against the real migrated schema in a disposable schema so the exact
 * locking semantics of the query are exercised, not a mock.
 */
const crypto = require('crypto');

const schema = `pooled_submit_${crypto.randomBytes(6).toString('hex')}`;
const url = process.env.STATEMENT_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/credit_statement_test') {
    throw new Error('Disposable database required');
  }
  target.searchParams.set('options', `-c search_path=${schema},public`);
  process.env.DATABASE_URL = target.toString();
}
jest.unmock('pg');
jest.unmock('../db');

// Keep the side-effecting collaborators quiet; the row lock is the subject.
jest.mock('../services/notificationService', () => ({ sendNotification: jest.fn() }));
jest.mock('../utils/logger', () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() }));

const db = require('../db');
const service = require('../services/pooledOrderService');

const TABLES = [
  'users',
  'businesses',
  'logistics_lanes',
  'pooled_orders',
  'logistics_campaign_approval_decisions',
  'logistics_audit_log',
];

(url ? describe : describe.skip)('submitCampaignForReview row lock (FOR UPDATE OF po)', () => {
  let organizerId;
  let laneId;
  let campaignId;

  beforeAll(async () => {
    await db.query(`CREATE SCHEMA ${schema}`);
    for (const t of TABLES) {
      await db.query(`CREATE TABLE ${schema}.${t} (LIKE public.${t} INCLUDING ALL)`);
    }
    organizerId = crypto.randomUUID();
    await db.query(
      `INSERT INTO users(id, email, password_hash, first_name, last_name, role)
       VALUES($1, $2, 'x', 'Org', 'Anizer', 'customer')`,
      [organizerId, `${organizerId}@example.test`],
    );
    ({ rows: [{ id: laneId }] } = await db.query(
      `INSERT INTO logistics_lanes(code, name, origin_country, destination_country, requires_business_verification)
       VALUES('test_lane_' || substr(md5(random()::text), 1, 8), 'Test lane', 'CN', 'US', FALSE)
       RETURNING id`,
    ));
    // A submittable draft: every approval blocker field satisfied so the
    // test reaches (and returns from) the locking SELECT.
    ({ rows: [{ id: campaignId }] } = await db.query(
      `INSERT INTO pooled_orders(reference, title, description, lane_id, organizer_user_id,
         status, target_moq, unit_product_cost_usd, close_date, approval_state)
       VALUES('TEST-' || substr(md5(random()::text), 1, 8), 'Widget pool', 'Bulk widgets for test buyers',
         $2, $1, 'draft', 100, 12.50, NOW() + INTERVAL '30 days', 'draft')
       RETURNING id`,
      [organizerId, laneId],
    ));
  });

  afterAll(async () => {
    await db.query(`DROP SCHEMA ${schema} CASCADE`);
    await db.end();
  });

  test('submits a draft for review without a 0A000 locking error', async () => {
    const result = await service.submitCampaignForReview(campaignId, organizerId, {
      userCountry: 'US',
      userRole: 'individual_buyer',
    });
    expect(result.approval_state).toBe('pending_review');
    const { rows } = await db.query('SELECT approval_state FROM pooled_orders WHERE id = $1', [campaignId]);
    expect(rows[0].approval_state).toBe('pending_review');
  });

  test('the locking SELECT targets only the campaign row (FOR UPDATE OF po)', async () => {
    // Direct proof of the regression shape: the exact SELECT the service
    // runs must execute over the LEFT JOIN without Postgres rejecting it.
    const { rows } = await db.query(
      `SELECT po.*, ll.requires_business_verification
         FROM pooled_orders po
         LEFT JOIN logistics_lanes ll ON ll.id = po.lane_id
        WHERE po.id = $1 FOR UPDATE OF po`,
      [campaignId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].requires_business_verification).toBe(false);
  });
});
