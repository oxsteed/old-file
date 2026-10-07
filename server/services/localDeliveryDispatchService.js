'use strict';

const crypto = require('crypto');
const AppError = require('../utils/appError');
const integrity = require('./localDeliveryIntegrity');

// All writers lock the job before its resources. Resources are locked in sorted
// order, including the previous assignment on reassignment. Exclusion constraints
// remain the final guard against writers which do not use this protocol.
const TERMINAL = new Set(['delivered', 'cancelled', 'returned']);
const OPERATORS = new Set(['sourcing_operator', 'logistics_coordinator', 'warehouse_operator', 'admin', 'super_admin']);
const HELPERS = new Set(['helper', 'helper_pro', 'business_owner', 'business_manager', 'business_representative', 'business_employee']);
const fail = (message, code, status = 409) => new AppError(message, status, code);
const sameId = (a, b) => a != null && b != null && String(a) === String(b);
const isOperator = (user) => ['admin', 'super_admin'].includes(user?.role) || OPERATORS.has(user?.logistics_role);
const isParticipant = (job, user) => [job.customer_user_id, job.helper_user_id, job.internal_driver_user_id].some((id) => sameId(id, user?.id));
const pickedUp = (job) => Boolean(job.picked_up_at || job.delivered_at || job.returned_at) || ['picked_up', 'in_transit', 'delivered', 'returned'].includes(job.status);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, canonical(value[key])]));
  return value;
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function cleanText(value, max, fallback = '') {
  if (value == null) return fallback;
  if (typeof value !== 'string' || value.trim().length > max) throw fail('Invalid text value', 'delivery_input_invalid', 400);
  return value.trim() || fallback;
}

function positiveId(value) {
  if (!/^[1-9]\d*$/.test(String(value ?? ''))) throw fail('Invalid delivery identifier', 'delivery_id_invalid', 400);
  return String(value);
}

function windowForJob(job, now = new Date()) {
  const startsAt = job.pickup_window_start || now;
  const start = new Date(startsAt).getTime();
  const endValue = job.delivery_window_end || job.pickup_window_end || job.estimated_arrival_at;
  const end = endValue ? new Date(endValue).getTime() : start + Math.max(60, Number(job.duration_minutes) || 60) * 60000;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end <= new Date(now).getTime()) {
    throw fail('A current, valid delivery window is required', 'delivery_window_invalid', 400);
  }
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
}

function areaCovers(area, job) {
  if (area == null || (typeof area === 'object' && !Array.isArray(area) && Object.keys(area).length === 0)) return true;
  if (typeof area !== 'object' || Array.isArray(area)) return false;
  const allowed = new Set(['states', 'cities', 'postalCodes', 'center', 'radiusMiles']);
  if (Object.keys(area).some((key) => !allowed.has(key))) return false;
  for (const prefix of ['origin', 'destination']) {
    for (const [key, field] of [['states', 'state'], ['cities', 'city'], ['postalCodes', 'postal_code']]) {
      if (area[key] !== undefined) {
        if (!Array.isArray(area[key]) || !area[key].length) return false;
        if (!area[key].some((entry) => String(entry).trim().toLowerCase() === String(job[`${prefix}_${field}`] ?? '').trim().toLowerCase())) return false;
      }
    }
    if (area.center !== undefined || area.radiusMiles !== undefined) {
      const values = [area.center?.lat, area.center?.lng, job[`${prefix}_lat`], job[`${prefix}_lng`], area.radiusMiles];
      if (values.some((value) => value == null || value === '' || !Number.isFinite(Number(value)))) return false;
      const [lat, lng, destLat, destLng, radius] = values.map(Number);
      if (Math.abs(lat) > 90 || Math.abs(destLat) > 90 || Math.abs(lng) > 180 || Math.abs(destLng) > 180 || radius <= 0) return false;
      const rad = (value) => value * Math.PI / 180;
      const a = Math.sin(rad(destLat - lat) / 2) ** 2 + Math.cos(rad(lat)) * Math.cos(rad(destLat)) * Math.sin(rad(destLng - lng) / 2) ** 2;
      if (3958.7613 * 2 * Math.asin(Math.sqrt(Math.min(1, a))) > radius) return false;
    }
  }
  return true;
}

// Null availability means no configured hours (legacy profiles). An explicit
// empty array means unavailable. Windows are absolute UTC intervals.
function availableDuring(availability, window) {
  if (availability == null) return true;
  if (!Array.isArray(availability)) return false;
  return availability.some((slot) => slot && Number.isFinite(Date.parse(slot.start)) && Number.isFinite(Date.parse(slot.end))
    && Date.parse(slot.start) <= Date.parse(window.start) && Date.parse(slot.end) >= Date.parse(window.end));
}

function capabilityFailures(capacity, job, { driver = false, window } = {}) {
  if (!capacity) return ['missing_profile'];
  const reasons = [];
  if (capacity.active !== true || (driver && capacity.approved !== true)) reasons.push('not_approved_or_active');
  if (capacity.insurance_acknowledged !== true) reasons.push('insurance');
  if (capacity.insurance_expires_at && (!Number.isFinite(Date.parse(capacity.insurance_expires_at))
    || Date.parse(capacity.insurance_expires_at) < Date.parse(window?.end || new Date().toISOString()))) reasons.push('insurance_expired');
  const pieces = Number(job.pieces ?? 1);
  const maxPieces = Number(capacity.max_pieces ?? 1); // Never infer multi-piece capacity for legacy profiles.
  if (!Number.isInteger(pieces) || pieces < 1 || !Number.isInteger(maxPieces) || maxPieces < pieces) reasons.push('pieces');
  const weight = Number(job.weight_lbs ?? 0);
  if (!Number.isFinite(weight) || weight < 0 || !Number.isFinite(Number(capacity.max_payload_lbs)) || Number(capacity.max_payload_lbs ?? 0) < weight) reasons.push('payload');
  for (const axis of ['length', 'width', 'height']) {
    const value = job[`package_${axis}_in`];
    if (value != null && (!(Number(value) > 0) || !(Number(capacity[`cargo_${axis}_in`]) >= Number(value)))) reasons.push(`dimension_${axis}`);
  }
  const equipment = capacity.equipment || {};
  if (job.fragile && capacity.fragile_supported !== true) reasons.push('fragile');
  if (job.perishable && capacity.perishable_supported !== true) reasons.push('perishable');
  if (job.hazmat_declared) reasons.push('hazmat');
  for (const [key, required] of Object.entries(job.handling_requirements || {})) {
    if (required === true && equipment[key] !== true) reasons.push(`equipment_${key}`);
  }
  if (!areaCovers(capacity.service_area, job)) reasons.push('service_area');
  if (window && !availableDuring(capacity.availability, window)) reasons.push('availability');
  if (window && capacity.available_from && (!Number.isFinite(Date.parse(capacity.available_from)) || Date.parse(capacity.available_from) > Date.parse(window.start))) reasons.push('available_from');
  if (window && capacity.available_until && (!Number.isFinite(Date.parse(capacity.available_until)) || Date.parse(capacity.available_until) < Date.parse(window.end))) reasons.push('available_until');
  return reasons;
}

async function lockResources(client, ...assignments) {
  const keys = new Set();
  for (const assignment of assignments) {
    if (assignment?.driverId) keys.add(`local-delivery:driver:${assignment.driverId}`);
    if (assignment?.vehicleId) keys.add(`local-delivery:vehicle:${assignment.vehicleId}`);
  }
  for (const key of [...keys].sort()) await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
}

function assignmentOf(job) {
  return { driverId: job.internal_driver_user_id || job.helper_user_id, vehicleId: job.vehicle_id };
}

async function ensureNoOpenRecovery(client, job) {
  const result = await client.query(`SELECT id FROM delivery_returns WHERE delivery_job_id = $1 AND status IN ('requested','approved','in_transit') LIMIT 1`, [job.id]);
  if (result.rows.length || job.exception_code) throw fail('Resolve the delivery exception before dispatching', 'delivery_recovery_pending');
  const issues = await client.query("SELECT id FROM delivery_issues WHERE delivery_job_id = $1 AND status = 'open' LIMIT 1", [job.id]);
  if (issues.rows.length) throw fail('Resolve open issues before dispatching', 'delivery_recovery_pending');
}

async function reserve(client, job, assignment, window) {
  const { driverId, vehicleId } = assignment;
  if (!driverId) throw fail('An assigned driver is required', 'delivery_driver_required');
  const conflict = await client.query(
    `SELECT id FROM delivery_assignment_reservations WHERE status = 'active' AND delivery_job_id <> $1
      AND (driver_user_id = $2 OR vehicle_id = $3) AND starts_at < $5 AND ends_at > $4 LIMIT 1`,
    [job.id, driverId, vehicleId || null, window.start, window.end],
  );
  if (conflict.rows.length) throw fail('Driver or vehicle is already scheduled', 'delivery_schedule_conflict');
  // Old assignments may predate reservations. Missing windows are treated as
  // occupied, and custody remains occupied even when its planned window expired.
  const legacy = await client.query(
    `SELECT j.id FROM delivery_jobs j WHERE j.id <> $1 AND j.status NOT IN ('delivered','cancelled','returned')
      AND (j.internal_driver_user_id = $2 OR j.helper_user_id = $2 OR j.vehicle_id = $3)
      AND (j.picked_up_at IS NOT NULL OR j.status IN ('picked_up','in_transit','failed') OR
        (NOT EXISTS (SELECT 1 FROM delivery_assignment_reservations r WHERE r.delivery_job_id = j.id AND r.status = 'active')
          AND (j.pickup_window_start IS NULL OR j.delivery_window_end IS NULL OR
            (j.pickup_window_start < $5 AND j.delivery_window_end > $4)))) LIMIT 1`,
    [job.id, driverId, vehicleId || null, window.start, window.end],
  );
  if (legacy.rows.length) throw fail('Driver or vehicle has an outstanding delivery', 'delivery_schedule_conflict');
  await client.query("UPDATE delivery_assignment_reservations SET status = 'released' WHERE delivery_job_id = $1 AND status = 'active'", [job.id]);
  await client.query('INSERT INTO delivery_assignment_reservations (delivery_job_id, driver_user_id, vehicle_id, starts_at, ends_at) VALUES ($1,$2,$3,$4,$5)', [job.id, driverId, vehicleId || null, window.start, window.end]);
}

async function checkAssignment(client, job, assignment, window) {
  const driver = (await client.query('SELECT * FROM delivery_driver_profiles WHERE user_id = $1 FOR SHARE', [assignment.driverId])).rows[0];
  const vehicle = assignment.vehicleId ? (await client.query('SELECT * FROM delivery_vehicles WHERE id = $1 FOR SHARE', [assignment.vehicleId])).rows[0] : null;
  const reasons = capabilityFailures(driver, job, { driver: true, window });
  if (assignment.vehicleId) reasons.push(...capabilityFailures(vehicle, job, { window }).map((reason) => `vehicle_${reason}`));
  if (reasons.length) throw new AppError('Driver or vehicle cannot carry this delivery', 409, 'delivery_capacity_mismatch', { reasons });
}

const recordActivity = integrity.recordActivity;

function authorize(req, job, access) {
  if (!req.user?.id) throw fail('Authentication required', 'auth_required', 401);
  if (access === 'operator' && !isOperator(req.user)) throw fail('Operations access required', 'delivery_operator_required', 403);
  if (access === 'participant' && !isOperator(req.user) && !isParticipant(job, req.user)) throw fail('Delivery job not found', 'delivery_not_found', 404);
  if (access === 'helper' && !(HELPERS.has(req.user.default_mode) || req.user.role === 'helper')) throw fail('Helper access required', 'delivery_helper_required', 403);
  if (access === 'returnReviewer' && !isOperator(req.user)) {
    const assigned = [job.helper_user_id, job.internal_driver_user_id].some((id) => sameId(id, req.user.id));
    if (!assigned || !['in_transit', 'completed'].includes(req.body?.decision)) throw fail('Only operations may review returns; assigned drivers may report return progress', 'delivery_return_operator_required', 403);
  }
}

// Public factories permit dependency injection without opening a database at
// import time. Each operation owns its transaction; do not pass an active client.
function createActionRunner(deps = {}) {
  return async function run(req, { action, access, child, persistFailure = false, status = 200 }, operation) {
    if (!req.user?.id) throw fail('Authentication required', 'auth_required', 401);
    const key = integrity.idempotencyKey(req);
    const pool = deps.pool || require('../db');
    const client = await pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN');
      let jobId = req.params?.id;
      let childId;
      if (child) {
        childId = positiveId(req.params?.[child.param]);
        const found = await client.query(`SELECT delivery_job_id FROM ${child.table} WHERE id = $1`, [childId]);
        if (!found.rows[0]) throw fail('Delivery request not found', 'delivery_not_found', 404);
        jobId = found.rows[0].delivery_job_id;
        if (req.params?.id && !sameId(req.params.id, jobId)) throw fail('Delivery request not found', 'delivery_not_found', 404);
      }
      positiveId(jobId);
      const job = (await client.query('SELECT * FROM delivery_jobs WHERE id = $1 FOR UPDATE', [jobId])).rows[0];
      if (!job) throw fail('Delivery job not found', 'delivery_not_found', 404);
      authorize(req, job, access);
      const { clientRequestId, idempotencyKey, ...body } = req.body || {};
      const input = { jobId: String(job.id), childId: childId || null, action, body };
      const prior = await integrity.actionReplay(client, job, req.user, action, key, input);
      let outcome;
      if (prior) {
        const snapshot = prior;
        outcome = snapshot.error ? snapshot : snapshot.response ? { ...snapshot, response: { ...snapshot.response, duplicate: true } } : { status, response: { ...snapshot, duplicate: true } };
      } else {
        let request;
        if (child) {
          request = (await client.query(`SELECT * FROM ${child.table} WHERE id = $1 AND delivery_job_id = $2 FOR UPDATE`, [childId, job.id])).rows[0];
          if (!request) throw fail('Delivery request not found', 'delivery_not_found', 404);
        }
        await client.query('SAVEPOINT delivery_action');
        const activity = deps.recordActivity || recordActivity;
        try {
          outcome = { status, response: await operation({ client, req, job, request, key, activity, now: deps.now ? deps.now() : new Date() }) };
          await client.query('RELEASE SAVEPOINT delivery_action');
        } catch (caught) {
          const error = caught.code === '23P01' ? fail('Driver or vehicle is already scheduled', 'delivery_schedule_conflict') : caught;
          if ((!persistFailure && !error.commitValidation) || !error.isOperational || error.status >= 500) throw error;
          if (!error.commitValidation) await client.query('ROLLBACK TO SAVEPOINT delivery_action');
          // Do not store unvalidated foreign keys or private proof input in audit.
          if (persistFailure) await client.query("INSERT INTO delivery_dispatch_attempts (delivery_job_id, source, action, reason, actor_user_id) VALUES ($1,$2,'assignment_failed',$3,$4)", [job.id, action === 'claim' ? 'marketplace' : 'internal', error.code, req.user.id]);
          await activity(client, job.id, req.user.id, error.commitValidation ? 'delivery_proof_rejected' : 'delivery_assignment_failed', { code: error.code, reasons: error.fields?.reasons || [] }, false);
          outcome = { status: error.status, error: { code: error.code, message: error.message, fields: error.fields } };
        }
        if (outcome.response?.job) {
          if (!isOperator(req.user)) outcome.response.job = integrity.customerSafeJob(outcome.response.job, req.user);
          else {
            outcome.response.job = { ...outcome.response.job };
            for (const field of ['proof_pin_digest', 'proof_pin_attempts', 'proof_pin_locked_until', 'proof_pin_consumed_at']) delete outcome.response.job[field];
          }
        }
        await integrity.saveAction(client, job, req.user, action, key, input, outcome);
      }
      await client.query('COMMIT');
      committed = true;
      if (outcome.error) throw new AppError(outcome.error.message, outcome.status, outcome.error.code, outcome.error.fields);
      return outcome;
    } catch (error) {
      if (!committed) try { await client.query('ROLLBACK'); } catch (_) { /* preserve the initiating error */ }
      if (error.code === '23P01') throw fail('Driver or vehicle is already scheduled', 'delivery_schedule_conflict');
      throw error;
    } finally { client.release(); }
  };
}

function handler(operation) {
  return async (req, res, next) => {
    try {
      const result = await operation(req);
      return res.status(result.status).json(result.response);
    } catch (error) { return next(error); }
  };
}

function createDispatchService(deps = {}) {
  const run = createActionRunner(deps);
  const actions = {
    assignInternal: (req) => run(req, { action: 'assignInternal', access: 'operator', persistFailure: true }, async ({ client, job, activity, now }) => {
      if (!['posted', 'assigned'].includes(job.status) || pickedUp(job) || job.helper_user_id
        || !['internal_review', 'internal_assignment_attempt', 'internal_assigned', 'exception'].includes(job.dispatch_state)) throw fail('Delivery is not available for internal assignment', 'delivery_dispatch_conflict');
      await ensureNoOpenRecovery(client, job);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.body?.driverUserId || '')) throw fail('A valid driver is required', 'delivery_driver_invalid', 400);
      const assignment = { driverId: req.body.driverUserId.toLowerCase(), vehicleId: positiveId(req.body.vehicleId) };
      await lockResources(client, assignmentOf(job), assignment);
      const window = windowForJob(job, now);
      await checkAssignment(client, job, assignment, window);
      await reserve(client, job, assignment, window);
      // Stop any prior tracking session for this job (reassignment).
      await client.query(
        `UPDATE delivery_tracking_assignments SET status = 'revoked', ended_at = NOW(), ended_reason = 'reassigned', updated_at = NOW()
         WHERE delivery_job_id = $1 AND status IN ('active', 'paused')`,
        [job.id]
      );
      const updated = (await client.query(`UPDATE delivery_jobs SET fulfillment_source = 'internal', dispatch_state = 'internal_assigned', status = 'assigned',
        helper_user_id = NULL, internal_driver_user_id = $1, vehicle_id = $2, assigned_by_user_id = $3,
        internal_assigned_at = NOW(), assigned_at = NOW(), updated_at = NOW() WHERE id = $4 RETURNING *`, [assignment.driverId, assignment.vehicleId, req.user.id, job.id])).rows[0];
      await client.query("INSERT INTO delivery_dispatch_attempts (delivery_job_id, source, driver_user_id, vehicle_id, action, actor_user_id) VALUES ($1,'internal',$2,$3,'assigned',$4)", [job.id, assignment.driverId, assignment.vehicleId, req.user.id]);
      await activity(client, job.id, req.user.id, 'delivery_coordinated');
      return { success: true, job: updated };
    }),
    releaseMarketplace: (req) => run(req, { action: 'releaseMarketplace', access: 'operator' }, async ({ client, job, activity }) => {
      const reason = cleanText(req.body?.reason, 1000);
      if (reason.length < 3) throw fail('An explicit release reason is required', 'delivery_release_reason_required', 400);
      if (!['posted', 'assigned'].includes(job.status) || pickedUp(job) || job.helper_user_id) throw fail('Delivery cannot be released', 'delivery_release_conflict');
      await ensureNoOpenRecovery(client, job);
      if (job.status === 'posted' && job.dispatch_state === 'marketplace_posted' && job.fulfillment_source === 'marketplace' && !job.internal_driver_user_id && !job.vehicle_id) return { success: true, duplicate: true, job };
      if (!['internal_review', 'internal_assignment_attempt', 'internal_assigned', 'exception'].includes(job.dispatch_state)) throw fail('Delivery cannot be released', 'delivery_release_conflict');
      await lockResources(client, assignmentOf(job));
      // Stop any prior tracking session (release to marketplace).
      await client.query(
        `UPDATE delivery_tracking_assignments SET status = 'revoked', ended_at = NOW(), ended_reason = 'released', updated_at = NOW()
         WHERE delivery_job_id = $1 AND status IN ('active', 'paused')`,
        [job.id]
      );
      await client.query("UPDATE delivery_assignment_reservations SET status = 'released' WHERE delivery_job_id = $1 AND status = 'active'", [job.id]);
      const updated = (await client.query(`UPDATE delivery_jobs SET fulfillment_source = 'marketplace', dispatch_state = 'marketplace_posted', status = 'posted',
        helper_user_id = NULL, internal_driver_user_id = NULL, vehicle_id = NULL, assigned_by_user_id = NULL, assigned_at = NULL, internal_assigned_at = NULL,
        marketplace_released_at = NOW(), marketplace_release_reason = $1, marketplace_released_by_user_id = $2, updated_at = NOW() WHERE id = $3 RETURNING *`, [reason, req.user.id, job.id])).rows[0];
      await client.query("INSERT INTO delivery_dispatch_attempts (delivery_job_id, source, action, reason, actor_user_id) VALUES ($1,'marketplace','released',$2,$3)", [job.id, reason, req.user.id]);
      await activity(client, job.id, req.user.id, 'delivery_marketplace_released', { reason }, false);
      return { success: true, job: updated };
    }),
    claim: (req) => run(req, { action: 'claim', access: 'helper', persistFailure: true }, async ({ client, job, activity, now }) => {
      if (sameId(job.customer_user_id, req.user.id)) throw fail('Customers cannot claim their own delivery', 'delivery_self_claim', 403);
      if (job.status !== 'posted' || pickedUp(job) || job.dispatch_state !== 'marketplace_posted' || job.fulfillment_source !== 'marketplace'
        || job.helper_user_id || job.internal_driver_user_id || job.vehicle_id) throw fail('Delivery is no longer available', 'delivery_unavailable');
      // Payment gate: cannot claim an unpaid job (unless COD).
      const { rows: payments } = await client.query(
        `SELECT captured_at, status FROM delivery_payments WHERE delivery_job_id=$1 AND delivery_extra_id IS NULL ORDER BY created_at DESC LIMIT 1`,
        [job.id]
      );
      const payment = payments[0];
      const isCod = job.metadata?.payment_mode === 'cod' || job.metadata?.paymentMode === 'cod';
      if (!isCod && (!payment || (!payment.captured_at && payment.status !== 'paid'))) {
        throw fail('Delivery cannot be claimed until payment is captured', 'delivery_unpaid', 409);
      }
      await ensureNoOpenRecovery(client, job);
      const assignment = { driverId: req.user.id, vehicleId: null };
      await lockResources(client, assignment);
      const window = windowForJob(job, now);
      await checkAssignment(client, job, assignment, window);
      await reserve(client, job, assignment, window);
      const updated = (await client.query("UPDATE delivery_jobs SET helper_user_id = $1, status = 'assigned', dispatch_state = 'assigned', assigned_at = NOW(), updated_at = NOW() WHERE id = $2 RETURNING *", [req.user.id, job.id])).rows[0];
      await client.query("INSERT INTO delivery_dispatch_attempts (delivery_job_id, source, driver_user_id, action, actor_user_id) VALUES ($1,'marketplace',$2,'claimed',$2)", [job.id, req.user.id]);
      await activity(client, job.id, req.user.id, 'delivery_assigned');
      return { success: true, job: updated };
    }),
  };
  return { actions, ...Object.fromEntries(Object.entries(actions).map(([name, operation]) => [name, handler(operation)])) };
}

let defaults;
module.exports = {
  createDispatchService, createActionRunner, handler, fingerprint, capabilityFailures, areaCovers, availableDuring,
  windowForJob, lockResources, assignmentOf, reserve, checkAssignment, recordActivity, ensureNoOpenRecovery,
  TERMINAL, fail, sameId, isOperator, isParticipant, pickedUp, cleanText,
  ...Object.fromEntries(['assignInternal', 'releaseMarketplace', 'claim'].map((name) => [name, (...args) => {
    defaults ||= createDispatchService();
    return defaults[name](...args);
  }])),
};
