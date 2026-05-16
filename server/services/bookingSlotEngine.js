'use strict';

/**
 * server/services/bookingSlotEngine.js
 *
 * Pure (database-reading) function over the business booking schema.
 * Given a service + date range + optional staff filter, returns the
 * availability slots customers can book.
 *
 * Data sources:
 *   business_services             - duration_minutes, max_capacity, min_notice_hours
 *   business_service_staff        - who can perform this service
 *   business_service_availability - weekly recurring windows (per service ± per staff)
 *   business_service_blocked_times- time-bounded exclusions
 *   business_appointments         - existing bookings (taking up capacity)
 *   business_booking_rules        - business-level rules (max_advance_booking_days, etc.)
 *
 * Output shape:
 *   {
 *     service_id, service_duration_minutes, max_capacity,
 *     slots: [{ start, end, staff_id, available_capacity }]
 *   }
 *
 * Notes:
 *  - Times are returned as ISO strings in UTC; the caller renders in business TZ.
 *  - Slots are generated in `service.duration_minutes` increments.
 *  - When a service has no staff_id rows AND no service-wide (staff_id NULL)
 *    availability rows, no slots are produced.
 *  - When a service has staff but a customer doesn't specify staff_id, slots
 *    are unioned across all available staff (each slot keyed by staff_id).
 *  - Cancelled appointments (status='cancelled' or 'no_show') do not consume capacity.
 */

const pool = require('../db');
const logger = require('../utils/logger');

const SLOT_STATUSES_BLOCKING = ['pending', 'confirmed', 'in_progress', 'completed'];

function toIso(d) { return new Date(d).toISOString(); }
function addMinutes(d, m) { return new Date(d.getTime() + m * 60000); }
function startOfDayUtc(d) {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}
function dayOfWeekUtc(d) {
  return new Date(d).getUTCDay();
}
function parseHmsToSeconds(timeStr) {
  // PostgreSQL TIME comes back as 'HH:MM:SS' or 'HH:MM:SS.SSS'
  const m = String(timeStr || '').match(/^(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return 0;
  return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10);
}
function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Get business booking rules. Returns defaults if no row exists.
 */
async function loadBookingRules(businessId) {
  try {
    const { rows } = await pool.query(
      `SELECT min_advance_booking_hours, max_advance_booking_days,
              cancellation_allowed_hours_before, require_payment_upfront
         FROM business_booking_rules
        WHERE business_id = $1
        LIMIT 1`,
      [businessId]
    );
    return rows[0] || {
      min_advance_booking_hours: 0,
      max_advance_booking_days: 365,
      cancellation_allowed_hours_before: 24,
      require_payment_upfront: true,
    };
  } catch (err) {
    logger.warn('loadBookingRules failed; using defaults', { businessId, err: err.message });
    return {
      min_advance_booking_hours: 0,
      max_advance_booking_days: 365,
      cancellation_allowed_hours_before: 24,
      require_payment_upfront: true,
    };
  }
}

/**
 * Main entrypoint.
 *
 * @param {object} args
 * @param {number} args.businessId
 * @param {number} args.serviceId
 * @param {Date|string} args.from   - earliest slot start time (inclusive)
 * @param {Date|string} args.to     - latest slot start time (exclusive)
 * @param {string} [args.staffId]   - filter to one staff member
 * @returns {Promise<object>}
 */
async function computeSlots(args) {
  const businessId = args.businessId;
  const serviceId  = args.serviceId;
  const fromDate   = new Date(args.from);
  const toDate     = new Date(args.to);
  const staffFilter = args.staffId || null;

  if (!businessId || !serviceId) {
    return { error: 'businessId and serviceId required', slots: [] };
  }
  if (!(fromDate instanceof Date) || isNaN(fromDate) || !(toDate instanceof Date) || isNaN(toDate)) {
    return { error: 'from/to must be valid dates', slots: [] };
  }
  if (toDate <= fromDate) return { service_id: serviceId, slots: [] };

  // 1) Service row
  const svcRes = await pool.query(
    `SELECT id, business_id, duration_minutes, preparation_minutes, max_capacity,
            min_notice_hours, is_active, allow_online_booking, deleted_at
       FROM business_services
      WHERE id = $1 AND business_id = $2`,
    [serviceId, businessId]
  );
  const svc = svcRes.rows[0];
  if (!svc || svc.deleted_at || svc.is_active === false) {
    return { error: 'Service not bookable', slots: [] };
  }
  if (!svc.allow_online_booking) {
    return { error: 'Service not available for online booking', slots: [] };
  }
  const duration = Number(svc.duration_minutes);
  const capacity = Math.max(1, Number(svc.max_capacity) || 1);
  if (!Number.isFinite(duration) || duration <= 0) {
    return { error: 'Service has no duration configured', slots: [] };
  }

  // 2) Booking rules
  const rules = await loadBookingRules(businessId);
  const now = new Date();
  const earliest = addMinutes(now, (rules.min_advance_booking_hours || 0) * 60);
  const latest = addMinutes(now, (rules.max_advance_booking_days || 365) * 24 * 60);
  const rangeStart = fromDate < earliest ? earliest : fromDate;
  const rangeEnd   = toDate > latest ? latest : toDate;
  if (rangeEnd <= rangeStart) return { service_id: serviceId, slots: [] };

  // 3) Staff for this service (may be empty -> service-wide availability)
  const staffRes = await pool.query(
    `SELECT staff_id FROM business_service_staff
      WHERE service_id = $1 AND is_available = TRUE
        ${staffFilter ? 'AND staff_id = $2' : ''}`,
    staffFilter ? [serviceId, staffFilter] : [serviceId]
  );
  const staffIds = staffRes.rows.map(r => r.staff_id);
  // If staff filter was given but that staff isn't on the service, return nothing.
  if (staffFilter && !staffIds.length) return { service_id: serviceId, slots: [] };

  // 4) Availability windows (recurring by day_of_week)
  const availRes = await pool.query(
    `SELECT day_of_week, start_time, end_time, staff_id
       FROM business_service_availability
      WHERE service_id = $1 AND is_available = TRUE
        ${staffFilter ? 'AND (staff_id = $2 OR staff_id IS NULL)' : ''}`,
    staffFilter ? [serviceId, staffFilter] : [serviceId]
  );
  if (!availRes.rows.length) return { service_id: serviceId, slots: [] };

  // 5) Blocked time exclusions in range
  const blockedRes = await pool.query(
    `SELECT staff_id, start_time, end_time
       FROM business_service_blocked_times
      WHERE business_id = $1
        AND (service_id = $2 OR service_id IS NULL)
        AND end_time > $3 AND start_time < $4
        ${staffFilter ? 'AND (staff_id = $5 OR staff_id IS NULL)' : ''}`,
    staffFilter
      ? [businessId, serviceId, rangeStart.toISOString(), rangeEnd.toISOString(), staffFilter]
      : [businessId, serviceId, rangeStart.toISOString(), rangeEnd.toISOString()]
  );
  const blocks = blockedRes.rows.map(r => ({
    staff_id: r.staff_id,
    start: new Date(r.start_time),
    end:   new Date(r.end_time),
  }));

  // 6) Existing appointments in range
  const apptRes = await pool.query(
    `SELECT staff_id, start_time, end_time, status
       FROM business_appointments
      WHERE business_id = $1 AND service_id = $2
        AND end_time > $3 AND start_time < $4
        AND status = ANY($5)
        ${staffFilter ? 'AND (staff_id = $6 OR staff_id IS NULL)' : ''}`,
    staffFilter
      ? [businessId, serviceId, rangeStart.toISOString(), rangeEnd.toISOString(), SLOT_STATUSES_BLOCKING, staffFilter]
      : [businessId, serviceId, rangeStart.toISOString(), rangeEnd.toISOString(), SLOT_STATUSES_BLOCKING]
  );
  const appointments = apptRes.rows.map(r => ({
    staff_id: r.staff_id,
    start: new Date(r.start_time),
    end:   new Date(r.end_time),
  }));

  // Pick which "actors" we'll generate slots for.
  // If service has staff: per-staff slots.
  // Else: service-wide slots (staff_id = null).
  const actors = staffIds.length ? staffIds : [null];

  function blockedFor(staffId, slotStart, slotEnd) {
    for (const b of blocks) {
      // Block applies if staff matches OR block.staff_id is null (service-wide block)
      if (b.staff_id && staffId && b.staff_id !== staffId) continue;
      if (overlaps(slotStart, slotEnd, b.start, b.end)) return true;
    }
    return false;
  }
  function consumedCapacity(staffId, slotStart, slotEnd) {
    let n = 0;
    for (const a of appointments) {
      // Appointment consumes capacity if same staff (or staff_id NULL on a service-wide booking)
      if (staffId && a.staff_id && a.staff_id !== staffId) continue;
      if (overlaps(slotStart, slotEnd, a.start, a.end)) n++;
    }
    return n;
  }

  // Pre-bucket availability windows by (actor, day_of_week)
  const availByActorDay = new Map(); // key: `${actor||'_'}|${dow}` -> [{startSec, endSec}]
  for (const row of availRes.rows) {
    const actorKeys = [];
    if (row.staff_id) actorKeys.push(row.staff_id);
    else actorKeys.push(null);
    for (const ak of actorKeys) {
      const k = `${ak == null ? '_' : ak}|${row.day_of_week}`;
      if (!availByActorDay.has(k)) availByActorDay.set(k, []);
      availByActorDay.get(k).push({
        startSec: parseHmsToSeconds(row.start_time),
        endSec:   parseHmsToSeconds(row.end_time),
      });
    }
  }

  // 7) Generate slots day-by-day for each actor
  const slots = [];
  for (let day = startOfDayUtc(rangeStart); day < rangeEnd; day = addMinutes(day, 24 * 60)) {
    const dow = dayOfWeekUtc(day);
    for (const actor of actors) {
      const keyExact = `${actor == null ? '_' : actor}|${dow}`;
      const keyWide  = `_|${dow}`;
      const windows = (availByActorDay.get(keyExact) || []).concat(
        actor != null ? (availByActorDay.get(keyWide) || []) : []
      );
      if (!windows.length) continue;
      for (const w of windows) {
        for (let sec = w.startSec; sec + duration * 60 <= w.endSec; sec += duration * 60) {
          const slotStart = new Date(day.getTime() + sec * 1000);
          const slotEnd   = addMinutes(slotStart, duration);
          if (slotStart < rangeStart) continue;
          if (slotEnd > rangeEnd) break;
          if (blockedFor(actor, slotStart, slotEnd)) continue;
          const taken = consumedCapacity(actor, slotStart, slotEnd);
          if (taken >= capacity) continue;
          slots.push({
            start: toIso(slotStart),
            end:   toIso(slotEnd),
            staff_id: actor,
            available_capacity: capacity - taken,
          });
        }
      }
    }
  }

  slots.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));

  return {
    service_id: serviceId,
    service_duration_minutes: duration,
    max_capacity: capacity,
    rules: {
      min_advance_booking_hours: rules.min_advance_booking_hours,
      max_advance_booking_days:  rules.max_advance_booking_days,
    },
    slots,
  };
}

/**
 * Returns appointments union availability blocks for a business in a date range,
 * for use by the business workspace calendar view.
 */
async function getBusinessCalendar(businessId, fromIso, toIso) {
  const [appts, blocks] = await Promise.all([
    pool.query(
      `SELECT a.id, a.service_id, a.staff_id, a.customer_id,
              a.customer_name, a.customer_email, a.status,
              a.start_time, a.end_time, a.payment_status,
              s.name AS service_name
         FROM business_appointments a
         LEFT JOIN business_services s ON s.id = a.service_id
        WHERE a.business_id = $1
          AND a.end_time > $2 AND a.start_time < $3`,
      [businessId, fromIso, toIso]
    ),
    pool.query(
      `SELECT id, service_id, staff_id, start_time, end_time, reason
         FROM business_service_blocked_times
        WHERE business_id = $1
          AND end_time > $2 AND start_time < $3`,
      [businessId, fromIso, toIso]
    ),
  ]);
  return {
    appointments: appts.rows,
    blocks: blocks.rows,
  };
}

module.exports = { computeSlots, getBusinessCalendar, loadBookingRules };
