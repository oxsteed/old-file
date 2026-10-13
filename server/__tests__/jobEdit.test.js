'use strict';

const { mockQuery, resetMocks } = require('./setup');
const { routeQueries } = require('./helpers/sqlRouter');

jest.mock('../services/matchService', () => ({ scoreAndMatch: jest.fn().mockResolvedValue({ total: 0, notified: 0 }) }));
jest.mock('../middleware/upload', () => ({ array: () => (req, res, next) => { req.files = []; next(); } }));

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const jobRoutes = require('../routes/jobs');
const { serializeJob, parseIfMatch, jobEtag } = require('../services/jobSerializer');
const policy = require('../services/jobStatusPolicy');

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const JOB_ID = '33333333-3333-4333-8333-333333333333';
const TOKEN_OWNER = jwt.sign({ id: OWNER_ID, email: 'o@test.com', role: 'customer' }, process.env.JWT_SECRET);
const TOKEN_OTHER = jwt.sign({ id: OTHER_ID, email: 'x@test.com', role: 'customer' }, process.env.JWT_SECRET);

const user = (id) => ({
  id, first_name: 'A', last_name: 'B', email: 'o@test.com', role: 'customer', email_verified: true, is_active: true,
  onboarding_status: 'active', onboarding_completed: true, contact_completed: true, profile_completed: true,
  tier_selected: true, terms_accepted: true, membership_tier: 'free',
  didit_status: 'verified', didit_verified_at: new Date(), didit_enforcement_required: false,
});

const BASE_JOB = Object.freeze({
  id: JOB_ID, client_id: OWNER_ID, status: 'published', version: 4, revision: 1, deleted_at: null,
  title: 'Replace the broken fence panel', description: 'd'.repeat(80), category_name: 'Fencing',
  budget_type: 'fixed', budget_min_cents: 20000, budget_max_cents: 20000, budget_min: '200.00', budget_max: '200.00',
  urgency: 'this_week', site_access: 'easy', recurrence: 'none', notes: 'Gate code 1234', private_notes: null,
  location_address: '1 Main St', location_city: 'Austin', location_state: 'TX', location_zip: '78701', location_country: 'US',
  location_lat: '30.2672000', location_lng: '-97.7431000', location_point: 'POINT', location_approx_lat: '30.25',
  scheduled_start_at: null, scheduled_precision: null, requirements: [], required_skills: [],
});

function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { if (req.headers['x-impersonated']) req.isImpersonated = true; next(); });
  a.use('/api/jobs', jobRoutes);
  return a;
}

/**
 * Wire mocked SQL for the edit transaction. `pendingBids` drives the
 * material-change path; UPDATE jobs echoes the SET values back.
 */
function wire({ job = BASE_JOB, pendingBids = 0, recentMaterial = 0, replay = false, token = 'owner' } = {}) {
  return routeQueries(mockQuery, [
    [/FROM users u/, { rows: [user(token === 'owner' ? OWNER_ID : OTHER_ID)] }],
    [/SELECT \* FROM jobs WHERE id = \$1 FOR UPDATE/, { rows: job ? [job] : [] }],
    [/FROM job_revisions WHERE job_id = \$1 AND actor_id = \$2 AND idempotency_key/, { rows: replay ? [{ id: 1 }] : [] }],
    [/SELECT COUNT\(\*\)::int AS n FROM bids WHERE job_id = \$1 AND status = 'pending'/, { rows: [{ n: pendingBids }] }],
    [/FROM job_revisions\s+WHERE job_id = \$1 AND is_material = TRUE/, { rows: [{ n: recentMaterial }] }],
    [/^\s*UPDATE jobs SET/, (sql, params) => {
      const next = { ...job, version: job.version + 1 };
      const sets = sql.match(/SET (.*) WHERE/s)[1].split(', ');
      sets.forEach((part) => {
        const m = part.match(/^(\w+) = \$(\d+)/);
        if (m) next[m[1]] = params[Number(m[2]) - 1];
        if (part === 'revision = revision + 1') next.revision = job.revision + 1;
      });
      return { rows: [next] };
    }],
    [/UPDATE bids\s+SET needs_reconfirm = TRUE/, { rows: [], rowCount: pendingBids }],
  ]);
}

const patch = (body, { ifMatch = `W/"job-${JOB_ID}-v4"`, token = TOKEN_OWNER, headers = {} } = {}) => {
  let r = request(app()).patch(`/api/jobs/${JOB_ID}`).set('Authorization', `Bearer ${token}`);
  if (ifMatch) r = r.set('If-Match', ifMatch);
  for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
  return r.send(body);
};

beforeEach(() => resetMocks());

describe('job edit: ownership and auth', () => {
  test('non-owner gets the same 404 as a missing job (no enumeration)', async () => {
    wire({ token: 'other' });
    const res = await patch({ notes: 'x' }, { token: TOKEN_OTHER });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('job_not_found');
    wire({ job: null });
    const missing = await patch({ notes: 'x' });
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe('job_not_found');
  });

  test('impersonated sessions cannot edit', async () => {
    wire();
    const res = await patch({ notes: 'x' }, { headers: { 'x-impersonated': '1' } });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('impersonation_blocked');
  });

  test('unauthenticated requests are rejected', async () => {
    const res = await request(app()).patch(`/api/jobs/${JOB_ID}`).send({ notes: 'x' });
    expect(res.status).toBe(401);
  });
});

describe('job edit: status gate', () => {
  test.each(['draft', 'published', 'matched', 'negotiating'])('%s is editable', async (status) => {
    wire({ job: { ...BASE_JOB, status } });
    const res = await patch({ notes: 'Ring twice' });
    expect(res.status).toBe(200);
  });

  test.each(['accepted', 'in_progress', 'completed', 'cancelled', 'closed'])('%s returns 409 job_not_editable', async (status) => {
    wire({ job: { ...BASE_JOB, status } });
    const res = await patch({ notes: 'Ring twice' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('job_not_editable');
  });
});

describe('job edit: optimistic concurrency', () => {
  test('PATCH without If-Match or expected_version returns 428', async () => {
    wire();
    const res = await patch({ notes: 'x' }, { ifMatch: null });
    expect(res.status).toBe(428);
    expect(res.body.code).toBe('precondition_required');
  });

  test('stale If-Match returns 412 with the current ETag', async () => {
    wire();
    const res = await patch({ notes: 'x' }, { ifMatch: `W/"job-${JOB_ID}-v3"` });
    expect(res.status).toBe(412);
    expect(res.body.code).toBe('precondition_failed');
    expect(res.headers.etag).toBe(`W/"job-${JOB_ID}-v4"`);
  });

  test('stale expected_version returns 409 version_conflict', async () => {
    wire();
    const res = await patch({ notes: 'x', expected_version: 2 }, { ifMatch: null });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('version_conflict');
  });

  test('malformed If-Match returns 400', async () => {
    wire();
    const res = await patch({ notes: 'x' }, { ifMatch: 'garbage' });
    expect(res.status).toBe(400);
  });

  test('success returns the new ETag and version', async () => {
    wire();
    const res = await patch({ notes: 'Ring twice' });
    expect(res.status).toBe(200);
    expect(res.headers.etag).toBe(`W/"job-${JOB_ID}-v5"`);
    expect(res.body.version).toBe(5);
    expect(res.body.changed_fields).toEqual(['notes']);
  });

  test('legacy PUT stays compatible without a precondition', async () => {
    wire();
    const res = await request(app()).put(`/api/jobs/${JOB_ID}`).set('Authorization', `Bearer ${TOKEN_OWNER}`)
      .send({ title: 'Replace two broken fence panels', notes: null, budget_max: '' });
    expect(res.status).toBe(200);
    expect(res.body.changed_fields).toEqual(['title']); // nulls/empties ignored in legacy mode
  });
});

describe('job edit: merge-patch semantics and validation', () => {
  test('null clears an optional field', async () => {
    const calls = wire();
    const res = await patch({ notes: null });
    expect(res.status).toBe(200);
    const update = calls.find((c) => /^\s*UPDATE jobs SET/.test(c.sql));
    expect(update.sql).toMatch(/notes = \$1/);
    expect(update.params[0]).toBeNull();
  });

  test('null on a required field is 422 required', async () => {
    wire();
    const res = await patch({ title: null });
    expect(res.status).toBe(422);
    expect(res.body.fields.title).toBe('required');
  });

  test('unknown or locked fields are 422 not_editable', async () => {
    wire();
    const res = await patch({ status: 'completed', client_id: OTHER_ID, media_urls: [] });
    expect(res.status).toBe(422);
    expect(res.body.fields).toEqual({ client_id: 'not_editable', media_urls: 'not_editable' });
  });

  test('inverted budget, negative cents, past schedule, and lone coordinates are rejected with codes', async () => {
    wire();
    const res = await patch({
      budget_type: 'range', budget_min_cents: 50000, budget_max_cents: 10000,
      scheduled_start_at: '2000-01-01T10:00:00Z', location_lat: 30,
    });
    expect(res.status).toBe(422);
    expect(res.body.fields).toMatchObject({ budget_max_cents: 'budget_order', scheduled_start_at: 'in_past', location_lat: 'coordinates_pair' });
    wire();
    const neg = await patch({ budget_min_cents: -5 });
    expect(neg.body.fields.budget_min_cents).toBe('budget_negative');
  });

  test('legacy dollar budgets are converted to cents (single source of truth)', async () => {
    const calls = wire();
    const res = await patch({ budget_min: '250.50', budget_max: '300' });
    expect(res.status).toBe(200);
    const update = calls.find((c) => /^\s*UPDATE jobs SET/.test(c.sql));
    expect(update.sql).toMatch(/budget_min_cents = \$1, budget_max_cents = \$2/);
    expect(update.params.slice(0, 2)).toEqual([25050, 30000]);
    expect(update.sql).not.toMatch(/budget_min =/);
  });

  test('legacy scheduled_date writes the canonical scheduled_start_at', async () => {
    const calls = wire();
    const future = new Date(Date.now() + 10 * 86400e3).toISOString().slice(0, 10);
    const res = await patch({ scheduled_date: future, scheduled_time: '14:30' });
    expect(res.status).toBe(200);
    const update = calls.find((c) => /^\s*UPDATE jobs SET/.test(c.sql));
    expect(update.sql).toMatch(/scheduled_start_at = \$1::timestamptz, scheduled_precision = \$2/);
    expect(update.params[0]).toBe(`${future}T14:30:00.000Z`);
    expect(update.params[1]).toBe('datetime');
  });

  test('no-op edits do not write a revision', async () => {
    const calls = wire();
    const res = await patch({ notes: 'Gate code 1234' });
    expect(res.status).toBe(200);
    expect(res.body.changed_fields).toEqual([]);
    expect(calls.some((c) => /INSERT INTO job_revisions/.test(c.sql))).toBe(false);
  });
});

describe('job edit: bids, revisions, outbox', () => {
  test('material change with pending bids starts a revision and flags bids', async () => {
    const calls = wire({ pendingBids: 3 });
    const res = await patch({ budget_min_cents: 15000, budget_max_cents: 15000 });
    expect(res.status).toBe(200);
    expect(res.body.material_change).toBe(true);
    expect(res.body.bids_flagged_for_reconfirm).toBe(3);
    expect(res.body.revision).toBe(2);
    const update = calls.find((c) => /^\s*UPDATE jobs SET/.test(c.sql));
    expect(update.sql).toMatch(/revision = revision \+ 1/);
    const flag = calls.find((c) => /UPDATE bids\s+SET needs_reconfirm = TRUE/.test(c.sql));
    expect(flag.sql).toMatch(/expires_at = LEAST\(expires_at/);
    const revision = calls.find((c) => /INSERT INTO job_revisions/.test(c.sql));
    expect(revision.params[3]).toBe(true);
    expect(JSON.parse(revision.params[8])).toEqual({
      budget_min_cents: { from: 20000, to: 15000 }, budget_max_cents: { from: 20000, to: 15000 },
    });
    expect(JSON.parse(revision.params[9])).toMatchObject({ budget_min_cents: 20000 }); // snapshot kept with bids
    const events = calls.filter((c) => /INSERT INTO job_event_outbox/.test(c.sql)).map((c) => c.params[1]);
    expect(events).toEqual(['job.updated', 'job.material_change']);
  });

  test('non-material change never asks bidders to reconfirm', async () => {
    const calls = wire({ pendingBids: 3 });
    const res = await patch({ notes: 'Dog is friendly' });
    expect(res.status).toBe(200);
    expect(res.body.material_change).toBe(false);
    expect(calls.some((c) => /SET needs_reconfirm = TRUE/.test(c.sql))).toBe(false);
    const events = calls.filter((c) => /INSERT INTO job_event_outbox/.test(c.sql)).map((c) => c.params[1]);
    expect(events).toEqual(['job.updated']);
  });

  test('bait-and-switch guard: too many material edits with bids is 429', async () => {
    wire({ pendingBids: 2, recentMaterial: 5 });
    const res = await patch({ budget_min_cents: 1000, budget_max_cents: 1000 });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('material_edit_limit');
  });

  test('Idempotency-Key replays return the current job without re-applying', async () => {
    const calls = wire({ replay: true });
    const res = await patch({ notes: 'again' }, { headers: { 'Idempotency-Key': '7b0b4d9e-6d4f-4b7e-9a1e-0d6f8f3c2a11' } });
    expect(res.status).toBe(200);
    expect(res.headers['idempotent-replayed']).toBe('true');
    expect(calls.some((c) => /^\s*UPDATE jobs SET/.test(c.sql))).toBe(false);
  });

  test('response never includes exact coordinates', async () => {
    wire();
    const res = await patch({ notes: 'x y z' });
    expect(res.body.location_lat).toBeUndefined();
    expect(res.body.location_lng).toBeUndefined();
    expect(res.body.location_point).toBeUndefined();
    expect(res.body.job.location_lat).toBeUndefined();
    expect(res.body.location_approx_lat).toBe('30.25');
  });
});

describe('job serializer', () => {
  test('public viewers lose private fields; owners keep them; nobody gets exact coordinates', () => {
    const row = { ...BASE_JOB, escrow_status: 'held', metadata: { creditCollateralHoldId: 9, flagged: true } };
    const pub = serializeJob(row, { user: null });
    for (const key of ['location_lat', 'location_lng', 'location_point', 'location_address', 'escrow_status', 'client_id', 'private_notes', 'metadata']) {
      expect(pub[key]).toBeUndefined();
    }
    const owner = serializeJob(row, { user: { id: OWNER_ID, role: 'customer' } });
    expect(owner.location_address).toBe('1 Main St');
    expect(owner.location_lat).toBeUndefined();
    expect(owner.metadata).toEqual({ flagged: true });
    const admin = serializeJob(row, { user: { id: 'z', role: 'admin' } });
    expect(admin.metadata.creditCollateralHoldId).toBe(9);
    const helper = serializeJob({ ...row, assigned_helper_id: OTHER_ID }, { user: { id: OTHER_ID, role: 'helper' } });
    expect(helper.location_address).toBe('1 Main St');
    expect(helper.private_notes).toBeUndefined();
  });

  test('ETag round-trips through If-Match parsing', () => {
    const etag = jobEtag({ id: JOB_ID, version: 9 });
    expect(parseIfMatch(etag, JOB_ID)).toBe(9);
    expect(parseIfMatch(etag, OTHER_ID)).toBeNaN();
    expect(parseIfMatch('"9"', JOB_ID)).toBe(9);
    expect(parseIfMatch(undefined, JOB_ID)).toBeNull();
  });
});

describe('job status policy', () => {
  test('negotiating is open: editable, biddable, acceptable', () => {
    expect(policy.isOwnerEditable('negotiating')).toBe(true);
    expect(policy.isBiddable('negotiating')).toBe(true);
    expect(policy.isAcceptable('negotiating')).toBe(true);
    expect(policy.canTransition('negotiating', 'accepted')).toBe(true);
    expect(policy.canTransition('published', 'accepted')).toBe(true);
  });

  test('every status has a transition entry and terminal statuses have none', () => {
    for (const status of policy.JOB_STATUSES) expect(Array.isArray(policy.TRANSITIONS[status])).toBe(true);
    expect(policy.TRANSITIONS.cancelled).toEqual([]);
    expect(policy.TRANSITIONS.closed).toEqual([]);
  });
});

describe('GET /api/jobs/:id/revisions', () => {
  test('bidders see only material changes without private fields', async () => {
    routeQueries(mockQuery, [
      [/FROM users u/, { rows: [user(OTHER_ID)] }],
      [/SELECT id, client_id, deleted_at FROM jobs/, { rows: [{ id: JOB_ID, client_id: OWNER_ID }] }],
      [/SELECT 1 FROM bids WHERE job_id = \$1 AND helper_id = \$2/, { rows: [{ '?column?': 1 }] }],
      [/FROM job_revisions/, (sql) => {
        expect(sql).toMatch(/is_material = TRUE/);
        return { rows: [{ id: '7', version: 5, revision: 2, is_material: true, source: 'owner', actor_id: OWNER_ID,
          changes: { budget_min_cents: { from: 1, to: 2 }, location_address: { from: 'a', to: 'b' } }, snapshot: { x: 1 }, created_at: new Date() }] };
      }],
    ]);
    const res = await request(app()).get(`/api/jobs/${JOB_ID}/revisions`).set('Authorization', `Bearer ${TOKEN_OTHER}`);
    expect(res.status).toBe(200);
    expect(res.body.revisions[0].changes).toEqual({ budget_min_cents: { from: 1, to: 2 } });
    expect(res.body.revisions[0].snapshot).toBeUndefined();
    expect(res.body.revisions[0].actor_id).toBeUndefined();
  });

  test('unrelated users get 404', async () => {
    routeQueries(mockQuery, [
      [/FROM users u/, { rows: [user(OTHER_ID)] }],
      [/SELECT id, client_id, deleted_at FROM jobs/, { rows: [{ id: JOB_ID, client_id: OWNER_ID }] }],
    ]);
    const res = await request(app()).get(`/api/jobs/${JOB_ID}/revisions`).set('Authorization', `Bearer ${TOKEN_OTHER}`);
    expect(res.status).toBe(404);
  });
});
