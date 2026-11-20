// server/services/deliveryJobStopsService.js
// Group 9 Slice C (item 462): the multi-stop sequence for a delivery job.
//
// The schema was exactly one origin + one destination; delivery_job_stops
// (migration 20261120120000) records the ordered stops. A job with no
// stop rows (created before the migration, or inserted directly) reads as
// its two legacy stops — origin pickup, destination dropoff — so the
// single origin/destination shape keeps working unchanged. Pricing and
// ETA stay whole-job: stops are the driver's working sequence, never a
// pricing input, and completing a stop never changes the job status,
// payout, or proof requirements (D-67).
//
// Group 9 Slice C (item 463) reuses the same stops for time-window
// warnings: each pending stop carries its own window, and the sweep in
// deliveryWindowWarningService warns the assigned driver when a window
// is closing or has passed without the stop completing.
'use strict';

const { roundCoord } = require('./localDeliveryIntegrity');
const AppError = require('../utils/appError');

// Group 9 Slice C (item 463, D-69): a window is "closing" when its end is
// within this many minutes. Warn-only: no auto-cancel, no auto-reschedule.
const WINDOW_CLOSING_MINUTES = 60;
const ACTIVE_STATUSES = ['assigned', 'picked_up', 'in_transit'];
const TERMINAL_STATUSES = new Set(['delivered', 'cancelled', 'returned']);

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function text(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function isoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// The two legacy stops for a job with no stop rows: origin pickup first,
// destination dropoff second, with the job's windows and contacts.
// Virtual rows carry id `virtual-pickup` / `virtual-dropoff` so callers
// can tell them apart from stored rows (they cannot be completed or
// reordered until materialized).
function virtualStops(job) {
  const pickedUp = Boolean(job.picked_up_at);
  const delivered = job.status === 'delivered' || job.status === 'returned';
  return [
    {
      id: 'virtual-pickup',
      delivery_job_id: job.id,
      stop_order: 1,
      stop_type: 'pickup',
      address: job.origin_address,
      city: job.origin_city,
      state: job.origin_state,
      country: job.origin_country,
      lat: toNumber(job.origin_lat),
      lng: toNumber(job.origin_lng),
      contact_name: job.origin_contact_name,
      contact_phone: job.origin_contact_phone,
      instructions: job.origin_instructions,
      window_start: job.pickup_window_start,
      window_end: job.pickup_window_end,
      status: delivered || pickedUp ? 'completed' : 'pending',
      completed_at: delivered ? job.delivered_at : pickedUp ? job.picked_up_at : null,
      virtual: true,
    },
    {
      id: 'virtual-dropoff',
      delivery_job_id: job.id,
      stop_order: 2,
      stop_type: 'dropoff',
      address: job.destination_address,
      city: job.destination_city,
      state: job.destination_state,
      country: job.destination_country,
      lat: toNumber(job.destination_lat),
      lng: toNumber(job.destination_lng),
      contact_name: job.destination_contact_name,
      contact_phone: job.destination_contact_phone,
      instructions: job.destination_instructions,
      window_start: job.delivery_window_start,
      window_end: job.delivery_window_end,
      status: delivered ? 'completed' : 'pending',
      completed_at: delivered ? job.delivered_at : null,
      virtual: true,
    },
  ];
}

async function loadJobStops(db, job) {
  const { rows } = await db.query(
    `SELECT * FROM delivery_job_stops WHERE delivery_job_id = $1 ORDER BY stop_order ASC, id ASC`,
    [job.id],
  );
  if (rows.length) return rows;
  return virtualStops(job);
}

// Insert the two legacy stops for a job that has none (the sweep's
// materialization path, and the create path's insert). Idempotent: a
// second call for the same job inserts nothing.
async function ensureJobStops(client, job) {
  const { rows } = await client.query(
    `SELECT id FROM delivery_job_stops WHERE delivery_job_id = $1 LIMIT 1`,
    [job.id],
  );
  if (rows.length) return false;
  const stops = virtualStops(job);
  for (const stop of stops) {
    await client.query(
      `INSERT INTO delivery_job_stops
         (delivery_job_id, stop_order, stop_type, address, city, state, country, lat, lng,
          contact_name, contact_phone, instructions, window_start, window_end, status, completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (delivery_job_id, stop_order) DO NOTHING`,
      [job.id, stop.stop_order, stop.stop_type, stop.address, stop.city, stop.state, stop.country,
        stop.lat, stop.lng, stop.contact_name, stop.contact_phone, stop.instructions,
        stop.window_start, stop.window_end, stop.status, stop.completed_at],
    );
  }
  return true;
}

// A marketplace driver opening a posted offer read-only (D-65) sees the
// stop sequence with rounded coordinates only: enough to plan the route
// and open navigation, not enough to pinpoint the addresses. Exact
// addresses, contacts, and instructions stay participant-only.
function safeStops(job, user, stops) {
  const own = String(job.customer_user_id) === String(user.id);
  const assigned = [job.helper_user_id, job.internal_driver_user_id].some((id) => id && String(id) === String(user.id));
  if (own || assigned) return stops;
  return stops.map((stop) => ({
    id: stop.id,
    delivery_job_id: stop.delivery_job_id,
    stop_order: stop.stop_order,
    stop_type: stop.stop_type,
    city: stop.city,
    state: stop.state,
    lat: roundCoord(stop.lat),
    lng: roundCoord(stop.lng),
    window_start: stop.window_start,
    window_end: stop.window_end,
    status: stop.status,
  }));
}

function normalizeStopInput(body = {}) {
  const stopType = String(body.stopType || '').trim();
  if (!['pickup', 'dropoff'].includes(stopType)) {
    throw new AppError('Stop type must be pickup or dropoff', 400, 'delivery_stop_type_invalid');
  }
  const address = text(body.address, 500);
  if (!address) {
    throw new AppError('Stop address is required', 400, 'delivery_stop_address_required');
  }
  const lat = body.lat === null || body.lat === '' || body.lat === undefined ? null : Number(body.lat);
  const lng = body.lng === null || body.lng === '' || body.lng === undefined ? null : Number(body.lng);
  if ((lat !== null && (!Number.isFinite(lat) || Math.abs(lat) > 90))
    || (lng !== null && (!Number.isFinite(lng) || Math.abs(lng) > 180))) {
    throw new AppError('Stop coordinates are invalid', 400, 'delivery_coordinates_invalid');
  }
  const windowStart = isoOrNull(body.windowStart);
  const windowEnd = isoOrNull(body.windowEnd);
  if (body.windowStart !== undefined && body.windowStart !== null && body.windowStart !== '' && !windowStart) {
    throw new AppError('Stop window start must be a valid date', 400, 'delivery_window_invalid');
  }
  if (body.windowEnd !== undefined && body.windowEnd !== null && body.windowEnd !== '' && !windowEnd) {
    throw new AppError('Stop window end must be a valid date', 400, 'delivery_window_invalid');
  }
  if (windowStart && windowEnd && new Date(windowStart) >= new Date(windowEnd)) {
    throw new AppError('Stop window is invalid', 400, 'delivery_window_invalid');
  }
  return {
    stopType,
    address,
    city: text(body.city, 120) || null,
    state: text(body.state, 120) || null,
    country: text(body.country, 3).toUpperCase() || null,
    lat,
    lng,
    contactName: text(body.contactName, 160) || null,
    contactPhone: text(body.contactPhone, 40) || null,
    instructions: text(body.instructions, 2000) || null,
    windowStart,
    windowEnd,
  };
}

// Current window warnings for a stop list, computed on read (no stamps:
// the sweep owns the once-only notification, this is what the detail page
// shows). A pending stop warns when its window end is within
// WINDOW_CLOSING_MINUTES (closing) or has already passed (expired).
// Completed or skipped stops never warn.
function computeWindowWarnings(stops, now = new Date()) {
  const nowMs = (now instanceof Date ? now : new Date(now)).getTime();
  const warnings = [];
  for (const stop of stops || []) {
    if (stop.status !== 'pending' || !stop.window_end) continue;
    const endMs = Date.parse(stop.window_end);
    if (!Number.isFinite(endMs)) continue;
    const minutesUntilEnd = Math.floor((endMs - nowMs) / 60000);
    if (endMs <= nowMs) {
      warnings.push({
        stopId: stop.id,
        stopOrder: stop.stop_order,
        stopType: stop.stop_type,
        kind: 'expired',
        windowEnd: stop.window_end,
        minutesOverdue: Math.floor((nowMs - endMs) / 60000),
      });
    } else if (endMs - nowMs <= WINDOW_CLOSING_MINUTES * 60000) {
      warnings.push({
        stopId: stop.id,
        stopOrder: stop.stop_order,
        stopType: stop.stop_type,
        kind: 'closing',
        windowEnd: stop.window_end,
        minutesUntilEnd,
      });
    }
  }
  return warnings;
}

module.exports = {
  WINDOW_CLOSING_MINUTES,
  ACTIVE_STATUSES,
  TERMINAL_STATUSES,
  virtualStops,
  loadJobStops,
  ensureJobStops,
  safeStops,
  normalizeStopInput,
  computeWindowWarnings,
};
