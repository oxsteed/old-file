'use strict';

const AppError = require('../utils/appError');
const { createDispatchService, capabilityFailures, areaCovers, windowForJob, lockResources } = require('../services/localDeliveryDispatchService');
const { createRecoveryService } = require('../services/localDeliveryRecoveryService');

const DRIVER = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const NOW = '2030-01-01T08:00:00.000Z';
const START = '2030-01-01T10:00:00.000Z';
const END = '2030-01-01T12:00:00.000Z';
const NEW_START = '2030-01-02T10:00:00.000Z';
const NEW_END = '2030-01-02T12:00:00.000Z';
const operator = { id: 'operator', role: 'admin' };
const baseJob = () => ({ id: '1', status: 'posted', dispatch_state: 'internal_review', fulfillment_source: 'internal',
  customer_user_id: 'customer', helper_user_id: null, internal_driver_user_id: null, vehicle_id: null,
  pieces: 1, weight_lbs: 20, pickup_window_start: START, pickup_window_end: END,
  delivery_window_start: START, delivery_window_end: END, proof_pin_digest: 'must-not-leak',
  origin_contact_phone: '2125550100', destination_contact_phone: '2125550111' });
const capacity = () => ({ user_id: DRIVER, id: '10', approved: true, active: true, insurance_acknowledged: true,
  max_pieces: 10, max_payload_lbs: 200, cargo_length_in: 40, cargo_width_in: 40, cargo_height_in: 40,
  fragile_supported: true, perishable_supported: true, equipment: { dolly: true, temperatureControl: true }, service_area: {} });
const request = (body = {}, params = { id: '1' }, user = operator, key = 'request-0001') => ({ params, body, user, headers: { 'idempotency-key': key } });

// Transaction-aware fake: mutations become durable only on COMMIT; rollback to
// savepoint restores operation writes while allowing a failed-attempt audit.
// Tests exercise handlers/actions and state, never read service source files.
function fixture(jobPatch = {}, options = {}) {
  let state = { job: { ...baseJob(), ...jobPatch }, reservations: options.reservations || [], attempts: [], activity: [], idempotency: [],
    reschedules: options.reschedules || [], returns: options.returns || [], issues: options.issues || [], proofs: [] };
  let transaction;
  let savepoint;
  const calls = [];
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const db = () => transaction || state;
  const client = {
    release: jest.fn(),
    query: jest.fn(async (sql, args = []) => {
      const q = sql.replace(/\s+/g, ' ').trim();
      calls.push({ sql: q, args });
      const rows = (values = []) => ({ rows: clone(values), rowCount: values.length });
      if (q === 'BEGIN') { transaction = clone(state); return rows(); }
      if (q === 'COMMIT') { state = transaction; transaction = null; return rows(); }
      if (q === 'ROLLBACK') { transaction = null; return rows(); }
      if (q.startsWith('SAVEPOINT')) { savepoint = clone(transaction); return rows(); }
      if (q.startsWith('ROLLBACK TO')) { transaction = clone(savepoint); return rows(); }
      if (q.startsWith('RELEASE SAVEPOINT') || q.includes('pg_advisory_xact_lock')) return rows();
      if (options.failQuery?.(q, args)) throw Object.assign(new Error('Simulated database failure'), { code: options.failCode || 'XX000' });
      if (q.startsWith('SELECT request_hash')) return rows(db().idempotency.filter((entry) => entry.jobId === String(args[0]) && entry.userId === args[1] && entry.action === args[2] && entry.key === args[3]));
      if (q.startsWith('INSERT INTO delivery_action_idempotency')) {
        db().idempotency.push({ jobId: String(args[0]), userId: args[1], action: args[2], key: args[3], request_hash: args[4], response_snapshot: JSON.parse(args[5]) }); return rows();
      }
      if (q.startsWith('SELECT * FROM delivery_jobs')) return rows(String(args[0]) === String(db().job.id) ? [db().job] : []);
      if (q.startsWith('SELECT * FROM delivery_driver_profiles')) return rows(options.noDriver ? [] : [{ ...capacity(), ...options.driver }]);
      if (q.startsWith('SELECT * FROM delivery_vehicles')) return rows(options.noVehicle ? [] : [{ ...capacity(), ...options.vehicle }]);
      if (q.startsWith('SELECT j.id FROM delivery_jobs')) return rows(options.legacyConflict ? [{ id: '9' }] : []);
      if (q.startsWith('SELECT id FROM delivery_assignment_reservations')) {
        if (q.includes('delivery_job_id <>')) return rows(db().reservations.filter((row) => String(row.delivery_job_id) !== String(args[0]) && row.status === 'active'
          && (row.driver_user_id === args[1] || (args[2] && String(row.vehicle_id) === String(args[2])))
          && Date.parse(row.starts_at) < Date.parse(args[4]) && Date.parse(row.ends_at) > Date.parse(args[3])));
        return rows(db().reservations.filter((row) => String(row.delivery_job_id) === String(args[0]) && row.status === 'active'));
      }
      if (q.startsWith('UPDATE delivery_assignment_reservations')) {
        for (const row of db().reservations) if (String(row.delivery_job_id) === String(args[0]) && row.status === 'active') row.status = q.includes("'completed'") ? 'completed' : 'released';
        return rows();
      }
      if (q.startsWith('INSERT INTO delivery_assignment_reservations')) {
        db().reservations.push({ id: db().reservations.length + 1, delivery_job_id: args[0], driver_user_id: args[1], vehicle_id: args[2], starts_at: args[3], ends_at: args[4], status: 'active' }); return rows();
      }
      if (q.startsWith('INSERT INTO delivery_dispatch_attempts')) { db().attempts.push({ sql: q, args }); return rows(); }
      for (const [table, key] of [['delivery_reschedule_requests', 'reschedules'], ['delivery_returns', 'returns'], ['delivery_issues', 'issues']]) {
        if (q.startsWith(`SELECT delivery_job_id FROM ${table}`)) return rows(db()[key].filter((row) => String(row.id) === String(args[0])));
        if (q.startsWith(`SELECT * FROM ${table}`)) return rows(db()[key].filter((row) => String(row.id) === String(args[0]) && String(row.delivery_job_id) === String(args[1])));
        if (q.startsWith(`SELECT id FROM ${table}`)) return rows(db()[key].filter((row) => String(row.delivery_job_id) === String(args[0])
          && (key === 'returns' ? ['requested', 'approved', 'in_transit'].includes(row.status) : row.status === (key === 'issues' ? 'open' : 'pending'))
          && (!q.includes('id <>') || String(row.id) !== String(args[1]))));
      }
      if (q.startsWith('INSERT INTO delivery_reschedule_requests')) {
        const row = { id: '20', delivery_job_id: args[0], requested_by_user_id: args[1], pickup_window_start: args[2], pickup_window_end: args[3], delivery_window_start: args[4], delivery_window_end: args[5], reason: args[6], status: 'pending' };
        db().reschedules.push(row); return rows([row]);
      }
      if (q.startsWith('INSERT INTO delivery_returns')) {
        const row = { id: '30', delivery_job_id: args[0], requested_by_user_id: args[1], reason: args[2], previous_status: args[3], status: 'requested' };
        db().returns.push(row); return rows([row]);
      }
      if (q.startsWith('UPDATE delivery_reschedule_requests')) {
        if (q.includes("status = 'cancelled'")) { db().reschedules.forEach((row) => { if (row.status === 'pending') row.status = 'cancelled'; }); return rows(); }
        const row = db().reschedules.find((entry) => String(entry.id) === String(args[2])); row.status = args[0]; return rows([row]);
      }
      if (q.startsWith('UPDATE delivery_returns')) { const row = db().returns.find((entry) => String(entry.id) === String(args[2])); row.status = args[0]; return rows([row]); }
      if (q.startsWith('UPDATE delivery_issues')) { const row = db().issues.find((entry) => String(entry.id) === String(args[2])); row.status = 'resolved'; row.resolution = args[0]; return rows([row]); }
      if (q.startsWith('UPDATE delivery_proofs')) return rows();
      if (q.startsWith('UPDATE delivery_jobs')) {
        const job = db().job;
        if (q.includes("fulfillment_source = 'internal'")) Object.assign(job, { fulfillment_source: 'internal', dispatch_state: 'internal_assigned', status: 'assigned', internal_driver_user_id: args[0], vehicle_id: args[1], helper_user_id: null });
        else if (q.includes("fulfillment_source = 'marketplace'")) Object.assign(job, { fulfillment_source: 'marketplace', dispatch_state: 'marketplace_posted', status: 'posted', internal_driver_user_id: null, vehicle_id: null, helper_user_id: null });
        else if (q.includes('helper_user_id = $1')) Object.assign(job, { status: 'assigned', dispatch_state: 'assigned', helper_user_id: args[0] });
        else if (q.includes('pickup_window_start = $1')) Object.assign(job, { pickup_window_start: args[0], pickup_window_end: args[1], delivery_window_start: args[2], delivery_window_end: args[3] });
        else if (q.includes("status = 'returned'")) Object.assign(job, { status: 'returned', dispatch_state: 'returned' });
        else if (q.includes("status = 'failed'")) Object.assign(job, { status: 'failed', dispatch_state: 'exception', exception_code: q.includes("'return_requested'") ? 'return_requested' : args[1] });
        else if (q.includes('status = $1')) Object.assign(job, { status: args[0], dispatch_state: args[1], exception_code: args[2] });
        else if (q.includes('proof_pin_attempts')) job.proof_pin_attempts = (job.proof_pin_attempts || 0) + 1;
        else throw new Error(`Unhandled job mutation: ${q}`);
        return rows([job]);
      }
      throw new Error(`Unhandled query: ${q}`);
    }),
  };
  const deps = { pool: { connect: jest.fn(async () => client) }, now: () => new Date(NOW),
    recordActivity: jest.fn(async (_client, jobId, userId, event, payload, visible) => { db().activity.push({ jobId, userId, event, payload, visible }); }),
    validateProof: jest.fn(async () => ({ proofType: 'recipient_confirmation' })),
    recordProof: jest.fn(async (_client, job, proof, userId, key) => { const row = { id: 77, jobId: job.id, proof, userId, key }; db().proofs.push(row); return row; }),
  };
  return { get state() { return state; }, deps, calls, client, dispatch: createDispatchService(deps), recovery: createRecoveryService(deps) };
}

describe('dispatch capabilities', () => {
  test('accepts an approved capable driver for the whole window', () => {
    expect(capabilityFailures(capacity(), baseJob(), { driver: true, window: { start: START, end: END } })).toEqual([]);
  });
  test.each([
    [{ active: false }, {}, 'not_approved_or_active'], [{ approved: false }, {}, 'not_approved_or_active'],
    [{ insurance_acknowledged: false }, {}, 'insurance'], [{ insurance_expires_at: START }, {}, 'insurance_expired'],
    [{ max_pieces: 1 }, { pieces: 2 }, 'pieces'], [{ max_pieces: null }, { pieces: 2 }, 'pieces'],
    [{ max_payload_lbs: 10 }, {}, 'payload'], [{ cargo_length_in: null }, { package_length_in: 2 }, 'dimension_length'],
    [{ cargo_width_in: 1 }, { package_width_in: 2 }, 'dimension_width'], [{ cargo_height_in: 1 }, { package_height_in: 2 }, 'dimension_height'],
    [{ fragile_supported: false }, { fragile: true }, 'fragile'], [{ perishable_supported: false }, { perishable: true }, 'perishable'],
    [{ equipment: {} }, { handling_requirements: { dolly: true } }, 'equipment_dolly'],
    [{ service_area: { states: ['NY'] } }, { origin_state: 'NY', destination_state: 'NJ' }, 'service_area'],
    [{ available_from: END }, {}, 'available_from'], [{ available_until: START }, {}, 'available_until'],
    [{}, { hazmat_declared: true }, 'hazmat'],
  ])('rejects incompatible capacity %j %j', (profile, job, reason) => {
    expect(capabilityFailures({ ...capacity(), ...profile }, { ...baseJob(), ...job }, { driver: true, window: { start: START, end: END } })).toContain(reason);
  });
  test('service area covers both endpoints and rejects unknown configurations', () => {
    const job = { origin_lat: 40, origin_lng: -74, destination_lat: 40.01, destination_lng: -74 };
    expect(areaCovers({ center: { lat: 40, lng: -74 }, radiusMiles: 5 }, job)).toBe(true);
    expect(areaCovers({ center: { lat: 40, lng: -74 }, radiusMiles: 0.1 }, job)).toBe(false);
    expect(areaCovers({ unsupported: true }, job)).toBe(false);
  });
  test('unscheduled old jobs reserve from now; expired schedules cannot be assigned', () => {
    expect(windowForJob({ created_at: '2000-01-01' }, NOW)).toEqual({ start: NOW, end: '2030-01-01T09:00:00.000Z' });
    expect(() => windowForJob({ pickup_window_start: '2000-01-01', delivery_window_end: '2000-01-02' }, NOW)).toThrow();
  });
});

describe('transactional dispatch', () => {
  test('requires an explicit idempotency key before connecting', async () => {
    const f = fixture();
    const req = request(); req.headers = {};
    await expect(f.dispatch.actions.assignInternal(req)).rejects.toMatchObject({ code: 'delivery_idempotency_required' });
    expect(f.deps.pool.connect).not.toHaveBeenCalled();
  });
  test('commits assignment and reservation, replays canonically, rejects changed fingerprints', async () => {
    const f = fixture();
    const body = { driverUserId: DRIVER, vehicleId: '10' };
    const result = await f.dispatch.actions.assignInternal(request(body));
    expect(result.response.job).toMatchObject({ status: 'assigned', internal_driver_user_id: DRIVER });
    expect(result.response.job.proof_pin_digest).toBeUndefined();
    expect(f.state.reservations).toHaveLength(1);
    const replay = await f.dispatch.actions.assignInternal(request({ vehicleId: '10', driverUserId: DRIVER }));
    expect(replay.response.duplicate).toBe(true);
    expect(f.state.attempts).toHaveLength(1);
    await expect(f.dispatch.actions.assignInternal(request({ ...body, vehicleId: '11' }))).rejects.toMatchObject({ code: 'delivery_idempotency_conflict' });
    expect(f.state.reservations).toHaveLength(1);
  });
  test('failed matching persists one attempt and audit, including failure replay', async () => {
    const f = fixture({}, { driver: { max_payload_lbs: 1 } });
    const req = request({ driverUserId: DRIVER, vehicleId: '10' });
    await expect(f.dispatch.actions.assignInternal(req)).rejects.toMatchObject({ code: 'delivery_capacity_mismatch' });
    await expect(f.dispatch.actions.assignInternal(req)).rejects.toMatchObject({ code: 'delivery_capacity_mismatch' });
    expect(f.state.job.status).toBe('posted');
    expect(f.state.reservations).toHaveLength(0);
    expect(f.state.attempts).toHaveLength(1);
    expect(f.state.activity[0]).toMatchObject({ event: 'delivery_assignment_failed', visible: false });
    expect(f.state.idempotency).toHaveLength(1);
  });
  test.each(['driver', 'vehicle'])('rejects an overlapping %s reservation on another job', async (resource) => {
    const f = fixture({}, { reservations: [{ id: 90, delivery_job_id: '2', driver_user_id: resource === 'driver' ? DRIVER : OTHER, vehicle_id: resource === 'vehicle' ? '10' : '99', starts_at: START, ends_at: END, status: 'active' }] });
    await expect(f.dispatch.actions.assignInternal(request({ driverUserId: DRIVER, vehicleId: '10' }))).rejects.toMatchObject({ code: 'delivery_schedule_conflict' });
    expect(f.state.attempts).toHaveLength(1);
    expect(f.state.reservations).toHaveLength(1);
  });
  test('allows adjacent windows and blocks legacy outstanding jobs', async () => {
    const f = fixture({}, { reservations: [{ delivery_job_id: '2', driver_user_id: DRIVER, vehicle_id: '10', starts_at: END, ends_at: NEW_START, status: 'active' }] });
    await expect(f.dispatch.actions.assignInternal(request({ driverUserId: DRIVER, vehicleId: '10' }))).resolves.toMatchObject({ status: 200 });
    const legacy = fixture({}, { legacyConflict: true });
    await expect(legacy.dispatch.actions.assignInternal(request({ driverUserId: DRIVER, vehicleId: '10' }))).rejects.toMatchObject({ code: 'delivery_schedule_conflict' });
  });
  test('exclusion violation rolls back assignment writes but commits failed attempt', async () => {
    const f = fixture({}, { failQuery: (q) => q.startsWith('INSERT INTO delivery_assignment_reservations'), failCode: '23P01' });
    await expect(f.dispatch.actions.assignInternal(request({ driverUserId: DRIVER, vehicleId: '10' }))).rejects.toMatchObject({ code: 'delivery_schedule_conflict' });
    expect(f.state.job.status).toBe('posted');
    expect(f.state.attempts).toHaveLength(1);
  });
  test('database failure rolls back the complete assignment and releases connection', async () => {
    const f = fixture({}, { failQuery: (q) => q.startsWith('INSERT INTO delivery_dispatch_attempts') });
    await expect(f.dispatch.actions.assignInternal(request({ driverUserId: DRIVER, vehicleId: '10' }))).rejects.toThrow('Simulated database failure');
    expect(f.state.job.status).toBe('posted');
    expect(f.state.reservations).toHaveLength(0);
    expect(f.state.idempotency).toHaveLength(0);
    expect(f.client.release).toHaveBeenCalledTimes(1);
  });
  test.each(['picked_up', 'in_transit', 'delivered', 'cancelled', 'returned', 'failed'])('does not release or reassign %s jobs', async (status) => {
    const f = fixture({ status });
    await expect(f.dispatch.actions.releaseMarketplace(request({ reason: 'Capacity unavailable' }))).rejects.toMatchObject({ code: 'delivery_release_conflict' });
    await expect(f.dispatch.actions.assignInternal(request({ driverUserId: DRIVER, vehicleId: '10' }))).rejects.toMatchObject({ code: 'delivery_dispatch_conflict' });
    expect(f.state.job.status).toBe(status);
  });
  test('contradictory legacy pickup evidence blocks release even if status is assigned', async () => {
    const f = fixture({ status: 'assigned', picked_up_at: START });
    await expect(f.dispatch.actions.releaseMarketplace(request({ reason: 'Capacity unavailable' }))).rejects.toMatchObject({ code: 'delivery_release_conflict' });
  });
  test('release clears assignment and helper claim reserves the helper', async () => {
    const f = fixture({ status: 'assigned', dispatch_state: 'internal_assigned', internal_driver_user_id: OTHER, vehicle_id: '10' },
      { reservations: [{ delivery_job_id: '1', driver_user_id: OTHER, vehicle_id: '10', starts_at: START, ends_at: END, status: 'active' }] });
    await f.dispatch.actions.releaseMarketplace(request({ reason: 'Capacity unavailable' }));
    expect(f.state.job).toMatchObject({ status: 'posted', internal_driver_user_id: null, vehicle_id: null });
    expect(f.state.reservations[0].status).toBe('released');
    const claimed = await f.dispatch.actions.claim(request({}, { id: '1' }, { id: DRIVER, role: 'helper' }, 'claim-0001'));
    expect(f.state.job.helper_user_id).toBe(DRIVER);
    expect(f.state.reservations.filter((row) => row.status === 'active')).toHaveLength(1);
    expect(claimed.response.job.internal_driver_user_id).toBeUndefined();
    await expect(f.dispatch.actions.assignInternal(request({ driverUserId: OTHER, vehicleId: '10' }, { id: '1' }, operator, 'assign-0002'))).rejects.toMatchObject({ code: 'delivery_dispatch_conflict' });
  });
  test('release requires an explicit reason', async () => {
    const f = fixture();
    await expect(f.dispatch.actions.releaseMarketplace(request())).rejects.toMatchObject({ code: 'delivery_release_reason_required' });
    expect(f.state.job.dispatch_state).toBe('internal_review');
  });
  test('authorization failures produce no attempts or mutation', async () => {
    const f = fixture();
    await expect(f.dispatch.actions.assignInternal(request({ driverUserId: DRIVER, vehicleId: '10' }, undefined, { id: 'customer' }))).rejects.toMatchObject({ status: 403 });
    expect(f.state.attempts).toHaveLength(0);
  });
  test('locks job before sorted resources before querying conflicts', async () => {
    const f = fixture({ internal_driver_user_id: OTHER, vehicle_id: '11', status: 'assigned', dispatch_state: 'internal_assigned' });
    await f.dispatch.actions.assignInternal(request({ driverUserId: DRIVER, vehicleId: '10' }));
    const keys = f.calls.filter((call) => call.sql.includes('pg_advisory')).map((call) => call.args[0]);
    expect(keys).toEqual([...keys].sort());
    expect(keys).toHaveLength(4);
    const jobIndex = f.calls.findIndex((call) => call.sql.startsWith('SELECT * FROM delivery_jobs'));
    const lockIndex = f.calls.findIndex((call) => call.sql.includes('pg_advisory'));
    const conflictIndex = f.calls.findIndex((call) => call.sql.includes('delivery_job_id <>'));
    expect(jobIndex).toBeLessThan(lockIndex); expect(lockIndex).toBeLessThan(conflictIndex);
  });
});

describe('recovery transactions', () => {
  const schedule = { id: '20', delivery_job_id: '1', status: 'pending', pickup_window_start: NEW_START, pickup_window_end: NEW_END, delivery_window_start: NEW_START, delivery_window_end: NEW_END };
  const assigned = { status: 'assigned', dispatch_state: 'internal_assigned', internal_driver_user_id: DRIVER, vehicle_id: '10' };
  const custody = { ...assigned, status: 'failed', dispatch_state: 'exception', picked_up_at: START, exception_code: 'return_requested' };
  const returnRow = { id: '30', delivery_job_id: '1', status: 'requested', previous_status: 'in_transit' };
  const review = (decision, kind = 'requestId', id = '20', extra = {}, key = 'review-0001') => request({ decision, ...extra }, { [kind]: id }, operator, key);

  test('reschedule request stores the complete schedule and replays once', async () => {
    const f = fixture();
    const req = request({ pickupWindow: { start: NEW_START, end: NEW_END }, deliveryWindow: { start: NEW_START, end: NEW_END } }, undefined, { id: 'customer' });
    expect((await f.recovery.actions.requestReschedule(req)).status).toBe(201);
    expect((await f.recovery.actions.requestReschedule(req)).response.duplicate).toBe(true);
    expect(f.state.reschedules).toHaveLength(1);
    expect(f.state.job.pickup_window_start).toBe(START);
  });
  test('reschedule approval moves reservation and request state atomically', async () => {
    const f = fixture(assigned, { reschedules: [schedule], reservations: [{ delivery_job_id: '1', driver_user_id: DRIVER, vehicle_id: '10', starts_at: START, ends_at: END, status: 'active' }] });
    await f.recovery.actions.reviewReschedule(review('approved'));
    expect(f.state.job.pickup_window_start).toBe(NEW_START);
    expect(f.state.reschedules[0].status).toBe('approved');
    expect(f.state.reservations.map((row) => row.status)).toEqual(['released', 'active']);
    expect(f.state.reservations[1].starts_at).toBe(NEW_START);
  });
  test('reschedule conflict leaves original window, reservation and pending request intact', async () => {
    const f = fixture(assigned, { reschedules: [schedule], reservations: [
      { delivery_job_id: '1', driver_user_id: DRIVER, vehicle_id: '10', starts_at: START, ends_at: END, status: 'active' },
      { delivery_job_id: '2', driver_user_id: DRIVER, vehicle_id: '11', starts_at: NEW_START, ends_at: NEW_END, status: 'active' },
    ] });
    await expect(f.recovery.actions.reviewReschedule(review('approved'))).rejects.toMatchObject({ code: 'delivery_schedule_conflict' });
    expect(f.state.job.pickup_window_start).toBe(START);
    expect(f.state.reservations.every((row) => row.status === 'active')).toBe(true);
    expect(f.state.reschedules[0].status).toBe('pending');
  });
  test('approval rechecks current custody rather than trusting request status', async () => {
    const f = fixture({ ...assigned, status: 'picked_up', picked_up_at: START }, { reschedules: [schedule] });
    await expect(f.recovery.actions.reviewReschedule(review('approved'))).rejects.toMatchObject({ code: 'delivery_reschedule_conflict' });
    expect(f.state.reschedules[0].status).toBe('pending');
  });
  test('rejecting reschedule does not change job or reservations', async () => {
    const f = fixture(assigned, { reschedules: [schedule] });
    await f.recovery.actions.reviewReschedule(review('rejected'));
    expect(f.state.job.pickup_window_start).toBe(START);
    expect(f.state.reschedules[0].status).toBe('rejected');
  });
  test('rejects malformed, backward or stale windows', async () => {
    for (const window of [{ start: START }, { start: END, end: START }, { start: '2020-01-01', end: '2020-01-02' }]) {
      const f = fixture();
      await expect(f.recovery.actions.requestReschedule(request({ pickupWindow: window }))).rejects.toMatchObject({ code: 'delivery_window_invalid' });
      expect(f.state.reschedules).toHaveLength(0);
    }
  });
  test('return request preserves custody, cancels pending reschedule, and deduplicates', async () => {
    const f = fixture({ ...assigned, status: 'in_transit', picked_up_at: START }, { reschedules: [schedule] });
    const req = request({ reason: 'Recipient unavailable' }, undefined, { id: 'customer' });
    await f.recovery.actions.requestReturn(req);
    await f.recovery.actions.requestReturn(req);
    expect(f.state.returns).toHaveLength(1);
    expect(f.state.returns[0].previous_status).toBe('in_transit');
    expect(f.state.job.internal_driver_user_id).toBe(DRIVER);
    expect(f.state.reschedules[0].status).toBe('cancelled');
  });
  test('return rejection restores transit without reopening marketplace or dropping owner', async () => {
    const f = fixture(custody, { returns: [returnRow] });
    await f.recovery.actions.reviewReturn(review('rejected', 'returnId', '30'));
    expect(f.state.job).toMatchObject({ status: 'in_transit', dispatch_state: 'internal_assigned', internal_driver_user_id: DRIVER });
    expect(f.state.returns[0].status).toBe('cancelled');
  });
  test('legacy return without previous status remains exception on rejection', async () => {
    const f = fixture(custody, { returns: [{ ...returnRow, previous_status: null }] });
    await f.recovery.actions.reviewReturn(review('rejected', 'returnId', '30'));
    expect(f.state.job).toMatchObject({ status: 'failed', dispatch_state: 'exception' });
  });
  test.each(['posted', 'assigned', 'delivered', 'cancelled', 'returned'])('does not request return for %s job', async (status) => {
    const f = fixture({ status });
    await expect(f.recovery.actions.requestReturn(request({ reason: 'Return please' }))).rejects.toMatchObject({ code: 'delivery_return_conflict' });
  });
  test('return completion requires approval and verified proof', async () => {
    const f = fixture(custody, { returns: [returnRow] });
    await expect(f.recovery.actions.reviewReturn(review('completed', 'returnId', '30'))).rejects.toMatchObject({ code: 'delivery_return_transition_invalid' });
    expect(f.deps.validateProof).not.toHaveBeenCalled();
    const rejected = fixture(custody, { returns: [{ ...returnRow, status: 'approved' }] });
    rejected.deps.validateProof.mockRejectedValue(new AppError('Proof invalid', 400, 'proof_invalid'));
    await expect(rejected.recovery.actions.reviewReturn(review('completed', 'returnId', '30'))).rejects.toMatchObject({ code: 'proof_invalid' });
    expect(rejected.state.job.status).toBe('failed');
    expect(rejected.state.returns[0].status).toBe('approved');
    expect(rejected.state.proofs).toHaveLength(0);
  });
  test('completion verifies origin recipient and commits proof and reservation release once', async () => {
    const f = fixture(custody, { returns: [{ ...returnRow, status: 'approved' }], reservations: [{ delivery_job_id: '1', status: 'active' }] });
    const req = review('completed', 'returnId', '30', { confirmed: true });
    await f.recovery.actions.reviewReturn(req);
    await f.recovery.actions.reviewReturn(req);
    expect(f.deps.validateProof.mock.calls[0][1].destination_contact_phone).toBe('2125550100');
    expect(f.state.proofs).toHaveLength(1);
    expect(f.state.job.status).toBe('returned');
    expect(f.state.returns[0].status).toBe('completed');
    expect(f.state.reservations[0].status).toBe('completed');
  });
  test('failed proof attempts persist and replay without incrementing again', async () => {
    const f = fixture(custody, { returns: [{ ...returnRow, status: 'approved' }] });
    f.deps.validateProof.mockImplementation(async (client) => {
      await client.query('UPDATE delivery_jobs SET proof_pin_attempts = proof_pin_attempts + 1 WHERE id = $1', ['1']);
      throw Object.assign(new AppError('Invalid PIN', 400, 'delivery_proof_pin_invalid'), { commitValidation: true });
    });
    const req = review('completed', 'returnId', '30');
    await expect(f.recovery.actions.reviewReturn(req)).rejects.toMatchObject({ code: 'delivery_proof_pin_invalid' });
    await expect(f.recovery.actions.reviewReturn(req)).rejects.toMatchObject({ code: 'delivery_proof_pin_invalid' });
    expect(f.state.job.proof_pin_attempts).toBe(1);
    expect(f.state.job.status).toBe('failed');
    expect(f.state.returns[0].status).toBe('approved');
    expect(f.state.activity[0].event).toBe('delivery_proof_rejected');
  });
  test('assigned driver can progress and complete return using registered proof', async () => {
    const f = fixture(custody, { returns: [{ ...returnRow, status: 'approved' }] });
    const req = request({ decision: 'in_transit' }, { id: '1', returnId: '30' }, { id: DRIVER }, 'return-transit-1');
    await f.recovery.actions.reviewReturn(req);
    expect(f.state.returns[0].status).toBe('in_transit');
    await f.recovery.actions.reviewReturn(request({ decision: 'completed', uploadId: 'registered-upload' }, { id: '1', returnId: '30' }, { id: DRIVER }, 'return-complete-1'));
    expect(f.state.job.status).toBe('returned');
    expect(f.deps.validateProof.mock.calls[0][3]).toBe(DRIVER);
  });
  test.each([
    ['customer', 'completed'], [OTHER, 'in_transit'], [DRIVER, 'approved'], [DRIVER, 'rejected'],
  ])('denies return action %s %s without the proper role', async (actor, decision) => {
    const f = fixture(custody, { returns: [returnRow] });
    await expect(f.recovery.actions.reviewReturn(request({ decision }, { returnId: '30' }, { id: actor }))).rejects.toMatchObject({ status: 403 });
    expect(f.state.returns[0].status).toBe('requested');
  });
  test('cannot resolve a request through a different job path', async () => {
    const f = fixture(custody, { returns: [returnRow] });
    const req = review('approved', 'returnId', '30'); req.params.id = '2';
    await expect(f.recovery.actions.reviewReturn(req)).rejects.toMatchObject({ status: 404 });
  });
  test('resolving one of several issues keeps exception state', async () => {
    const f = fixture(custody, { issues: [{ id: '40', delivery_job_id: '1', status: 'open' }, { id: '41', delivery_job_id: '1', status: 'open' }] });
    await f.recovery.actions.resolveIssue(request({ resolution: 'Contact restored' }, { issueId: '40' }));
    expect(f.state.job.dispatch_state).toBe('exception');
    expect(f.state.issues.map((issue) => issue.status)).toEqual(['resolved', 'open']);
  });
  test('explicit resume preserves custody and assignment without redispatch', async () => {
    const f = fixture(custody, { issues: [{ id: '40', delivery_job_id: '1', status: 'open' }] });
    await f.recovery.actions.resolveIssue(request({ resolution: 'Contact restored', resumeStatus: 'in_transit' }, { issueId: '40' }));
    expect(f.state.job).toMatchObject({ status: 'in_transit', dispatch_state: 'internal_assigned', internal_driver_user_id: DRIVER });
    expect(f.state.reservations).toHaveLength(0);
  });
  test('cannot resume assigned after pickup', async () => {
    const f = fixture(custody, { issues: [{ id: '40', delivery_job_id: '1', status: 'open' }] });
    await expect(f.recovery.actions.resolveIssue(request({ resolution: 'Reassign', resumeStatus: 'assigned' }, { issueId: '40' }))).rejects.toMatchObject({ code: 'delivery_recovery_conflict' });
    expect(f.state.issues[0].status).toBe('open');
  });
  test('terminal job stays terminal when resolving an issue', async () => {
    const f = fixture({ status: 'delivered', dispatch_state: 'completed' }, { issues: [{ id: '40', delivery_job_id: '1', status: 'open' }] });
    await f.recovery.actions.resolveIssue(request({ resolution: 'Customer contacted' }, { issueId: '40' }));
    expect(f.state.job).toMatchObject({ status: 'delivered', dispatch_state: 'completed' });
  });
  test('Express wrapper forwards connection failures to next', async () => {
    const next = jest.fn();
    const service = createDispatchService({ pool: { connect: async () => { throw new Error('Connection unavailable'); } } });
    await service.assignInternal(request(), {}, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Connection unavailable' }));
  });
});

test('cross-job resource locks serialize contenders even when no reservation exists yet', async () => {
  // Model only the advisory lock primitive, then execute the actual lockResources
  // function twice. This verifies both calls contend on the same resource keys;
  // PostgreSQL exclusion constraints still need an isolated DB integration run.
  const held = new Map();
  const releases = new Map();
  const order = [];
  function clientFor(name) {
    return { query: async (_sql, [key]) => {
      if (held.has(key)) await held.get(key);
      held.set(key, new Promise((resolve) => releases.set(`${name}:${key}`, resolve)));
      order.push(name);
    } };
  }
  const assignment = { driverId: DRIVER, vehicleId: '10' };
  await lockResources(clientFor('first'), assignment);
  let secondFinished = false;
  const second = lockResources(clientFor('second'), assignment).then(() => { secondFinished = true; });
  await Promise.resolve();
  expect(secondFinished).toBe(false);
  for (const [key, release] of releases) if (key.startsWith('first:')) release();
  await second;
  expect(order).toEqual(['first', 'first', 'second', 'second']);
});
