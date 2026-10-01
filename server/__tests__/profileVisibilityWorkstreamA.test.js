'use strict';

// Workstream A tests: active-work warnings, preview, bulk dry-run/apply with
// idempotent replay, undo against the audit log, scheduled-action validation,
// export CSV, and the minute scheduler's claim/apply/fail behavior.
//
// The DB is the shared pg mock from ./setup (no real database). Workstream B
// modules exist on disk and are exercised for real through their documented
// API (fingerprint-bound approval verification).

const { mockQuery, resetMocks } = require('./setup');
const controller = require('../controllers/profileVisibilityController');
const { getActiveWork } = require('../services/profileVisibilityActiveWork');
const { processDueScheduledActions } = require('../jobs/profileVisibilityScheduledActions');
const { computeFingerprint } = require('../services/profileVisibilityApprovals');

function reqDouble(overrides = {}) {
  return {
    body: {},
    query: {},
    params: {},
    user: { id: 'admin-1' },
    headers: {},
    ...overrides,
  };
}

function resDouble() {
  const res = {
    statusCode: 200,
    payload: null,
    headers: {},
    sent: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
    set(k, v) { this.headers[k] = v; return this; },
    send(body) { this.sent = body; return this; },
  };
  return res;
}

beforeEach(() => {
  resetMocks();
  mockQuery.mockImplementation(async () => ({ rows: [] }));
});

const FUTURE_ISO = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
const PAST_ISO = new Date(Date.now() - 3600 * 1000).toISOString();

describe('getActiveWork service', () => {
  test('returns the documented shape with capped counts for a helper', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: 'u1' }] }) // owner lookup
      .mockResolvedValueOnce({ rows: [{ id: 'j1' }] })      // active jobs
      .mockResolvedValueOnce({ rows: [] })                  // appointments
      .mockResolvedValueOnce({ rows: [{ id: 'b1' }, { id: 'b2' }] }) // booking requests
      .mockResolvedValueOnce({ rows: [] });                 // recent payments
    const work = await getActiveWork('helper', 'u1');
    expect(work).toEqual({
      has_active_work: true,
      active_jobs: 1,
      upcoming_bookings: 2,
      open_orders: 0,
      recent_payments: 0,
    });
  });

  test('counts open food orders for a restaurant', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: 'u9' }] }) // owner lookup
      .mockResolvedValueOnce({ rows: [] })                  // jobs
      .mockResolvedValueOnce({ rows: [{ business_id: 5 }] })// restaurant -> business
      .mockResolvedValueOnce({ rows: [] })                  // business appointments
      .mockResolvedValueOnce({ rows: [{ id: 11 }] })        // open orders
      .mockResolvedValueOnce({ rows: [] });                 // payments
    const work = await getActiveWork('restaurant', '42');
    expect(work.open_orders).toBe(1);
    expect(work.has_active_work).toBe(true);
  });

  test('unknown profile resolves to no active work', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // no owner row
    const work = await getActiveWork('business', '999999');
    expect(work.has_active_work).toBe(false);
  });
});

describe('getProfileActiveWork endpoint', () => {
  test('404s when the profile does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // loadCurrentHidden
    const res = resDouble();
    await controller.getProfileActiveWork(reqDouble({ params: { type: 'helper', id: 'nope' } }), res);
    expect(res.statusCode).toBe(404);
  });

  test('returns the active-work snapshot', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ is_hidden_by_admin: false }] })
      .mockResolvedValueOnce({ rows: [{ user_id: 'u1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'p1' }] });
    const res = resDouble();
    await controller.getProfileActiveWork(reqDouble({ params: { type: 'helper', id: 'u1' } }), res);
    expect(res.payload).toMatchObject({
      profile_type: 'helper',
      profile_id: 'u1',
      has_active_work: true,
      recent_payments: 1,
    });
  });
});

describe('getProfilePreview endpoint', () => {
  test('helper preview uses the canonical /helpers/:uuid route', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{
      display_name: 'Marie J', is_hidden_by_admin: true, owner_visible: true, is_active: true,
    }] });
    const res = resDouble();
    await controller.getProfilePreview(reqDouble({ params: { type: 'helper', id: 'u1' } }), res);
    expect(res.payload.canonical_url).toBe('https://oxsteed.com/helpers/u1');
    expect(res.payload.is_visible).toBe(false); // admin hold wins
    expect(res.payload.display_name).toBe('Marie J');
  });

  test('business and restaurant canonical routes', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{
      display_name: 'Top Plumbing', is_hidden_by_admin: false, owner_visible: true, is_active: true,
    }] });
    let res = resDouble();
    await controller.getProfilePreview(reqDouble({ params: { type: 'business', id: '7' } }), res);
    expect(res.payload.canonical_url).toBe('https://oxsteed.com/businesses/public/7');

    mockQuery.mockResolvedValueOnce({ rows: [{
      display_name: 'Chez Marie', is_hidden_by_admin: false, owner_visible: true, is_active: true,
    }] });
    res = resDouble();
    await controller.getProfilePreview(reqDouble({ params: { type: 'restaurant', id: '9' } }), res);
    expect(res.payload.canonical_url).toBe('https://oxsteed.com/restaurants/r/9');
    expect(res.payload.is_visible).toBe(true);
  });

  test('404s for an unknown profile', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = resDouble();
    await controller.getProfilePreview(reqDouble({ params: { type: 'helper', id: 'nope' } }), res);
    expect(res.statusCode).toBe(404);
  });
});

describe('bulkUpdateVisibility', () => {
  const dryItems = [
    { profile_type: 'helper', profile_id: 'h1', is_visible: false, reason: 'non_compliance' },
    { profile_type: 'business', profile_id: 'b2', is_visible: true },
  ];

  function mockDryRunWork() {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ is_hidden_by_admin: false, hidden_reason: null }] }) // h1 current
      .mockResolvedValueOnce({ rows: [{ user_id: 'u1' }] })
      .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }) // h1 work: clean
      .mockResolvedValueOnce({ rows: [{ is_hidden_by_admin: true, hidden_reason: 'admin_decision' }] }) // b2 current
      .mockResolvedValueOnce({ rows: [{ user_id: 'u2' }] })
      .mockResolvedValueOnce({ rows: [] }) // jobs
      .mockResolvedValueOnce({ rows: [{ business_id: 2 }] })
      .mockResolvedValueOnce({ rows: [] }) // business appointments
      .mockResolvedValueOnce({ rows: [] }); // payments
  }

  test('dry_run returns per-item analysis without writing', async () => {
    mockDryRunWork();
    const res = resDouble();
    await controller.bulkUpdateVisibility(reqDouble({
      body: { items: dryItems, idempotency_key: 'dry-1', dry_run: true },
    }), res);
    expect(res.payload.dry_run).toBe(true);
    expect(res.payload.results).toHaveLength(2);
    expect(res.payload.results[0]).toMatchObject({
      profile_type: 'helper', profile_id: 'h1', ok: true,
      current_hidden: false, resulting_action: 'hide',
    });
    expect(res.payload.results[0].active_work).toMatchObject({ has_active_work: false });
    expect(res.payload.results[1]).toMatchObject({ resulting_action: 'restore', current_hidden: true });
    const writes = mockQuery.mock.calls.filter(([sql]) => /^(UPDATE|INSERT)/i.test(sql.trim()));
    expect(writes).toHaveLength(0);
  });

  test('400s when idempotency_key is missing', async () => {
    const res = resDouble();
    await controller.bulkUpdateVisibility(reqDouble({ body: { items: dryItems } }), res);
    expect(res.statusCode).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('apply processes each item, stores the idempotency row, and notifies', async () => {
    const storedResponse = {
      dry_run: false,
      results: [
        { profile_type: 'helper', profile_id: 'h1', ok: true, action: 'hide', error: null },
        { profile_type: 'business', profile_id: 'b2', ok: true, action: 'restore', error: null },
      ],
    };
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // idempotency check: new key
      .mockResolvedValueOnce({ rows: [{ is_hidden_by_admin: true, hidden_reason: 'non_compliance', hidden_at: 'x' }] }) // h1 UPDATE
      .mockResolvedValueOnce({ rows: [] }) // h1 audit insert
      .mockResolvedValueOnce({ rows: [] }) // h1 notify owner lookup (no owner -> skipped)
      .mockResolvedValueOnce({ rows: [{ is_hidden_by_admin: false, hidden_reason: null, hidden_at: null }] }) // b2 UPDATE
      .mockResolvedValueOnce({ rows: [] }) // b2 audit insert
      .mockResolvedValueOnce({ rows: [] }) // b2 notify owner lookup
      .mockResolvedValueOnce({ rows: [] }) // idempotency insert
      .mockResolvedValueOnce({ rows: [{ response: storedResponse }] }); // stored read
    // (no other queries: notifier resolves no owner and stops)
    const res = resDouble();
    await controller.bulkUpdateVisibility(reqDouble({
      body: { items: dryItems, idempotency_key: 'bulk-1' },
    }), res);
    expect(res.payload).toEqual(storedResponse);
    const updates = mockQuery.mock.calls.filter(([sql]) => /UPDATE (helper_profiles|businesses)/.test(sql));
    expect(updates).toHaveLength(2);
    const idemInsert = mockQuery.mock.calls.find(([sql]) => /INSERT INTO bulk_visibility_idempotency/.test(sql));
    expect(idemInsert).toBeDefined();
    expect(JSON.parse(idemInsert[1][1])).toEqual(storedResponse);
  });

  test('idempotent replay: same key twice returns the identical stored response with one audit trail', async () => {
    const storedResponse = {
      dry_run: false,
      results: [{ profile_type: 'helper', profile_id: 'h1', ok: true, action: 'hide', error: null }],
    };
    // First call: miss, apply, store.
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // idempotency check
      .mockResolvedValueOnce({ rows: [{ is_hidden_by_admin: true, hidden_reason: 'admin_decision', hidden_at: 'x' }] }) // UPDATE
      .mockResolvedValueOnce({ rows: [] }) // audit insert
      .mockResolvedValueOnce({ rows: [] }) // notify owner lookup
      .mockResolvedValueOnce({ rows: [] }) // idempotency insert
      .mockResolvedValueOnce({ rows: [{ response: storedResponse }] }); // stored read
    const first = resDouble();
    await controller.bulkUpdateVisibility(reqDouble({
      body: { items: [dryItems[0]], idempotency_key: 'bulk-replay' },
    }), first);
    expect(first.payload).toEqual(storedResponse);

    // Second call: hit, replay verbatim, no UPDATE.
    resetMocks();
    mockQuery.mockImplementation(async () => ({ rows: [] }));
    mockQuery.mockResolvedValueOnce({ rows: [{ response: storedResponse }] });
    const second = resDouble();
    await controller.bulkUpdateVisibility(reqDouble({
      body: { items: [dryItems[0]], idempotency_key: 'bulk-replay' },
    }), second);
    expect(second.payload).toEqual(storedResponse);
    expect(second.payload).toEqual(first.payload);
    expect(mockQuery.mock.calls.filter(([sql]) => /UPDATE helper_profiles/.test(sql))).toHaveLength(0);
  });

  test('bulk over 10 items without an approval returns 409', async () => {
    const items = Array.from({ length: 11 }, (_, i) => ({
      profile_type: 'helper', profile_id: `h${i}`, is_visible: false,
    }));
    mockQuery.mockResolvedValueOnce({ rows: [] }); // idempotency check: new key
    const res = resDouble();
    await controller.bulkUpdateVisibility(reqDouble({
      body: { items, idempotency_key: 'bulk-big' },
    }), res);
    expect(res.statusCode).toBe(409);
    expect(res.payload.approval_required).toBe(true);
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE helper_profiles/.test(sql))).toBe(false);
  });
});

describe('undoVisibilityChange', () => {
  test('happy path reverts to the before state and logs profile_visibility_undone', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{
        before_state: { is_hidden_by_admin: false },
        after_state: { is_hidden_by_admin: true, hidden_reason: 'non_compliance' },
      }] })
      .mockResolvedValueOnce({ rows: [{ is_hidden_by_admin: true, hidden_reason: 'non_compliance' }] }) // current
      .mockResolvedValueOnce({ rows: [{ is_hidden_by_admin: false, hidden_reason: null }] }); // undo UPDATE
    const res = resDouble();
    await controller.undoVisibilityChange(reqDouble({ params: { type: 'helper', id: 'h1' } }), res);
    expect(res.payload.success).toBe(true);
    expect(res.payload.is_hidden_by_admin).toBe(false);
    const auditInsert = mockQuery.mock.calls.find(
      ([sql, params]) => /INSERT INTO admin_audit_log/.test(sql) && params.includes('profile_visibility_undone')
    );
    expect(auditInsert).toBeDefined();
  });

  test('409 state_changed when the profile moved since the audited change', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{
        before_state: { is_hidden_by_admin: false },
        after_state: { is_hidden_by_admin: true, hidden_reason: 'non_compliance' },
      }] })
      .mockResolvedValueOnce({ rows: [{ is_hidden_by_admin: false, hidden_reason: null }] }); // already restored
    const res = resDouble();
    await controller.undoVisibilityChange(reqDouble({ params: { type: 'helper', id: 'h1' } }), res);
    expect(res.statusCode).toBe(409);
    expect(res.payload).toEqual({ error: 'state_changed' });
    expect(mockQuery.mock.calls.some(([sql]) => /^UPDATE helper_profiles/.test(sql.trim()))).toBe(false);
  });

  test('404 when there is no visibility history', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = resDouble();
    await controller.undoVisibilityChange(reqDouble({ params: { type: 'business', id: 'b1' } }), res);
    expect(res.statusCode).toBe(404);
  });
});

describe('scheduleVisibilityAction', () => {
  const baseBody = {
    profile_type: 'helper', profile_id: 'h1', is_visible: false,
    scheduled_for: FUTURE_ISO, timezone: 'America/New_York',
    idempotency_key: 'sched-1', reason: 'non_compliance',
  };

  test('400s on a past scheduled_for', async () => {
    const res = resDouble();
    await controller.scheduleVisibilityAction(reqDouble({
      body: { ...baseBody, scheduled_for: PAST_ISO },
    }), res);
    expect(res.statusCode).toBe(400);
    expect(res.payload.error).toMatch(/future/);
  });

  test('400s on an invalid IANA timezone', async () => {
    const res = resDouble();
    await controller.scheduleVisibilityAction(reqDouble({
      body: { ...baseBody, timezone: 'Mars/Olympus_Mons' },
    }), res);
    expect(res.statusCode).toBe(400);
    expect(res.payload.error).toMatch(/timezone/i);
  });

  test('400s when idempotency_key is missing', async () => {
    const res = resDouble();
    await controller.scheduleVisibilityAction(reqDouble({
      body: { ...baseBody, idempotency_key: '' },
    }), res);
    expect(res.statusCode).toBe(400);
  });

  test('409 approval_required without a verified approval', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ is_hidden_by_admin: false }] }); // current
    const res = resDouble();
    await controller.scheduleVisibilityAction(reqDouble({ body: baseBody }), res);
    expect(res.statusCode).toBe(409);
    expect(res.payload.approval_required).toBe(true);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO profile_visibility_scheduled_actions/.test(sql))).toBe(false);
  });

  test('201 with a fingerprint-verified approval, storing the approval id', async () => {
    const scheduledAt = new Date(baseBody.scheduled_for).toISOString();
    const payload = controller.buildScheduledApprovalPayload({
      profile_type: 'helper', profile_id: 'h1', is_visible: false,
      scheduled_at: scheduledAt, reason: 'non_compliance',
    });
    const fingerprint = computeFingerprint('scheduled', payload);
    mockQuery
      .mockResolvedValueOnce({ rows: [{ is_hidden_by_admin: false }] }) // current
      .mockResolvedValueOnce({ rows: [{ // approval lookup: approved + matching fingerprint
        id: 'appr-1', status: 'approved', action_type: 'scheduled', fingerprint,
      }] })
      .mockResolvedValueOnce({ rows: [{ // scheduled insert
        id: 'sa-1', profile_type: 'helper', profile_id: 'h1', is_visible: false,
        scheduled_for: scheduledAt, timezone: 'America/New_York', status: 'pending',
        reason: 'non_compliance', note: null, created_at: '2026-10-01T00:00:00Z',
      }] });
    const res = resDouble();
    await controller.scheduleVisibilityAction(reqDouble({
      body: { ...baseBody, approval_id: 'appr-1' },
    }), res);
    expect(res.statusCode).toBe(201);
    expect(res.payload.scheduled.id).toBe('sa-1');
    expect(res.payload.duplicate).toBe(false);
    const insert = mockQuery.mock.calls.find(([sql]) => /INSERT INTO profile_visibility_scheduled_actions/.test(sql));
    expect(insert[1]).toEqual([
      'helper', 'h1', false, scheduledAt, 'America/New_York',
      'sched-1', 'appr-1', 'non_compliance', null, 'admin-1',
    ]);
  });
});

describe('listScheduledActions / cancelScheduledAction', () => {
  test('lists actions ordered by due time', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'sa-1', status: 'pending' }] });
    const res = resDouble();
    await controller.listScheduledActions(reqDouble({ query: { status: 'pending' } }), res);
    expect(res.payload.actions).toHaveLength(1);
    expect(mockQuery.mock.calls[0][1]).toEqual(['pending']);
  });

  test('cancelling a pending action marks it cancelled with actor and timestamp', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{
      id: 'sa-1', profile_type: 'helper', profile_id: 'h1', is_visible: false, status: 'cancelled',
    }] });
    const res = resDouble();
    await controller.cancelScheduledAction(reqDouble({ params: { id: 'sa-1' } }), res);
    expect(res.payload.success).toBe(true);
    expect(res.payload.cancelled.status).toBe('cancelled');
    expect(mockQuery.mock.calls[0][1]).toEqual(['sa-1', 'admin-1']);
  });

  test('cancelling a non-pending action returns 409', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // not pending
      .mockResolvedValueOnce({ rows: [{ id: 'sa-1' }] }); // exists
    const res = resDouble();
    await controller.cancelScheduledAction(reqDouble({ params: { id: 'sa-1' } }), res);
    expect(res.statusCode).toBe(409);
  });

  test('cancelling a missing action returns 404', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const res = resDouble();
    await controller.cancelScheduledAction(reqDouble({ params: { id: 'nope' } }), res);
    expect(res.statusCode).toBe(404);
  });
});

describe('exportAllProfiles', () => {
  test('returns CSV with the documented header and escaped fields', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [
      {
        profile_type: 'helper', display_name: 'Marie "MJ" J', detail: 'marie@example.com',
        is_visible: false, owner_visible: true, hidden_reason: 'non_compliance',
      },
      {
        profile_type: 'business', display_name: 'Top, Plumbing', detail: 'owner@example.com',
        is_visible: true, owner_visible: true, hidden_reason: null,
      },
    ] });
    const res = resDouble();
    await controller.exportAllProfiles(reqDouble({ query: {} }), res);
    expect(res.headers['Content-Type']).toMatch(/text\/csv/);
    expect(res.headers['Content-Disposition']).toMatch(/attachment/);
    const lines = res.sent.trim().split('\r\n');
    expect(lines[0]).toBe('Type,Name,Detail,Visibility,Owner status,Reason');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe('helper,"Marie ""MJ"" J",marie@example.com,Hidden,Listed,non_compliance');
    expect(lines[2]).toBe('business,"Top, Plumbing",owner@example.com,Visible,Listed,');
    expect(mockQuery.mock.calls[0][0]).toMatch(/LIMIT 5001/);
  });
});

describe('profileVisibilityScheduledActions worker', () => {
  test('claims due rows with SKIP LOCKED and applies them', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ lock_id: 'job_lock:x' }] }) // withJobLock acquire
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ // claimed due row
        id: 'a1', profile_type: 'helper', profile_id: 'h1', is_visible: false,
        reason: 'non_compliance', note: null, created_by: 'admin-1',
      }] })
      .mockResolvedValueOnce({ rows: [] }) // SAVEPOINT
      .mockResolvedValueOnce({ rows: [{ is_hidden_by_admin: true }] }) // profile UPDATE
      .mockResolvedValueOnce({ rows: [] }) // audit insert (client-bound)
      .mockResolvedValueOnce({ rows: [] }) // notifier owner lookup (no owner)
      .mockResolvedValueOnce({ rows: [] }) // scheduled row -> applied
      .mockResolvedValueOnce({ rows: [] }) // RELEASE SAVEPOINT
      .mockResolvedValueOnce({ rows: [] }) // COMMIT
      .mockResolvedValueOnce({ rows: [] }); // releaseJobLock
    const outcome = await processDueScheduledActions();
    expect(outcome).toMatchObject({ claimed: 1, applied: 1, failed: 0 });
    const claimSql = mockQuery.mock.calls.find(([sql]) => /FOR UPDATE SKIP LOCKED/.test(sql));
    expect(claimSql).toBeDefined();
    expect(claimSql[0]).toMatch(/status = 'pending' AND scheduled_for <= NOW\(\)/);
    const appliedUpdate = mockQuery.mock.calls.find(([sql]) => /SET status = 'applied'/.test(sql));
    expect(appliedUpdate).toBeDefined();
    const auditInsert = mockQuery.mock.calls.find(
      ([sql, params]) => /INSERT INTO admin_audit_log/.test(sql) && params.includes('profile_visibility_scheduled_applied')
    );
    expect(auditInsert).toBeDefined();
  });

  test('a failing row is marked failed without killing the batch', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ lock_id: 'job_lock:x' }] })
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [
        { id: 'bad', profile_type: 'alien', profile_id: 'x', is_visible: false, reason: null, note: null, created_by: 'admin-1' },
        { id: 'good', profile_type: 'helper', profile_id: 'h1', is_visible: true, reason: null, note: null, created_by: 'admin-1' },
      ] })
      .mockResolvedValueOnce({ rows: [] }) // SAVEPOINT (bad row)
      // bad row throws before any query; ROLLBACK TO + failed UPDATE:
      .mockResolvedValueOnce({ rows: [] }) // ROLLBACK TO SAVEPOINT
      .mockResolvedValueOnce({ rows: [] }) // SET status='failed'
      .mockResolvedValueOnce({ rows: [] }) // SAVEPOINT (good row)
      .mockResolvedValueOnce({ rows: [{ is_hidden_by_admin: false }] }) // profile UPDATE
      .mockResolvedValueOnce({ rows: [] }) // audit insert (client-bound)
      .mockResolvedValueOnce({ rows: [] }) // notifier owner lookup (no owner)
      .mockResolvedValueOnce({ rows: [] }) // scheduled row -> applied
      .mockResolvedValueOnce({ rows: [] }) // RELEASE SAVEPOINT
      .mockResolvedValueOnce({ rows: [] }) // COMMIT
      .mockResolvedValueOnce({ rows: [] }); // releaseJobLock
    const outcome = await processDueScheduledActions();
    expect(outcome).toMatchObject({ claimed: 2, applied: 1, failed: 1 });
    const failedUpdate = mockQuery.mock.calls.find(
      ([sql, params]) => /SET status = 'failed'/.test(sql) && params[0] === 'bad'
    );
    expect(failedUpdate).toBeDefined();
    expect(failedUpdate[1][1]).toMatch(/Unknown profile_type/);
  });
});

describe('migration 617 (static contract)', () => {
  const fs = require('fs');
  const path = require('path');
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '617_profile_visibility_scheduled_actions.sql'), 'utf8'
  );

  test('creates both tables with the specified columns and indexes', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS profile_visibility_scheduled_actions/);
    expect(sql).toMatch(/idempotency_key\s+TEXT\s+NOT NULL UNIQUE/);
    expect(sql).toMatch(/status\s+TEXT\s+NOT NULL DEFAULT 'pending'/);
    expect(sql).toMatch(/CHECK \(status IN \('pending', 'applied', 'cancelled', 'failed'\)\)/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS bulk_visibility_idempotency/);
    expect(sql).toMatch(/idx_pv_scheduled_status_due/);
    expect(sql).toMatch(/idx_pv_scheduled_profile/);
  });

  test('keeps the workstream-B compatibility trigger for scheduled_at inserts', () => {
    expect(sql).toMatch(/pv_scheduled_actions_compat/);
    expect(sql).toMatch(/scheduled_at/);
  });
});
