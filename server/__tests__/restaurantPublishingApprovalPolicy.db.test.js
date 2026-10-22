'use strict';

/**
 * DB tests: approval-policy writes through the publishing settings merge
 * are owner-only, reject disabled:true, and are audit-logged
 * (auth-audit item 6).
 *
 * Before the fix, PATCH /:restaurantId/publishing gated only on
 * restaurant.manage (which managers hold by default) and merged arbitrary
 * settings, so a manager could write
 * posApprovalPolicy.{void,refund,payout}.disabled=true and void/refund/
 * payout without a manager PIN, unaudited.
 *
 * Run with:
 *   ST_T3_TEST_DATABASE_URL=<redacted> \
 *     npx jest __tests__/restaurantPublishingApprovalPolicy.db.test.js
 */
jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

const RAW_URL = process.env.ST_T3_TEST_DATABASE_URL || '';

function isTrackDatabase(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      && url.pathname === '/st_t3';
  } catch { return false; }
}

const CAN_RUN_DB = isTrackDatabase(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable st_t3 database', () => {
  expect(isTrackDatabase(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env.DATABASE_URL = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env.JWT_SECRET = 'test-secret-for-db-tests';
}

jest.mock('../services/socketService', () => ({
  broadcastToBusinessInbox: jest.fn(),
  broadcastToRestaurantDisplay: jest.fn(),
  broadcastToUser: jest.fn(),
}));

const { errorHandler } = require('../middleware/errorHandler');
const pool = require('../db');
const appFlow = require('../controllers/restaurantAppFlowController');

jest.setTimeout(60000);

function publishingApp(userId) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: userId, email: 'policy@example.com', role: 'customer' };
    next();
  });
  app.patch('/api/restaurants/:restaurantId/publishing', appFlow.updatePublishing);
  app.use(errorHandler);
  return app;
}

async function newUser(label) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
     VALUES ($1, $2, 'x', 'Policy', 'Fixture', 'customer', TRUE, TRUE)`,
    [id, `policy-${label}-${id}@example.invalid`]
  );
  return id;
}

ddescribe('publishing approval-policy guard (auth-audit item 6)', () => {
  let F = {};

  beforeAll(async () => {
    const owner = await newUser('owner');
    const manager = await newUser('manager');

    const { rows: [biz] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
      [owner, `Policy Guard ${crypto.randomUUID().slice(0, 8)}`]
    );
    const { rows: [rest] } = await pool.query(
      `INSERT INTO food_restaurants
         (business_id, owner_user_id, display_name, status, accepts_in_store_orders, fulfillment_modes)
       VALUES ($1, $2, $3, 'active', TRUE, $4::text[])
       RETURNING id`,
      [biz.id, owner, 'Policy Diner', ['pickup']]
    );
    const { rows: [memberUser] } = await pool.query('SELECT email FROM users WHERE id = $1', [manager]);
    await pool.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, invite_email, role, status)
       VALUES ($1, $2, $3, $4, 'manager', 'active')`,
      [biz.id, owner, manager, memberUser.email]
    );
    F = { owner, manager, businessId: Number(biz.id), restaurantId: Number(rest.id) };
  });

  afterAll(async () => { await pool.end(); });

  async function patch(userId, body) {
    return request(publishingApp(userId))
      .patch(`/api/restaurants/${F.restaurantId}/publishing`)
      .send(body);
  }

  async function policyAuditCount() {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM business_audit_log
        WHERE business_id = $1 AND action = 'restaurant.pos_approval_policy.updated'`,
      [F.businessId]
    );
    return rows[0].n;
  }

  test('a manager cannot disable their own approval policy', async () => {
    const res = await patch(F.manager, { settings: { posApprovalPolicy: { void: { disabled: true } } } });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/only the restaurant owner/i);

    const { rows: [row] } = await pool.query(
      'SELECT settings FROM food_restaurants WHERE id = $1',
      [F.restaurantId]
    );
    expect(row.settings?.posApprovalPolicy).toBeUndefined();
    expect(await policyAuditCount()).toBe(0);
  });

  test('a manager cannot change approval thresholds either', async () => {
    const res = await patch(F.manager, { settings: { posApprovalPolicy: { payout: { thresholdCents: 1 } } } });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/only the restaurant owner/i);
    expect(await policyAuditCount()).toBe(0);
  });

  test('the owner cannot set disabled:true either', async () => {
    const res = await patch(F.owner, { settings: { posApprovalPolicy: { refund: { disabled: true } } } });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');

    const { rows: [row] } = await pool.query(
      'SELECT settings FROM food_restaurants WHERE id = $1',
      [F.restaurantId]
    );
    expect(row.settings?.posApprovalPolicy).toBeUndefined();
    expect(await policyAuditCount()).toBe(0);
  });

  test('the owner can set thresholds and the change is audit-logged', async () => {
    const res = await patch(F.owner, { settings: { posApprovalPolicy: { payout: { thresholdCents: 5000 } } } });
    expect(res.status).toBe(200);

    const { rows: [row] } = await pool.query(
      'SELECT settings FROM food_restaurants WHERE id = $1',
      [F.restaurantId]
    );
    expect(row.settings.posApprovalPolicy.payout.thresholdCents).toBe(5000);

    const { rows: [audit] } = await pool.query(
      `SELECT actor_user_id, actor_role, target_id, before_state, after_state
         FROM business_audit_log
        WHERE business_id = $1 AND action = 'restaurant.pos_approval_policy.updated'
        ORDER BY id DESC LIMIT 1`,
      [F.businessId]
    );
    expect(audit).toBeTruthy();
    expect(audit.actor_user_id).toBe(F.owner);
    expect(audit.before_state.posApprovalPolicy).toEqual({});
    expect(audit.after_state.posApprovalPolicy.payout.thresholdCents).toBe(5000);
  });

  test('a manager can still update non-policy publishing settings', async () => {
    const res = await patch(F.manager, { status: 'paused' });
    expect(res.status).toBe(200);

    const { rows: [row] } = await pool.query(
      'SELECT status FROM food_restaurants WHERE id = $1',
      [F.restaurantId]
    );
    expect(row.status).toBe('paused');
  });
});
