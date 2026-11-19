'use strict';

/**
 * PR #804 Track E (gates / registry / activation / sessions / investor
 * scope / backfill) — database tests against the Track E disposable
 * database only.
 *
 * Run with:
 *   STATEMENT_TEST_DATABASE_URL=postgresql://oxsteed:statement-test-password@127.0.0.1:5432/credit_statement_test_pr804_e
 *   npx jest __tests__/pr804TrackE.db.test.js --cacheDirectory=$HOME/workspace/.jest-cache-pr804-track-e --forceExit
 *
 * The suite skips unless that exact loopback database is opted in, so it
 * never touches the shared credit_statement_test database other tracks
 * may be using.
 */

jest.unmock('pg');

const crypto = require('crypto');

const RAW_URL = process.env.STATEMENT_TEST_DATABASE_URL || '';
function isTrackEDb(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      && url.pathname === '/credit_statement_test_pr804_e';
  } catch { return false; }
}
const CAN_RUN_DB = isTrackEDb(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;
if (CAN_RUN_DB) process.env.DATABASE_URL = RAW_URL;

jest.setTimeout(120000);

test('Track E DB tests require the pr804-track-e disposable database opt-in', () => {
  expect(RAW_URL === '' || RAW_URL.includes('/credit_statement_test_pr804_e')).toBe(true);
});

ddescribe('PR #804 Track E', () => {
  let pool;
  let accessService;
  let activation;
  let modeRole;

  beforeAll(() => {
    pool = require('../db');
    require('../services/tokenRevocationService').revokeAccessTokenId = jest.fn().mockResolvedValue(undefined);
    accessService = require('../services/access/accessService');
    activation = require('../services/access/activation');
    modeRole = require('../utils/modeRole');
  });
  afterAll(async () => { if (pool) await pool.end(); });

  async function makeUser(overrides = {}) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active)
       VALUES ($1, $2, 'x', 'Track', 'E', 'customer', 'customer', TRUE, TRUE)`,
      [id, `track-e-${id}@example.invalid`],
    );
    if (Object.keys(overrides).length) {
      const keys = Object.keys(overrides);
      const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
      await pool.query(`UPDATE users SET ${sets} WHERE id = $1`, [id, ...keys.map((k) => overrides[k])]);
    }
    return id;
  }

  async function grant(userId, capability, version = 'test-policy-1') {
    const { rows } = await pool.query(
      `INSERT INTO access_grants (user_id, capability, subject_type, subject_key, status, provenance, policy_version)
       VALUES ($1, $2, 'self', 'self', 'active', 'admin', $3) RETURNING id`,
      [userId, capability, version],
    );
    return rows[0].id;
  }

  async function makeBusiness(userId) {
    const { rows } = await pool.query(
      'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
      [userId, 'Track E Business'],
    );
    return rows[0].id;
  }

  // Stripe Connect readiness lives on connect_accounts, not users.
  async function setConnectReady(userId) {
    await pool.query(
      `INSERT INTO connect_accounts (user_id, stripe_account_id, charges_enabled, payouts_enabled, onboarding_complete)
       VALUES ($1, $2, TRUE, TRUE, TRUE)
       ON CONFLICT (user_id) DO UPDATE SET charges_enabled = TRUE, payouts_enabled = TRUE, onboarding_complete = TRUE`,
      [userId, `acct_tracke_${String(userId).replace(/-/g, '').slice(0, 20)}`],
    );
  }

  describe('G-1 approval is not activation', () => {
    test('an approved helper with no activation evidence is HELD, not usable', async () => {
      const userId = await makeUser();
      await grant(userId, 'helper.offer_services', 'helper-policy-1');
      const state = await activation.activationFor('helper.offer_services', userId, pool);
      expect(state.ready).toBe(false);
      expect(state.missing).toEqual(expect.arrayContaining(['identity_verified', 'helper_terms', 'payout_setup']));
      const decision = await accessService.can(userId, 'helper.offer_services', undefined, pool);
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe('activation_incomplete');
      expect(decision.missing).toEqual(expect.arrayContaining(['identity_verified', 'helper_terms', 'payout_setup']));
      const projection = await accessService.getProjection(userId, pool);
      expect(projection.personal).toContain('helper.offer_services');
      expect(projection.activation['helper.offer_services'].ready).toBe(false);
      expect(projection.activation['helper.offer_services'].missing).toEqual(
        expect.arrayContaining(['identity_verified', 'helper_terms', 'payout_setup']),
      );
    });

    test('a helper with verified identity, terms, W-9, fresh Didit, and Connect is usable', async () => {
      const userId = await makeUser({
        terms_accepted: true,
        terms_accepted_at: new Date(),
        terms_version: '2026-01-01',
        id_verified: true,
        identity_verified: true,
        didit_status: 'verified',
        didit_verified_at: new Date(),
        w9_completed: true,
      });
      await setConnectReady(userId);
      await grant(userId, 'helper.offer_services', 'helper-policy-1');
      const state = await activation.activationFor('helper.offer_services', userId, pool);
      expect(state).toEqual({ ready: true, missing: [] });
      const decision = await accessService.can(userId, 'helper.offer_services', undefined, pool);
      expect(decision.allowed).toBe(true);
      expect(decision.reason).toBe('grant');
    });

    test('payout_setup fails closed without Stripe Connect, even with identity and terms', async () => {
      const userId = await makeUser({
        terms_accepted: true,
        terms_accepted_at: new Date(),
        terms_version: '2026-01-01',
        id_verified: true,
        didit_status: 'verified',
        didit_verified_at: new Date(),
        w9_completed: true,
      });
      await grant(userId, 'helper.offer_services', 'helper-policy-1');
      const decision = await accessService.can(userId, 'helper.offer_services', undefined, pool);
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe('activation_incomplete');
      expect(decision.missing).toEqual(['payout_setup']);
    });

    test('a stale Didit verification does not satisfy helper payout_setup', async () => {
      const stale = new Date();
      stale.setUTCFullYear(stale.getUTCFullYear() - 3);
      const userId = await makeUser({
        terms_accepted: true,
        terms_accepted_at: new Date(),
        terms_version: '2026-01-01',
        id_verified: true,
        didit_status: 'verified',
        didit_verified_at: stale,
        w9_completed: true,
      });
      await setConnectReady(userId);
      await grant(userId, 'helper.offer_services', 'helper-policy-1');
      const decision = await accessService.can(userId, 'helper.offer_services', undefined, pool);
      expect(decision.allowed).toBe(false);
      expect(decision.missing).toEqual(['payout_setup']);
    });

    test('restaurant_activation is satisfied by an active restaurant row, not by the grant', async () => {
      const userId = await makeUser();
      const businessId = await makeBusiness(userId);
      await pool.query(
        `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, status)
         VALUES ($1, $2, 'Track E Diner', 'draft')`,
        [businessId, userId],
      );
      await grant(userId, 'restaurant.own', 'restaurant-owner-policy-1');
      let state = await activation.activationFor('restaurant.own', userId, pool);
      expect(state).toEqual({ ready: false, missing: ['restaurant_activation'] });
      await pool.query(
        "UPDATE food_restaurants SET status = 'active' WHERE owner_user_id = $1",
        [userId],
      );
      state = await activation.activationFor('restaurant.own', userId, pool);
      expect(state).toEqual({ ready: true, missing: [] });
      const decision = await accessService.can(userId, 'restaurant.own', undefined, pool);
      expect(decision.allowed).toBe(true);
    });

    test('franchise.operate is activation-ready exactly when a launched application exists', async () => {
      const userId = await makeUser();
      await grant(userId, 'franchise.operate', 'franchise-policy-1');
      let state = await activation.activationFor('franchise.operate', userId, pool);
      expect(state).toEqual({ ready: false, missing: ['territory_assignment'] });
      const businessId = await makeBusiness(userId);
      const { rows: programs } = await pool.query(
        "SELECT id FROM franchise_programs WHERE code = 'oxsteed-global' LIMIT 1",
      );
      await pool.query(
        `INSERT INTO franchise_applications
           (program_id, owner_user_id, linked_business_id, first_name, last_name, email, desired_country, status)
         VALUES ($1, $2, $3, 'Track', 'E', 'track-e@example.invalid', 'US', 'launched')`,
        [programs[0].id, userId, businessId],
      );
      state = await activation.activationFor('franchise.operate', userId, pool);
      expect(state).toEqual({ ready: true, missing: [] });
      const decision = await accessService.can(userId, 'franchise.operate', undefined, pool);
      expect(decision.allowed).toBe(true);
    });

    test('capabilities with no declared requirements stay ready', async () => {
      const userId = await makeUser();
      await grant(userId, 'logistics.ship', 'logistics-policy-1');
      await grant(userId, 'investor.reporting', 'investor-policy-2');
      expect(await activation.activationFor('logistics.ship', userId, pool)).toEqual({ ready: true, missing: [] });
      expect(await activation.activationFor('investor.reporting', userId, pool)).toEqual({ ready: true, missing: [] });
      expect((await accessService.can(userId, 'logistics.ship', undefined, pool)).allowed).toBe(true);
    });
  });

  describe('G-10 generic investor.participate requests cannot be filed', () => {
    test('createRequest 403s before any draft is created', async () => {
      const userId = await makeUser();
      await expect(accessService.createRequest(userId, {
        capability: 'investor.participate',
        subject: { type: 'self' },
        answers: {},
      })).rejects.toMatchObject({ status: 403, code: 'access_request_not_available' });
      const { rows } = await pool.query(
        'SELECT 1 FROM access_requests WHERE applicant_id = $1 AND capability = $2',
        [userId, 'investor.participate'],
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('G-28 mode switch revokes only the calling session', () => {
    test('invalidateCurrentSession leaves every other session valid', async () => {
      const userId = await makeUser();
      const insert = (sid) => pool.query(
        `INSERT INTO sessions (user_id, refresh_token, access_token_hash, expires_at, csrf_sid)
         VALUES ($1, $2, $3, NOW() + interval '7 days', $4) RETURNING id`,
        [userId, `refresh-${sid}`, `hash-${sid}`, sid],
      );
      const { rows: [calling] } = await insert('calling-sid');
      const { rows: [other] } = await insert('other-sid');
      const client = await pool.connect();
      try {
        const out = await modeRole.invalidateCurrentSession(client, userId, calling.id);
        expect(out).toBe(calling.id);
      } finally {
        client.release();
      }
      const { rows } = await pool.query(
        'SELECT id, is_valid, is_revoked FROM sessions WHERE user_id = $1 ORDER BY id',
        [userId],
      );
      const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
      expect(byId[calling.id].is_valid).toBe(false);
      expect(byId[calling.id].is_revoked).toBe(true);
      expect(byId[other.id].is_valid).toBe(true);
      expect(byId[other.id].is_revoked).toBe(false);
    });
  });
});
