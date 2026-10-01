'use strict';

/**
 * Connector API tests (/api/connector/v1).
 *
 * Covers the connector contract:
 * - API-key auth: missing/invalid key -> 401, non-admin or inactive key
 *   owner -> 403, active admin/super_admin -> 200.
 * - Every read route returns its documented shape.
 * - Every action delegates to the underlying service core and writes an
 *   audit row with the connector user as actor and source 'connector'.
 * - Separation of duties: a key owner cannot approve their own settings
 *   change proposal.
 */

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');

jest.mock('../services/auditService', () => ({
  logAdminAction: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/paymentQueue', () => ({
  QUEUES: {
    PAYMENT_CAPTURE: 'queue:payment-capture',
    STRIPE_WEBHOOK: 'queue:stripe-webhook',
    NOTIFICATIONS: 'queue:notifications',
  },
  listDeadLetterJobs: jest.fn(),
  requeueDeadLetterJob: jest.fn(),
}));

// The SSRF guard does real DNS; the connector contract test pins it to pass
// so the retry path reaches fetch deterministically.
jest.mock('../utils/webhookUrlSafety', () => ({
  assertPublicWebhookTarget: jest.fn().mockResolvedValue({ ok: true, ips: [] }),
}));

const { logAdminAction } = require('../services/auditService');
const paymentQueue = require('../services/paymentQueue');
const connectorRoutes = require('../routes/connector');

const ADMIN_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const OTHER_ADMIN_ID = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const KEY_ID = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';
const EXCEPTION_ID = '11111111-1111-4111-8111-111111111111';
const BOOKING_ID = '22222222-2222-4222-8222-222222222222';
const PAYOUT_ID = '33333333-3333-4333-8333-333333333333';
const DELIVERY_ID = '44444444-4444-4444-8444-444444444444';
const WEBHOOK_ID = '55555555-5555-4555-8555-555555555555';
const CHANGE_ID = '66666666-6666-4666-8666-666666666666';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/connector/v1', connectorRoutes);
  app.use(errorHandler);
  return app;
}

function keyRow(overrides = {}) {
  return {
    rows: [{
      id: KEY_ID,
      api_product_id: 'product-1',
      customer_id: ADMIN_ID,
      revoked_at: null,
      expires_at: null,
      usage_limit: null,
      requests_this_month: 0,
      max_requests_per_month: 1000,
      created_at: '2026-09-29T00:00:00.000Z',
      ...overrides,
    }],
  };
}

function userRow(overrides = {}) {
  return {
    rows: [{
      id: ADMIN_ID,
      role: 'admin',
      email: 'admin@example.com',
      is_active: true,
      // H4: the connector is an admin surface; the 2FA hard-block in
      // loadConnectorUser rejects key holders without enrolled 2FA.
      totp_enabled: true,
      ...overrides,
    }],
  };
}

/** Queue the three auth queries: api key lookup, usage update, user lookup.
 * H4: grant-gated endpoints run a fourth query (admin_permission_grants).
 * That query is NOT queued here; the beforeEach default implementation
 * below answers it with a global grant, so test-queued controller
 * responses stay aligned. Deny-path tests queue their own grant row
 * (empty / regional) immediately after authSequence(). */
function authSequence(userOverrides) {
  mockQuery
    .mockResolvedValueOnce(keyRow())
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce(userRow(userOverrides));
}

/** Queue the requireConnectorGrant lookup (the 4th query) for grant-gated
 * endpoints whose tests also queue controller DB responses. Call immediately
 * after authSequence(). Pass { rows: [] } to simulate a missing grant. */
function grantSequence(grantRows = [{ id: 'grant-1', region_id: null }]) {
  mockQuery.mockResolvedValueOnce({ rows: grantRows });
}

function apiKeyHeader() {
  return 'Bearer connector-test-key';
}

const originalFetch = global.fetch;

beforeEach(() => {
  resetMocks();
  // H4: grant-gated connector endpoints fall through to this default for
  // the admin_permission_grants lookup: tests run as a granted admin.
  // Deny-path tests queue their own grant row via mockResolvedValueOnce
  // immediately after authSequence() (queued values beat the default).
  mockQuery.mockImplementation(async (text) => {
    if (typeof text === 'string' && text.includes('admin_permission_grants')) {
      return { rows: [{ id: 'grant-1', region_id: null }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  logAdminAction.mockClear();
  paymentQueue.requeueDeadLetterJob.mockReset();
  global.fetch = jest.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('connector auth', () => {
  test('missing API key -> 401', async () => {
    const res = await request(buildApp()).get('/api/connector/v1/me');
    expect(res.status).toBe(401);
  });

  test('invalid API key -> 401', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp())
      .get('/api/connector/v1/me')
      .set('Authorization', apiKeyHeader());
    expect(res.status).toBe(401);
  });

  test('valid key owned by a non-admin -> 403', async () => {
    authSequence({ role: 'helper' });
    const res = await request(buildApp())
      .get('/api/connector/v1/me')
      .set('Authorization', apiKeyHeader());
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('connector_forbidden');
  });

  test('valid key owned by an inactive admin -> 403', async () => {
    authSequence({ is_active: false });
    const res = await request(buildApp())
      .get('/api/connector/v1/me')
      .set('Authorization', apiKeyHeader());
    expect(res.status).toBe(403);
  });

  test('GET /me returns the connector user', async () => {
    authSequence();
    const res = await request(buildApp())
      .get('/api/connector/v1/me')
      .set('Authorization', apiKeyHeader());
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id: ADMIN_ID, role: 'admin', email: 'admin@example.com' });
  });

  test('rejects a key holder without enrolled 2FA (H4 hard-block)', async () => {
    authSequence({ totp_enabled: false });
    const res = await request(buildApp())
      .get('/api/connector/v1/me')
      .set('Authorization', apiKeyHeader());
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('connector_2fa_required');
  });
});

describe('connector reads', () => {
  test('GET /bookings returns the list shape', async () => {
    authSequence();
    const booking = {
      id: BOOKING_ID,
      customer_id: 'dddddddd-dddd-4ddd-addd-dddddddddddd',
      helper_id: 'eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee',
      service_name: 'Deep clean',
      status: 'pending',
      created_at: '2026-09-29T00:00:00.000Z',
      updated_at: '2026-09-29T00:00:00.000Z',
    };
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: 1 }] })
      .mockResolvedValueOnce({ rows: [booking] });

    const res = await request(buildApp())
      .get('/api/connector/v1/bookings')
      .set('Authorization', apiKeyHeader());

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(BOOKING_ID);
    expect(res.body.pagination).toEqual({ limit: 20, total: 1 });
  });

  test('GET /bookings rejects an invalid status with 400 and a code', async () => {
    authSequence();
    const res = await request(buildApp())
      .get('/api/connector/v1/bookings?status=bogus')
      .set('Authorization', apiKeyHeader());
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_status');
  });

  test('GET /bookings/:id returns one booking; unknown id -> 404', async () => {
    authSequence();
    mockQuery.mockResolvedValueOnce({ rows: [{ id: BOOKING_ID, status: 'pending' }] });
    const found = await request(buildApp())
      .get(`/api/connector/v1/bookings/${BOOKING_ID}`)
      .set('Authorization', apiKeyHeader());
    expect(found.status).toBe(200);
    expect(found.body.data.id).toBe(BOOKING_ID);

    authSequence();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const missing = await request(buildApp())
      .get('/api/connector/v1/bookings/99999999-9999-4999-8999-999999999999')
      .set('Authorization', apiKeyHeader());
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe('not_found');
  });

  test('GET /bookings/:id rejects a non-UUID with 400 and a code', async () => {
    authSequence();
    const res = await request(buildApp())
      .get('/api/connector/v1/bookings/not-a-uuid')
      .set('Authorization', apiKeyHeader());
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_id');
  });

  test('GET /payouts returns the list shape with transaction_status', async () => {
    authSequence();
    grantSequence();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: 2 }] })
      .mockResolvedValueOnce({
        rows: [
          { id: PAYOUT_ID, payout_id: 7, transaction_status: 'completed' },
          { id: '77777777-7777-4777-8777-777777777777', payout_id: 8, transaction_status: 'failed' },
        ],
      });

    const res = await request(buildApp())
      .get('/api/connector/v1/payouts?status=completed')
      .set('Authorization', apiKeyHeader());

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination).toEqual({ limit: 20, total: 2 });
    const statusQuery = mockQuery.mock.calls.find(([sql]) => String(sql).includes('FROM payout_transactions') && String(sql).includes('ORDER BY'));
    expect(String(statusQuery[0])).toContain('transaction_status = $1');
    expect(statusQuery[1]).toEqual(['completed', 20]);
  });

  test('GET /payouts rejects an invalid status with 400 and a code', async () => {
    authSequence();
    grantSequence();
    const res = await request(buildApp())
      .get('/api/connector/v1/payouts?status=bogus')
      .set('Authorization', apiKeyHeader());
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_status');
  });

  test('GET /reconciliation-exceptions returns the service list shape', async () => {
    authSequence();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: 1 }] })
      .mockResolvedValueOnce({
        rows: [{ id: EXCEPTION_ID, domain: 'credit', status: 'open', severity: 'warning' }],
      });

    const res = await request(buildApp())
      .get('/api/connector/v1/reconciliation-exceptions?status=open')
      .set('Authorization', apiKeyHeader());

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(EXCEPTION_ID);
    expect(res.body.pagination.total).toBe(1);
  });

  test('GET /reconciliation-exceptions rejects an invalid status with 400 and a code', async () => {
    authSequence();
    const res = await request(buildApp())
      .get('/api/connector/v1/reconciliation-exceptions?status=bogus')
      .set('Authorization', apiKeyHeader());
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_status');
  });

  test('GET /incidents returns the store list shape', async () => {
    authSequence();
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1, type: 'worker_stall', severity: 'critical', acknowledged_at: null, resolved_at: null }],
    });

    const res = await request(buildApp())
      .get('/api/connector/v1/incidents?status=open')
      .set('Authorization', apiKeyHeader());

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].type).toBe('worker_stall');
  });

  test('GET /incidents rejects an invalid status with 400 and a code', async () => {
    authSequence();
    const res = await request(buildApp())
      .get('/api/connector/v1/incidents?status=bogus')
      .set('Authorization', apiKeyHeader());
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_status');
  });

  test('GET /fraud-cases returns the service list shape', async () => {
    authSequence();
    grantSequence();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: 1 }] })
      .mockResolvedValueOnce({
        rows: [{ id: '88888888-8888-4888-8888-888888888888', status: 'open', category: 'chargeback' }],
      });

    const res = await request(buildApp())
      .get('/api/connector/v1/fraud-cases?status=open')
      .set('Authorization', apiKeyHeader());

    expect(res.status).toBe(200);
    expect(res.body.data.cases).toHaveLength(1);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.page).toBe(1);
    expect(res.body.data.limit).toBe(20);
  });

  test('GET /fraud-cases rejects an invalid status with 400 and a code', async () => {
    authSequence();
    grantSequence();
    const res = await request(buildApp())
      .get('/api/connector/v1/fraud-cases?status=bogus')
      .set('Authorization', apiKeyHeader());
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
  });

  test('GET /settings-changes returns the list shape', async () => {
    authSequence();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: CHANGE_ID, kind: 'flag', key: 'x', status: 'proposed' }] })
      .mockResolvedValueOnce({ rows: [{ total: 1 }] });

    const res = await request(buildApp())
      .get('/api/connector/v1/settings-changes?status=proposed')
      .set('Authorization', apiKeyHeader());

    expect(res.status).toBe(200);
    expect(res.body.requests).toHaveLength(1);
    expect(res.body.total).toBe(1);
    expect(res.body.limit).toBe(20);
  });

  test('GET /settings-changes rejects an invalid status with 400 and a code', async () => {
    authSequence();
    const res = await request(buildApp())
      .get('/api/connector/v1/settings-changes?status=bogus')
      .set('Authorization', apiKeyHeader());
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_status');
  });
});

describe('reconciliation exception actions', () => {
  const openException = {
    id: EXCEPTION_ID,
    domain: 'credit',
    reference_id: 'run-1',
    severity: 'warning',
    status: 'open',
    owner_admin_id: null,
    summary: 'Credit reconciliation failed',
    details: { error: 'boom' },
    source_run_id: 'credit-run',
    created_at: '2026-09-29T00:00:00.000Z',
    updated_at: '2026-09-29T00:00:00.000Z',
    resolved_at: null,
  };

  function reconTransitionSequence(updated) {
    authSequence();
    grantSequence();
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [openException] }) // SELECT .. FOR UPDATE
      .mockResolvedValueOnce({ rows: [updated] }) // UPDATE .. RETURNING
      .mockResolvedValueOnce({ rows: [] }); // COMMIT
  }

  test('acknowledge transitions the exception and audits with source connector', async () => {
    const updated = { ...openException, status: 'acknowledged' };
    reconTransitionSequence(updated);

    const res = await request(buildApp())
      .post(`/api/connector/v1/reconciliation-exceptions/${EXCEPTION_ID}/acknowledge`)
      .set('Authorization', apiKeyHeader());

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('acknowledged');
    expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({
      adminId: ADMIN_ID,
      action: 'reconciliation_exception_acknowledged',
    }));
    const auditCall = logAdminAction.mock.calls.find(([args]) => args.action === 'reconciliation_exception_acknowledged');
    expect(auditCall[0].description.startsWith('[connector]')).toBe(true);
    expect(auditCall[0].after.source).toBe('connector');
  });

  test('assign sets the owner and audits with source connector', async () => {
    const updated = { ...openException, owner_admin_id: OTHER_ADMIN_ID };
    authSequence();
    grantSequence();
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [openException] }) // SELECT .. FOR UPDATE
      .mockResolvedValueOnce({ rows: [updated] }) // UPDATE .. RETURNING
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const res = await request(buildApp())
      .post(`/api/connector/v1/reconciliation-exceptions/${EXCEPTION_ID}/assign`)
      .set('Authorization', apiKeyHeader())
      .send({ assignee_id: OTHER_ADMIN_ID });

    expect(res.status).toBe(200);
    expect(res.body.data.owner_admin_id).toBe(OTHER_ADMIN_ID);
    const updateCall = mockQuery.mock.calls.find(([sql]) => String(sql).includes('SET owner_admin_id'));
    expect(updateCall[1]).toEqual([EXCEPTION_ID, OTHER_ADMIN_ID]);
    const auditCall = logAdminAction.mock.calls.find(([args]) => args.action === 'reconciliation_exception_assigned');
    expect(auditCall[0].adminId).toBe(ADMIN_ID);
    expect(auditCall[0].after.source).toBe('connector');
  });

  test('assign rejects a missing assignee_id with 400 and a code', async () => {
    authSequence();
    const res = await request(buildApp())
      .post(`/api/connector/v1/reconciliation-exceptions/${EXCEPTION_ID}/assign`)
      .set('Authorization', apiKeyHeader())
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_assignee_id');
  });

  test('resolve stores resolution notes in details and audits with source connector', async () => {
    const updated = {
      ...openException,
      status: 'resolved',
      details: { error: 'boom', resolution_notes: 'Refunded manually.' },
      resolved_at: '2026-09-30T00:00:00.000Z',
    };
    reconTransitionSequence(updated);

    const res = await request(buildApp())
      .post(`/api/connector/v1/reconciliation-exceptions/${EXCEPTION_ID}/resolve`)
      .set('Authorization', apiKeyHeader())
      .send({ resolution_notes: 'Refunded manually.' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('resolved');
    const updateCall = mockQuery.mock.calls.find(([sql]) => String(sql).includes("SET status = $2"));
    expect(String(updateCall[0])).toContain("jsonb_build_object('resolution_notes', $3)");
    expect(updateCall[1]).toEqual([EXCEPTION_ID, 'resolved', 'Refunded manually.']);
    const auditCall = logAdminAction.mock.calls.find(([args]) => args.action === 'reconciliation_exception_resolved');
    expect(auditCall[0].after.source).toBe('connector');
    expect(auditCall[0].after.details.resolution_notes).toBe('Refunded manually.');
  });

  test('acknowledge on a resolved exception -> 409', async () => {
    authSequence();
    grantSequence();
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ ...openException, status: 'resolved' }] }) // SELECT
      .mockResolvedValueOnce({ rows: [] }) // ROLLBACK
      .mockResolvedValueOnce({ rows: [] }); // catch ROLLBACK

    const res = await request(buildApp())
      .post(`/api/connector/v1/reconciliation-exceptions/${EXCEPTION_ID}/acknowledge`)
      .set('Authorization', apiKeyHeader());
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('reconciliation_transition_invalid');
  });
});

describe('dead-letter requeue action', () => {
  test('requeues the job through the queue service and audits with source connector', async () => {
    authSequence();
    const recovered = { id: 'job-1', status: 'pending', attempts: 0 };
    paymentQueue.requeueDeadLetterJob.mockResolvedValue(recovered);

    const res = await request(buildApp())
      .post('/api/connector/v1/dead-letters/job-1/requeue')
      .set('Authorization', apiKeyHeader())
      .send({ queue: 'queue:payment-capture' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.job).toEqual(recovered);
    expect(paymentQueue.requeueDeadLetterJob).toHaveBeenCalledWith('queue:payment-capture', 'job-1');
    const auditCall = logAdminAction.mock.calls.find(([args]) => args.action === 'ops_dead_letter_requeued');
    expect(auditCall[0].adminId).toBe(ADMIN_ID);
    expect(auditCall[0].description.startsWith('[connector]')).toBe(true);
    expect(auditCall[0].after.source).toBe('connector');
  });

  test('unknown dead-letter job -> 404', async () => {
    authSequence();
    paymentQueue.requeueDeadLetterJob.mockResolvedValue(null);

    const res = await request(buildApp())
      .post('/api/connector/v1/dead-letters/job-9/requeue')
      .set('Authorization', apiKeyHeader())
      .send({ queue: 'queue:payment-capture' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });
});

describe('webhook retry action', () => {
  const joinRow = {
    id: DELIVERY_ID,
    webhook_id: WEBHOOK_ID,
    event_type: 'order.created',
    payload: { orderId: 7 },
    attempt_number: 2,
    completed_at: null,
    webhook_url: 'https://hooks.example.test/deliver',
    custom_headers: {},
    timeout_seconds: 10,
    webhook_is_active: true,
  };

  test('retries the delivery and audits with source connector', async () => {
    authSequence();
    grantSequence();
    const updatedRow = { ...joinRow, attempt_number: 3, completed_at: '2026-09-30T00:00:00.000Z' };
    mockQuery.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.includes('admin_permission_grants')) return { rows: [{ id: 'grant-1', region_id: null }] };
      if (text.includes('FROM webhook_delivery_log d')) return { rows: [joinRow] };
      if (text.includes('UPDATE webhook_delivery_log')) return { rows: [updatedRow] };
      return { rows: [] };
    });
    global.fetch.mockResolvedValue({ status: 200, text: async () => 'ok' });

    const res = await request(buildApp())
      .post('/api/connector/v1/webhooks/retry')
      .set('Authorization', apiKeyHeader())
      .send({ webhook_id: DELIVERY_ID });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://hooks.example.test/deliver',
      expect.objectContaining({ method: 'POST' })
    );
    const auditCall = logAdminAction.mock.calls.find(([args]) => args.action === 'ops_webhook_delivery_retried');
    expect(auditCall[0].adminId).toBe(ADMIN_ID);
    expect(auditCall[0].description.startsWith('[connector]')).toBe(true);
  });

  test('missing webhook_id -> 400 with a code', async () => {
    authSequence();
    const res = await request(buildApp())
      .post('/api/connector/v1/webhooks/retry')
      .set('Authorization', apiKeyHeader())
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_webhook_id');
  });
});

describe('settings change actions', () => {
  const proposedChange = {
    id: CHANGE_ID,
    kind: 'flag',
    key: 'maintenance_mode',
    proposed_value: 'true',
    status: 'proposed',
    proposed_by: OTHER_ADMIN_ID,
    effective_at: null,
    created_at: '2026-09-29T00:00:00.000Z',
  };

  test('approve applies a due change and audits with source connector', async () => {
    authSequence();
    grantSequence();
    const approvedRow = { ...proposedChange, status: 'approved' };
    const appliedRow = { ...proposedChange, status: 'applied' };
    mockQuery.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.startsWith('BEGIN') || text.startsWith('COMMIT') || text.startsWith('ROLLBACK')) {
        return { rows: [] };
      }
      if (text.includes('FROM settings_change_requests WHERE id = $1 FOR UPDATE')) {
        return { rows: [approvedRow] };
      }
      if (text.includes('FROM settings_change_requests WHERE id = $1')) {
        return { rows: [proposedChange] };
      }
      if (text.includes("SET status = 'approved'")) {
        return { rows: [] };
      }
      if (text.includes('FROM feature_flags WHERE key = $1 FOR UPDATE')) {
        return { rows: [{ is_enabled: false }] };
      }
      if (text.includes('UPDATE feature_flags SET is_enabled')) {
        return { rows: [] };
      }
      if (text.includes("SET status = 'applied'")) {
        return { rows: [appliedRow] };
      }
      return { rows: [] };
    });

    const res = await request(buildApp())
      .post(`/api/connector/v1/settings-changes/${CHANGE_ID}/approve`)
      .set('Authorization', apiKeyHeader());

    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(true);
    expect(res.body.request.status).toBe('applied');
    const approveAudit = logAdminAction.mock.calls.find(([args]) => args.action === 'settings_change_approved');
    expect(approveAudit[0].adminId).toBe(ADMIN_ID);
    expect(approveAudit[0].description.startsWith('[connector]')).toBe(true);
    expect(approveAudit[0].after.source).toBe('connector');
    const applyAudit = logAdminAction.mock.calls.find(([args]) => args.action === 'settings_change_applied');
    expect(applyAudit).toBeDefined();
  });

  test('a key owner cannot approve their own proposal (separation of duties)', async () => {
    authSequence();
    grantSequence();
    mockQuery.mockImplementation(async (sql) => {
      if (String(sql).includes('FROM settings_change_requests WHERE id = $1')) {
        return { rows: [{ ...proposedChange, proposed_by: ADMIN_ID }] };
      }
      return { rows: [] };
    });

    const res = await request(buildApp())
      .post(`/api/connector/v1/settings-changes/${CHANGE_ID}/approve`)
      .set('Authorization', apiKeyHeader());

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('separation_of_duties');
  });

  test('reject records the reason and audits with source connector', async () => {
    authSequence();
    grantSequence();
    const rejectedRow = { ...proposedChange, status: 'rejected' };
    mockQuery.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.includes('FROM settings_change_requests WHERE id = $1')) {
        return { rows: [proposedChange] };
      }
      if (text.includes("SET status = 'rejected'")) {
        return { rows: [rejectedRow] };
      }
      return { rows: [] };
    });

    const res = await request(buildApp())
      .post(`/api/connector/v1/settings-changes/${CHANGE_ID}/reject`)
      .set('Authorization', apiKeyHeader())
      .send({ reason: 'Not needed right now.' });

    expect(res.status).toBe(200);
    expect(res.body.request.status).toBe('rejected');
    const rejectAudit = logAdminAction.mock.calls.find(([args]) => args.action === 'settings_change_rejected');
    expect(rejectAudit[0].adminId).toBe(ADMIN_ID);
    expect(rejectAudit[0].description.startsWith('[connector]')).toBe(true);
    expect(rejectAudit[0].after.source).toBe('connector');
  });

  test('reject without a reason -> 400 with a code', async () => {
    authSequence();
    const res = await request(buildApp())
      .post(`/api/connector/v1/settings-changes/${CHANGE_ID}/reject`)
      .set('Authorization', apiKeyHeader())
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('missing_reason');
  });
});
