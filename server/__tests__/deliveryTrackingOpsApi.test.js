'use strict';

/**
 * server/__tests__/deliveryTrackingOpsApi.test.js
 *
 * Covers the operations tracking API and the telematics webhook receiver:
 *  - ops review queue (paginated, job reference + status join)
 *  - ops point review decision (valid/rejected + audit event; invalid input 400)
 *  - webhook: unknown provider -> 404
 *  - webhook: bad signature -> 401 with no further processing
 *  - webhook: good signature -> normalized point + provider receipt persisted
 *  - webhook: replayed event -> 200 { duplicate: true }
 *
 * The pg pool is globally mocked by __tests__/setup.js; queue query results
 * with mockResolvedValueOnce in the exact order the controllers issue them.
 */

const crypto = require('crypto');
const { mockQuery, resetMocks } = require('./setup');

const opsController = require('../controllers/deliveryTrackingOpsController');
const webhookController = require('../controllers/deliveryTelematicsWebhookController');

const WEBHOOK_SECRET_ENV = 'TELEMATICS_TEST_WEBHOOK_SECRET';
const WEBHOOK_SECRET = 'test-webhook-secret-value';

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function bodyOf(res) {
  return res.json.mock.calls[0][0];
}

const CONNECTION_ROW = {
  id: 1,
  provider: 'geotab',
  vehicle_id: 9,
  status: 'active',
  cursor: null,
  webhook_subscription_id: 'sub-1',
  webhook_secret_ref: WEBHOOK_SECRET_ENV,
  credential_ref: 'cred-ref-1',
  last_sync_at: null,
  last_error: null,
  error_count: 0,
  sync_state: {},
  created_at: '2026-09-28T19:00:00.000Z',
  updated_at: '2026-09-28T19:00:00.000Z',
};

const ASSIGNMENT_ROW = {
  id: 42,
  delivery_job_id: 7,
  vehicle_id: 9,
  device_id: 5,
  driver_user_id: 'driver-1',
  source_policy: 'telematics',
};

// Geotab-shaped payload: device.id identifies the vehicle, top-level
// latitude/longitude/dateTime carry the fix, id is the provider event id.
const WEBHOOK_PAYLOAD = {
  id: 'evt-geo-1',
  device: { id: 'veh-geo-9' },
  latitude: 40.7128,
  longitude: -74.006,
  dateTime: '2026-09-28T20:00:00.000Z',
  speed: 36,
  bearing: 90,
};

function goodSignature() {
  // The controller verifies over the canonical JSON serialization when the
  // body was parsed by express.json(); sign the same bytes here.
  return crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(JSON.stringify(WEBHOOK_PAYLOAD), 'utf8')
    .digest('hex');
}

function webhookReq(signature) {
  return {
    params: { provider: 'geotab' },
    headers: { 'x-telematics-signature': signature },
    body: { ...WEBHOOK_PAYLOAD },
    ip: '203.0.113.10',
  };
}

beforeEach(() => {
  resetMocks();
  process.env[WEBHOOK_SECRET_ENV] = WEBHOOK_SECRET;
});

afterEach(() => {
  delete process.env[WEBHOOK_SECRET_ENV];
});

describe('ops review queue', () => {
  test('returns paginated suspicious points joined to job reference and status', async () => {
    const pointRow = {
      id: 11,
      assignment_id: 42,
      delivery_job_id: 7,
      source: 'driver_gps',
      latitude: '40.712800',
      longitude: '-74.006000',
      validation_state: 'suspicious',
      validation_notes: 'implausible_speed:95.2mps',
      job_reference: 'DLV-0001',
      job_status: 'in_transit',
    };
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: 2 }] })
      .mockResolvedValueOnce({ rows: [pointRow] });

    const res = mockRes();
    await opsController.getReviewQueue({ query: { state: 'suspicious', page: '1', limit: '25' } }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = bodyOf(res);
    expect(body.success).toBe(true);
    expect(body.points).toHaveLength(1);
    expect(body.points[0].job_reference).toBe('DLV-0001');
    expect(body.points[0].job_status).toBe('in_transit');
    expect(body.pagination).toEqual({ page: 1, limit: 25, total: 2, pages: 1 });
    const queueCall = mockQuery.mock.calls.find(([sql]) => /FROM delivery_location_points p/.test(sql));
    expect(queueCall[1][0]).toBe('suspicious');
  });

  test('rejects an unknown review state with 400', async () => {
    const res = mockRes();
    await opsController.getReviewQueue({ query: { state: 'bogus' } }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(bodyOf(res).code).toBe('tracking_review_state_invalid');
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('ops point review decision', () => {
  test('marks a suspicious point rejected and writes a tracking_exception audit event', async () => {
    // NOTE: the shared test setup replaces withTransaction with a direct
    // callback runner (no BEGIN/COMMIT), so queue only the callback's queries.
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 9, delivery_job_id: 7, assignment_id: 3, validation_state: 'suspicious' }] }) // SELECT point
      .mockResolvedValueOnce({ rows: [{ id: 9, delivery_job_id: 7, validation_state: 'rejected', validation_notes: 'impossible jump' }] }) // UPDATE
      .mockResolvedValueOnce({ rows: [] }); // audit event insert

    const res = mockRes();
    await opsController.reviewPoint(
      {
        params: { pointId: '9' },
        body: { validationState: 'rejected', notes: 'impossible jump' },
        user: { id: 'ops-user-1' },
      },
      res
    );

    expect(res.status).toHaveBeenCalledWith(200);
    const body = bodyOf(res);
    expect(body.success).toBe(true);
    expect(body.point.validation_state).toBe('rejected');

    const eventCall = mockQuery.mock.calls.find(([sql]) => /INSERT INTO delivery_tracking_events/.test(sql));
    expect(eventCall).toBeDefined();
    expect(eventCall[0]).toMatch(/tracking_exception/);
    // actor is the reviewing ops user; the decision is in the payload.
    // Params: [$1 delivery_job_id, $2 assignment_id, $3 actor_user_id, $4 payload]
    expect(eventCall[1][2]).toBe('ops-user-1');
    expect(JSON.parse(eventCall[1][3]).decision).toBe('rejected');
  });

  test('rejects an invalid validationState with 400 before touching the database', async () => {
    const res = mockRes();
    await opsController.reviewPoint(
      { params: { pointId: '9' }, body: { validationState: 'maybe' }, user: { id: 'ops-user-1' } },
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(bodyOf(res).code).toBe('tracking_review_decision_invalid');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('returns 404 when the point does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // SELECT point -> missing

    const res = mockRes();
    await opsController.reviewPoint(
      { params: { pointId: '999' }, body: { validationState: 'valid' }, user: { id: 'ops-user-1' } },
      res
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(bodyOf(res).code).toBe('tracking_point_not_found');
  });
});

describe('telematics webhook receiver', () => {
  test('unknown provider -> 404 without touching the database', async () => {
    const res = mockRes();
    await webhookController.receiveWebhook(
      { params: { provider: 'acme' }, headers: {}, body: {}, ip: '203.0.113.10' },
      res
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(bodyOf(res).code).toBe('telematics_unknown_provider');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('bad signature -> 401 and no further processing', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [CONNECTION_ROW] }); // active connections

    const res = mockRes();
    await webhookController.receiveWebhook(webhookReq('deadbeef'), res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(bodyOf(res).code).toBe('telematics_bad_signature');
    // Only the connection lookup happened: nothing normalized, persisted, or synced.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test('good signature -> normalized point + provider receipt persisted, cursor advanced', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [CONNECTION_ROW] }) // active connections
      .mockResolvedValueOnce({ rows: [ASSIGNMENT_ROW] }) // active assignment for vehicle
      .mockResolvedValueOnce({ rows: [{ id: 900 }], rowCount: 1 }) // provider_receipt insert
      .mockResolvedValueOnce({ rows: [{ id: 901 }], rowCount: 1 }) // location point insert
      .mockResolvedValueOnce({ rows: [{ id: 1, cursor: 'evt-geo-1' }], rowCount: 1 }); // updateCursor

    const res = mockRes();
    await webhookController.receiveWebhook(webhookReq(goodSignature()), res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = bodyOf(res);
    expect(body).toMatchObject({ success: true, duplicate: false, receiptId: 900, pointId: 901 });

    const receiptCall = mockQuery.mock.calls.find(([sql]) => /provider_receipt/.test(sql));
    expect(receiptCall).toBeDefined();
    expect(receiptCall[1][2]).toBe('geotab');
    expect(receiptCall[1][3]).toBe('evt-geo-1');

    const pointCall = mockQuery.mock.calls.find(([sql]) => /INSERT INTO delivery_location_points/.test(sql));
    expect(pointCall).toBeDefined();
    // (assignment_id, delivery_job_id, source, latitude, longitude, ...)
    expect(pointCall[1].slice(0, 5)).toEqual([42, 7, 'geotab', 40.7128, -74.006]);
    expect(pointCall[1][9]).toBe('telematics:geotab:evt-geo-1');

    const cursorCall = mockQuery.mock.calls.find(([sql]) => /UPDATE delivery_telematics_connections/.test(sql));
    expect(cursorCall).toBeDefined();
    expect(cursorCall[1][1]).toBe('evt-geo-1');
  });

  test('replayed event -> 200 { duplicate: true } with no point or cursor writes', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [CONNECTION_ROW] }) // active connections
      .mockResolvedValueOnce({ rows: [ASSIGNMENT_ROW] }) // active assignment for vehicle
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // provider_receipt hit the unique index

    const res = mockRes();
    await webhookController.receiveWebhook(webhookReq(goodSignature()), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(bodyOf(res)).toEqual({ success: true, duplicate: true });
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO delivery_location_points/.test(sql))).toBe(false);
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE delivery_telematics_connections/.test(sql))).toBe(false);
  });
});
