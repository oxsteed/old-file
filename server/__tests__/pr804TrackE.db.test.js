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

  describe('G-45 investor reporting scope', () => {
    async function makeOpportunity(businessId, userId) {
      const { rows } = await pool.query(
        `INSERT INTO investment_opportunities
           (business_id, created_by, title, purpose, target_cents, minimum_cents, deadline_at, status, structure, country_code)
         VALUES ($1, $2, 'Track E Opportunity', 'Track E scope test', 100000, 1000, NOW() + interval '30 days', 'published', 'revenue_share', 'US')
         RETURNING id`,
        [businessId, userId],
      );
      return rows[0].id;
    }

    async function makeFranchiseApplication(linkedBusinessId, status) {
      await pool.query(
        `INSERT INTO franchise_applications
           (program_id, first_name, last_name, email, desired_country, linked_business_id, status)
         VALUES (1, 'Track', 'E', 'track-e@example.invalid', 'US', $1, $2)`,
        [linkedBusinessId, status],
      );
    }

    test('resolveInvestorScope maps a live application to its opportunity and entity', async () => {
      const userId = await makeUser();
      const businessId = await makeBusiness(userId);
      const opportunityId = await makeOpportunity(businessId, userId);
      await pool.query(
        `INSERT INTO investment_participation_applications (user_id, opportunity_id, status, idempotency_key)
         VALUES ($1, $2, 'submitted', $3)`,
        [userId, opportunityId, `track-e-${crypto.randomUUID()}`],
      );
      const scope = await accessService.resolveInvestorScope(userId, pool);
      expect(scope.opportunityIds).toEqual([String(opportunityId)]);
      expect(scope.entityIds).toEqual([businessId]);
    });

    test('the projection carries the audience scope on investor.reporting', async () => {
      const userId = await makeUser();
      const businessId = await makeBusiness(userId);
      const opportunityId = await makeOpportunity(businessId, userId);
      const grantId = await grant(userId, 'investor.reporting');
      await pool.query(
        `INSERT INTO investor_reporting_audiences (user_id, grant_id, audience_key, datasets, entity_ids, opportunity_ids)
         VALUES ($1, $2, 'track-e', ARRAY['overview', 'franchise'], $3, $4)`,
        [userId, grantId, [businessId], [opportunityId]],
      );
      const projection = await accessService.getProjection(userId, pool);
      expect(projection.personal).toContain('investor.reporting');
      expect(projection.investorAudience.entityIds).toEqual([businessId]);
      expect(projection.investorAudience.opportunityIds).toEqual([String(opportunityId)]);
    });

    test('franchise pipeline filters to the caller positions; empty scope sees nothing', async () => {
      const investorController = require('../controllers/investorController');
      const userId = await makeUser();
      const businessA = await makeBusiness(userId);
      const businessB = await makeBusiness(userId);

      const call = (audience) => new Promise((resolve, reject) => {
        const req = { investorAudience: audience };
        const res = {
          json(body) { resolve(body); },
          status(code) { this.code = code; return this; },
        };
        investorController.getFranchisePipeline(req, res).catch(reject);
      });

      // The suite shares one disposable database across runs, so measure
      // the platform total before inserting rather than assuming it is 0.
      const before = await call(undefined);
      await makeFranchiseApplication(businessA, 'inquiry');
      await makeFranchiseApplication(businessA, 'launched');
      await makeFranchiseApplication(businessB, 'inquiry');

      const scoped = await call({ entity_ids: [businessA], opportunity_ids: [] });
      expect(scoped.scope.type).toBe('position');
      expect(scoped.total).toBe(2);
      expect(scoped.pipeline.map((r) => r.status).sort()).toEqual(['inquiry', 'launched']);

      const noPosition = await call({ entity_ids: [], opportunity_ids: [] });
      expect(noPosition.scope.type).toBe('position');
      expect(noPosition.total).toBe(0);
      expect(noPosition.pipeline).toEqual([]);

      const platform = await call(undefined);
      expect(platform.scope.type).toBe('platform_wide');
      expect(platform.total).toBe(before.total + 3);
    });

    test('kpis carry the platform-wide scope label', async () => {
      const investorController = require('../controllers/investorController');
      const body = await new Promise((resolve, reject) => {
        const req = { query: {}, investorAudience: { entity_ids: [1], opportunity_ids: [] } };
        const res = {
          json(b) { resolve(b); },
          status(code) { this.code = code; return this; },
        };
        investorController.getKpis(req, res).catch(reject);
      });
      expect(body.scope).toEqual({ type: 'platform_wide' });
    });
  });

  describe('R-4 backfill covers investor.reporting and franchise.operate', () => {
    const { mapLegacyUser } = require('../services/access/legacyMapping');
    const { runBackfill } = require('../services/access/backfill');

    const baseFacts = {
      user: { id: '00000000-0000-0000-0000-000000000000', role: 'customer', default_mode: 'customer' },
      helperProfile: false, modeApprovals: [], ownedBusinessCount: 0,
      activeMembershipCount: 0, toolListingCount: 0,
      investorAudience: false, franchiseTerritory: false,
    };

    test('mapLegacyUser grants investor.reporting from audience evidence, franchise.operate from territory', () => {
      const out = mapLegacyUser({ ...baseFacts, investorAudience: true, franchiseTerritory: true });
      expect(out.grants.map((g) => [g.capability, g.reason])).toEqual([
        ['investor.reporting', 'investor_audience_record'],
        ['franchise.operate', 'territory_assignment'],
      ]);
      expect(out.exceptions).toEqual([]);
    });

    test('mapLegacyUser still flags investor mode without any audience evidence', () => {
      const out = mapLegacyUser({
        ...baseFacts,
        user: { ...baseFacts.user, default_mode: 'investor' },
      });
      expect(out.grants).toEqual([]);
      expect(out.exceptions).toEqual([{ reason: 'investor_mode_without_audience' }]);
    });

    test('dry_run counts an investor.reporting grant for a user with a live application', async () => {
      const userId = await makeUser();
      const businessId = await makeBusiness(userId);
      const { rows: [opp] } = await pool.query(
        `INSERT INTO investment_opportunities
           (business_id, created_by, title, purpose, target_cents, minimum_cents, deadline_at, status, structure, country_code)
         VALUES ($1, $2, 'Track E Opportunity', 'Track E backfill test', 100000, 1000, NOW() + interval '30 days', 'published', 'revenue_share', 'US')
         RETURNING id`,
        [businessId, userId],
      );
      await pool.query(
        `INSERT INTO investment_participation_applications (user_id, opportunity_id, status, idempotency_key)
         VALUES ($1, $2, 'submitted', $3)`,
        [userId, opp.id, `track-e-backfill-${crypto.randomUUID()}`],
      );
      const run = await runBackfill({ mode: 'dry_run' });
      expect(run.status).toBe('completed');
      expect(run.counts['grant:investor.reporting']).toBeGreaterThanOrEqual(1);
      // Nothing was written by a dry run.
      const { rows } = await pool.query(
        "SELECT 1 FROM access_grants WHERE user_id = $1 AND capability = 'investor.reporting'",
        [userId],
      );
      expect(rows).toEqual([]);
    });

    test('apply grants investor.reporting with an audience row, and franchise.operate from a launched application', async () => {
      const investorId = await makeUser();
      const investorBusinessId = await makeBusiness(investorId);
      const { rows: [opp] } = await pool.query(
        `INSERT INTO investment_opportunities
           (business_id, created_by, title, purpose, target_cents, minimum_cents, deadline_at, status, structure, country_code)
         VALUES ($1, $2, 'Track E Opportunity', 'Track E backfill test', 100000, 1000, NOW() + interval '30 days', 'published', 'revenue_share', 'US')
         RETURNING id`,
        [investorBusinessId, investorId],
      );
      await pool.query(
        `INSERT INTO investment_participation_applications (user_id, opportunity_id, status, idempotency_key, identity_verified, authority_verified)
         VALUES ($1, $2, 'approved', $3, TRUE, TRUE)`,
        [investorId, opp.id, `track-e-backfill-${crypto.randomUUID()}`],
      );

      const franchiseId = await makeUser();
      const franchiseBusinessId = await makeBusiness(franchiseId);
      await pool.query(
        `INSERT INTO franchise_applications
           (program_id, first_name, last_name, email, desired_country, linked_business_id, status, owner_user_id)
         VALUES (1, 'Track', 'E', 'track-e@example.invalid', 'US', $1, 'launched', $2)`,
        [franchiseBusinessId, franchiseId],
      );

      const run = await runBackfill({ mode: 'apply' });
      expect(run.status).toBe('completed');

      const { rows: grants } = await pool.query(
        `SELECT capability, status, provenance, provenance_reason FROM access_grants
          WHERE user_id IN ($1, $2) AND capability IN ('investor.reporting', 'franchise.operate')`,
        [investorId, franchiseId],
      );
      const byKey = Object.fromEntries(grants.map((g) => [`${g.capability}`, g]));
      expect(byKey['investor.reporting'].status).toBe('active');
      expect(byKey['investor.reporting'].provenance).toBe('legacy_backfill');
      expect(byKey['franchise.operate'].status).toBe('active');
      expect(byKey['franchise.operate'].provenance_reason).toBe('territory_assignment');

      const { rows: audiences } = await pool.query(
        `SELECT audience_key, datasets, entity_ids, opportunity_ids FROM investor_reporting_audiences
          WHERE user_id = $1`,
        [investorId],
      );
      expect(audiences).toHaveLength(1);
      expect(audiences[0].audience_key).toBe('legacy-investor-mode');
      expect(audiences[0].datasets).toEqual(['overview']);
      expect(audiences[0].entity_ids.map(Number)).toEqual([investorBusinessId]);
      expect(audiences[0].opportunity_ids.map(String)).toEqual([String(opp.id)]);

      // A replay never reactivates a revoked grant.
      await pool.query(
        "UPDATE access_grants SET status = 'revoked' WHERE user_id = $1 AND capability = 'franchise.operate'",
        [franchiseId],
      );
      const replay = await runBackfill({ mode: 'apply' });
      expect(replay.counts['existing:franchise.operate']).toBeGreaterThanOrEqual(1);
      const { rows: [after] } = await pool.query(
        "SELECT status FROM access_grants WHERE user_id = $1 AND capability = 'franchise.operate'",
        [franchiseId],
      );
      expect(after.status).toBe('revoked');
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
