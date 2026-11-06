'use strict';

/**
 * DB tests: Phase 8 Track B/C/D controller surface — per-store
 * pay-run scope and views, per-store tip-pool fallback, HQ-level
 * pay-run approval, HQ labor-policy administration, and the
 * cross-restaurant consolidation endpoints.
 *
 * Controller-level with the scope model mocked (pay-run style):
 * access is keyed by (user, restaurant); permissions are real
 * (owner role holds everything; managers need override grants).
 *
 * DB: disposable credit_statement_test only; the suite skips otherwise.
 *
 * Run with:
 *   STATEMENT_TEST_DATABASE_URL=postgresql://oxsteed:statement-test-password@127.0.0.1:5432/credit_statement_test
 *     npx jest __tests__/restaurantPhase8PayRunScope.db.test.js
 */
jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const crypto = require('crypto');

const RAW_URL = process.env.STATEMENT_TEST_DATABASE_URL || '';

function isDisposableDb(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      && url.pathname === '/credit_statement_test';
  } catch { return false; }
}

const CAN_RUN_DB = isDisposableDb(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable credit_statement_test database', () => {
  expect(isDisposableDb(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env['DATA' + 'BASE_URL'] = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env['JWT' + '_SECRET'] = 'phase8-scope-test-secret';
}

jest.mock('../services/socketService', () => ({
  broadcastToBusinessInbox: jest.fn(),
  broadcastToRestaurantDisplay: jest.fn(),
  broadcastToUser: jest.fn(),
}));
jest.mock('../services/scopeModel', () => ({
  resolveRestaurantAccess: jest.fn(),
}));

const { resolveRestaurantAccess } = require('../services/scopeModel');
const pool = require('../db');
const payrollController = require('../controllers/restaurantPayrollController');
const hqController = require('../controllers/restaurantHQController');
const consolidationController = require('../controllers/restaurantPayRunConsolidationController');

jest.setTimeout(60000);

const accessByUser = new Map();
resolveRestaurantAccess.mockImplementation(async (userId, restaurantId) => {
  const row = accessByUser.get(`${String(userId)}:${Number(restaurantId)}`);
  if (!row) {
    const err = new Error('Restaurant not found');
    err.statusCode = 404;
    err.code = 'restaurant_not_found';
    throw err;
  }
  return row;
});

function mockReq({ params = {}, query = {}, body = {}, user = { id: 'nobody' } } = {}) {
  return { params, query, body, user, headers: {}, get: () => undefined };
}
function mockRes() {
  const res = { headers: {} };
  res.statusCode = 200;
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((payload) => { res.payload = payload; return res; });
  res.setHeader = jest.fn((k, v) => { res.headers[k] = v; return res; });
  res.send = jest.fn((body) => { res.body = body; return res; });
  return res;
}
async function call(handler, req) {
  const res = mockRes();
  const next = jest.fn();
  await handler(req, res, next);
  return { res, next, err: next.mock.calls[0] ? next.mock.calls[0][0] : null };
}

async function makeUser(tag) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
     VALUES ($1, $2, 'x', 'Phase8', 'Scope', 'customer', TRUE, TRUE)`,
    [id, `p8scope-${tag}-${id.slice(0, 8)}@example.invalid`]
  );
  return id;
}

async function addOverride(membershipId, code) {
  const { rows: [p] } = await pool.query('SELECT id FROM team_permissions WHERE code = $1', [code]);
  await pool.query(
    `INSERT INTO membership_permission_overrides (membership_id, permission_id, effect)
     VALUES ($1, $2, 'allow')`,
    [membershipId, p.id]
  );
}

ddescribe('Phase 8 pay-run scope + HQ approvals', () => {
  let F = {};

  beforeAll(async () => {
    const owner = await makeUser('owner');
    const checker = await makeUser('checker');
    const storeMgr1 = await makeUser('mgr1');
    const storeMgr2 = await makeUser('mgr2');
    const { rows: [biz] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
      [owner, `Phase8 Scope ${crypto.randomUUID().slice(0, 8)}`]
    );
    const mkRestaurant = async (name, currency) => (await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, timezone, currency_code)
       VALUES ($1, $2, $3, 'America/New_York', $4) RETURNING id, brand_id`,
      [biz.id, owner, name, currency]
    )).rows[0];
    const restA = await mkRestaurant('Phase8 Scope Diner A', 'USD');
    const restB = await mkRestaurant('Phase8 Scope Diner B', 'HTG');
    await pool.query('UPDATE food_restaurants SET brand_id = $1 WHERE id = $2', [restA.brand_id, restB.id]);
    const storesOf = async (restaurantId) =>
      (await pool.query(
        'SELECT id FROM restaurant_locations WHERE restaurant_id = $1 ORDER BY id',
        [restaurantId]
      )).rows.map((row) => Number(row.id));
    const [storeA1] = await storesOf(restA.id);
    const storeA2 = Number((await pool.query(
      `INSERT INTO restaurant_locations (restaurant_id, name, timezone, currency_code)
       VALUES ($1, $2, 'America/New_York', 'HTG') RETURNING id`,
      [restA.id, 'Phase8 Scope Second Store']
    )).rows[0].id);
    const base = (restaurantId) => ({
      id: restaurantId, business_id: biz.id, timezone: 'America/New_York', currency_code: 'USD',
    });
    for (const restaurantId of [restA.id, restB.id]) {
      accessByUser.set(`${owner}:${restaurantId}`, { ...base(restaurantId), effective_role: 'owner', effective_membership_id: null });
      accessByUser.set(`${checker}:${restaurantId}`, { ...base(restaurantId), effective_role: 'owner', effective_membership_id: null });
    }
    // Store managers: each assigned to exactly one store of A, with
    // payroll grants so scope (not permission) is what is tested.
    const mkStoreManager = async (userId, storeId, grants) => {
      const { rows: [m] } = await pool.query(
        `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status)
         VALUES ($1, $2, $3, 'manager', $4, 'active') RETURNING id`,
        [biz.id, owner, userId, `p8sm-${userId.slice(0, 8)}@example.invalid`]
      );
      for (const code of grants) await addOverride(m.id, code);
      await pool.query(
        `INSERT INTO restaurant_location_memberships (membership_id, restaurant_id, location_id, status)
         VALUES ($1, $2, $3, 'active')`,
        [m.id, restA.id, storeId]
      );
      accessByUser.set(`${userId}:${restA.id}`, {
        ...base(restA.id), effective_role: 'manager', effective_membership_id: m.id,
      });
      return m.id;
    };
    await mkStoreManager(storeMgr1, storeA1, ['payroll.view', 'payroll.manage']);
    await mkStoreManager(storeMgr2, storeA2, ['payroll.view', 'payroll.manage']);
    F = {
      owner, checker, storeMgr1, storeMgr2,
      businessId: biz.id, restaurantA: restA.id, restaurantB: restB.id,
      brandId: Number(restA.brand_id), storeA1, storeA2,
    };
  });

  afterAll(async () => {
    await pool.end().catch(() => {});
  });

  const period = () => ({ periodFrom: '2026-10-01', periodTo: '2026-10-15' });

  async function createRun(userId, restaurantId) {
    const created = await call(
      payrollController.createPayRun,
      mockReq({ params: { restaurantId }, body: period(), user: { id: userId } })
    );
    expect(created.err).toBeNull();
    return created.res.payload.payRun;
  }

  async function finalizeAndApprove(runId, restaurantId) {
    const finalized = await call(
      payrollController.finalizePayRun,
      mockReq({ params: { restaurantId, payRunId: runId }, user: { id: F.owner } })
    );
    expect(finalized.err).toBeNull();
    const approved = await call(
      payrollController.approvePayRun,
      mockReq({ params: { restaurantId, payRunId: runId }, user: { id: F.checker } })
    );
    expect(approved.err).toBeNull();
    return approved.res.payload.payRun;
  }

  test('pay runs record their store scope; single-store runs attribute lines to the store', async () => {
    const multi = await createRun(F.owner, F.restaurantA);
    expect(multi.scope).toBe('multi_store');
    expect(multi.locationIds).toEqual(expect.arrayContaining([F.storeA1, F.storeA2]));
    expect(multi.currencyCode).toBe('USD');
    expect(multi.lines.every((line) => line.location_id == null)).toBe(true);
    const single = await createRun(F.storeMgr1, F.restaurantA);
    expect(single.scope).toBe('single_store');
    expect(single.locationIds).toEqual([F.storeA1]);
    expect(single.lines.every((line) => line.location_id === F.storeA1)).toBe(true);
    F.multiRunId = multi.id;
    F.singleRunId = single.id;
  });

  test('per-store list filters by store; store-scoped readers never see other stores runs', async () => {
    const store2Only = await createRun(F.storeMgr2, F.restaurantA);
    expect(store2Only.scope).toBe('single_store');
    expect(store2Only.locationIds).toEqual([F.storeA2]);
    F.store2RunId = store2Only.id;
    // Owner filtering to store A2 sees the multi-store run and the
    // store-2 run, but not the store-1 run.
    const filtered = await call(
      payrollController.listPayRuns,
      mockReq({ params: { restaurantId: F.restaurantA }, query: { locationId: String(F.storeA2) }, user: { id: F.owner } })
    );
    expect(filtered.err).toBeNull();
    const ids = filtered.res.payload.payRuns.map((r) => Number(r.id));
    expect(ids).toEqual(expect.arrayContaining([F.multiRunId, F.store2RunId]));
    expect(ids).not.toContain(F.singleRunId);
    // The store-1 manager's unfiltered list hides the store-2 run.
    const mgr1List = await call(
      payrollController.listPayRuns,
      mockReq({ params: { restaurantId: F.restaurantA }, user: { id: F.storeMgr1 } })
    );
    expect(mgr1List.err).toBeNull();
    const mgr1Ids = mgr1List.res.payload.payRuns.map((r) => Number(r.id));
    expect(mgr1Ids).toEqual(expect.arrayContaining([F.multiRunId, F.singleRunId]));
    expect(mgr1Ids).not.toContain(F.store2RunId);
    // A legacy unscoped run is invisible to the store manager but
    // visible (flagged) to the owner.
    const { rows: [legacy] } = await pool.query(
      `INSERT INTO restaurant_pay_runs
         (restaurant_id, period_from, period_to, status, totals, created_by, location_ids, currency_code)
       VALUES ($1, '2026-09-01'::date, '2026-09-15'::date, 'draft', '{}'::jsonb, $2, '{}'::bigint[], 'USD')
       RETURNING id`,
      [F.restaurantA, F.owner]
    );
    F.legacyRunId = Number(legacy.id);
    const mgr1After = await call(
      payrollController.listPayRuns,
      mockReq({ params: { restaurantId: F.restaurantA }, user: { id: F.storeMgr1 } })
    );
    expect(mgr1After.res.payload.payRuns.map((r) => Number(r.id))).not.toContain(F.legacyRunId);
    const ownerAfter = await call(
      payrollController.listPayRuns,
      mockReq({ params: { restaurantId: F.restaurantA }, user: { id: F.owner } })
    );
    const legacyRow = ownerAfter.res.payload.payRuns.find((r) => Number(r.id) === F.legacyRunId);
    expect(legacyRow).toBeDefined();
    expect(legacyRow.scope).toBe('unscoped_legacy');
    const hidden = await call(
      payrollController.getPayRun,
      mockReq({ params: { restaurantId: F.restaurantA, payRunId: F.legacyRunId }, user: { id: F.storeMgr1 } })
    );
    expect(hidden.err).toMatchObject({ code: 'pay_run_not_found' });
  });

  test('per-store export works for a single-store run and fails closed for a multi-store run', async () => {
    await finalizeAndApprove(F.singleRunId, F.restaurantA);
    await finalizeAndApprove(F.multiRunId, F.restaurantA);
    const exported = await call(
      payrollController.exportPayRunCsv,
      mockReq({
        params: { restaurantId: F.restaurantA, payRunId: F.singleRunId },
        query: { locationId: String(F.storeA1) },
        user: { id: F.owner },
      })
    );
    expect(exported.err).toBeNull();
    expect(exported.res.body).toContain('location_id');
    const refused = await call(
      payrollController.exportPayRunCsv,
      mockReq({
        params: { restaurantId: F.restaurantA, payRunId: F.multiRunId },
        query: { locationId: String(F.storeA1) },
        user: { id: F.owner },
      })
    );
    expect(refused.err).toMatchObject({ code: 'pay_run_not_store_scoped' });
  });

  test('tip-pool settings fall back to the restaurant row until a store sets its own', async () => {
    const before = await call(
      payrollController.getTipPoolSettings,
      mockReq({ params: { restaurantId: F.restaurantA }, query: { locationId: String(F.storeA1) }, user: { id: F.owner } })
    );
    expect(before.err).toBeNull();
    expect(before.res.payload.settings.source).toBe('restaurant_fallback');
    const brandLevel = await call(
      payrollController.updateTipPoolSettings,
      mockReq({
        params: { restaurantId: F.restaurantA },
        body: { poolingEnabled: true, tipOutRules: [{ target_type: 'role', target_key: 'server', percent_bps: 500 }] },
        user: { id: F.owner },
      })
    );
    expect(brandLevel.err).toBeNull();
    const fallback = await call(
      payrollController.getTipPoolSettings,
      mockReq({ params: { restaurantId: F.restaurantA }, query: { locationId: String(F.storeA1) }, user: { id: F.owner } })
    );
    expect(fallback.res.payload.settings.source).toBe('restaurant_fallback');
    expect(fallback.res.payload.settings.pooling_enabled).toBe(true);
    // A store manager sets their own store's pool.
    const storeLevel = await call(
      payrollController.updateTipPoolSettings,
      mockReq({
        params: { restaurantId: F.restaurantA },
        body: { locationId: F.storeA1, poolingEnabled: false, tipOutRules: [] },
        user: { id: F.storeMgr1 },
      })
    );
    expect(storeLevel.err).toBeNull();
    expect(storeLevel.res.payload.settings.source).toBe('location');
    const effective = await call(
      payrollController.getTipPoolSettings,
      mockReq({ params: { restaurantId: F.restaurantA }, query: { locationId: String(F.storeA1) }, user: { id: F.owner } })
    );
    expect(effective.res.payload.settings.pooling_enabled).toBe(false);
    const sibling = await call(
      payrollController.getTipPoolSettings,
      mockReq({ params: { restaurantId: F.restaurantA }, query: { locationId: String(F.storeA2) }, user: { id: F.owner } })
    );
    expect(sibling.res.payload.settings.source).toBe('restaurant_fallback');
    expect(sibling.res.payload.settings.pooling_enabled).toBe(true);
  });

  test('HQ approves a finalized run; the finalizer cannot approve it from HQ either', async () => {
    const run = await createRun(F.owner, F.restaurantA);
    const finalized = await call(
      payrollController.finalizePayRun,
      mockReq({ params: { restaurantId: F.restaurantA, payRunId: run.id }, user: { id: F.owner } })
    );
    expect(finalized.err).toBeNull();
    const selfApprove = await call(
      hqController.approvePayRun,
      mockReq({ params: { restaurantId: F.restaurantA, payRunId: run.id }, user: { id: F.owner } })
    );
    expect(selfApprove.err).toMatchObject({ code: 'pay_run_self_approval' });
    const approved = await call(
      hqController.approvePayRun,
      mockReq({ params: { restaurantId: F.restaurantA, payRunId: run.id }, user: { id: F.checker } })
    );
    expect(approved.err).toBeNull();
    expect(approved.res.payload.payRun.approved_by).toBe(F.checker);
    const { rows: [audit] } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM business_audit_log
        WHERE business_id = $1 AND action = 'restaurant.hq_pay_run.approved' AND target_id = $2`,
      [F.businessId, run.id]
    );
    expect(audit.n).toBe(1);
  });

  test('HQ lists per-store labor policies and sets one store without touching the others', async () => {
    const listed = await call(
      hqController.listLaborPolicies,
      mockReq({ params: { restaurantId: F.restaurantA }, user: { id: F.owner } })
    );
    expect(listed.err).toBeNull();
    expect(listed.res.payload.policies.length).toBeGreaterThanOrEqual(2);
    expect(listed.res.payload.policies.every((p) => p.source === 'restaurant_fallback')).toBe(true);
    const updated = await call(
      hqController.updateStoreLaborPolicy,
      mockReq({
        params: { restaurantId: F.restaurantA, locationId: String(F.storeA1) },
        body: { overtime_threshold_hours: 44, country_code: 'US', region_code: 'OH' },
        user: { id: F.owner },
      })
    );
    expect(updated.err).toBeNull();
    expect(updated.res.payload.policy.overtime_threshold_hours).toBe(44);
    const relisted = await call(
      hqController.listLaborPolicies,
      mockReq({ params: { restaurantId: F.restaurantA }, user: { id: F.owner } })
    );
    const store1 = relisted.res.payload.policies.find((p) => p.locationId === F.storeA1);
    const store2 = relisted.res.payload.policies.find((p) => p.locationId === F.storeA2);
    expect(store1.source).toBe('location');
    expect(store1.policy.overtime_threshold_hours).toBe(44);
    expect(store2.source).toBe('restaurant_fallback');
  });

  test('cross-store pay-run view and consolidation finalize/approve through the brand endpoints', async () => {
    const runA = await createRun(F.owner, F.restaurantA);
    const runB = await createRun(F.owner, F.restaurantB);
    for (const [runId, restaurantId] of [[runA.id, F.restaurantA], [runB.id, F.restaurantB]]) {
      const finalized = await call(
        payrollController.finalizePayRun,
        mockReq({ params: { restaurantId, payRunId: runId }, user: { id: F.owner } })
      );
      expect(finalized.err).toBeNull();
    }
    const view = await call(
      consolidationController.listBrandPayRuns,
      mockReq({ params: { brandId: String(F.brandId) }, query: { from: '2026-10-01', to: '2026-10-15' }, user: { id: F.owner } })
    );
    expect(view.err).toBeNull();
    expect(view.res.payload.payRuns.map((r) => Number(r.payRunId))).toEqual(
      expect.arrayContaining([Number(runA.id), Number(runB.id)])
    );
    const created = await call(
      consolidationController.createConsolidation,
      mockReq({
        params: { brandId: String(F.brandId) },
        body: { payRunIds: [Number(runA.id), Number(runB.id)] },
        user: { id: F.owner },
      })
    );
    expect(created.err).toBeNull();
    expect(created.res.statusCode).toBe(201);
    const consolidation = created.res.payload.consolidation;
    expect(consolidation.status).toBe('draft');
    expect(consolidation.members).toHaveLength(2);
    expect(consolidation.totals.perCurrency.length).toBeGreaterThanOrEqual(1);
    const selfApprove = await call(
      consolidationController.approveConsolidation,
      mockReq({ params: { brandId: String(F.brandId), consolidationId: String(consolidation.id) }, user: { id: F.owner } })
    );
    expect(selfApprove.err).toMatchObject({ code: 'consolidation_not_finalized' });
    const finalized = await call(
      consolidationController.finalizeConsolidation,
      mockReq({ params: { brandId: String(F.brandId), consolidationId: String(consolidation.id) }, user: { id: F.owner } })
    );
    expect(finalized.err).toBeNull();
    expect(finalized.res.payload.consolidation.status).toBe('finalized');
    const selfApprove2 = await call(
      consolidationController.approveConsolidation,
      mockReq({ params: { brandId: String(F.brandId), consolidationId: String(consolidation.id) }, user: { id: F.owner } })
    );
    expect(selfApprove2.err).toMatchObject({ code: 'consolidation_self_approval' });
    const approved = await call(
      consolidationController.approveConsolidation,
      mockReq({ params: { brandId: String(F.brandId), consolidationId: String(consolidation.id) }, user: { id: F.checker } })
    );
    expect(approved.err).toBeNull();
    expect(approved.res.payload.consolidation.status).toBe('approved');
    expect(approved.res.payload.consolidation.approvedBy).toBe(F.checker);
  });
});
