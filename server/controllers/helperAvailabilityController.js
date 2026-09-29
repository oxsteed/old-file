// server/controllers/helperAvailabilityController.js
//
// Manages the helper's WEEKLY AVAILABILITY TEMPLATE (migration 168):
//   • helper_availability       — recurring day-of-week windows
//   • helper_availability_overrides — per-date exceptions (blocked / extra opening)
//
// Also exposes the public GET /api/helpers/:helperId/available-slots endpoint
// which computes free 60-minute windows over a date range for the
// BidAcceptanceModal calendar picker.
//
// Separate from availabilityController.js which handles one-off
// availability_blocks with absolute timestamps.

const pool   = require('../db');
const logger = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const availabilityService = require('../services/helperAvailabilityService');

const DAYS = [0, 1, 2, 3, 4, 5, 6]; // Sun=0 … Sat=6
const HHMM = /^\d{2}:\d{2}$/;

function isUuid(v) {
  return typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function fromMinutes(mins) {
  const safe = Math.max(0, Math.min(1440, mins));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ─────────────────────────────────────────────────────────────────
// GET /api/helper-profile/availability/template
// ─────────────────────────────────────────────────────────────────
exports.getTemplate = async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, day_of_week, start_time, end_time, is_active
         FROM helper_availability
        WHERE helper_id = $1
        ORDER BY day_of_week, start_time`,
      [req.user.id]
    );
    res.json({ template: rows });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────
// PUT /api/helper-profile/availability/template
// Body: { slots: [{ day_of_week, start_time, end_time }] }
// Full-replace: delete all existing slots then insert the new set.
// ─────────────────────────────────────────────────────────────────
exports.setTemplate = async (req, res, next) => {
  const helperId = req.user.id;
  const { slots } = req.body || {};

  if (!Array.isArray(slots)) {
    return next(new AppError('slots must be an array', 400, 'validation_failed', {
      slots: 'Required array of { day_of_week, start_time, end_time }',
    }));
  }

  // Validate each slot
  const errors = {};
  slots.forEach((s, i) => {
    if (!DAYS.includes(s.day_of_week)) errors[`slots[${i}].day_of_week`] = 'Must be 0–6';
    if (!HHMM.test(s.start_time))     errors[`slots[${i}].start_time`] = 'Must be HH:MM';
    if (!HHMM.test(s.end_time))       errors[`slots[${i}].end_time`]   = 'Must be HH:MM';
    if (s.start_time >= s.end_time)   errors[`slots[${i}]`] = 'end_time must be after start_time';
  });
  if (Object.keys(errors).length) {
    return next(new AppError('Validation failed', 400, 'validation_failed', errors));
  }

  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'DELETE FROM helper_availability WHERE helper_id = $1',
        [helperId]
      );
      if (slots.length > 0) {
        const valuesClause = slots.map((_, i) => {
          const base = i * 4;
          return `($1, $${base + 2}, $${base + 3}, $${base + 4}, TRUE)`;
        }).join(', ');
        const params = [helperId];
        slots.forEach(s => {
          params.push(s.day_of_week, s.start_time, s.end_time);
        });
        await client.query(
          `INSERT INTO helper_availability (helper_id, day_of_week, start_time, end_time, is_active)
           VALUES ${valuesClause}
           ON CONFLICT (helper_id, day_of_week, start_time, end_time) DO NOTHING`,
          params
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const { rows } = await pool.query(
      `SELECT id, day_of_week, start_time, end_time, is_active
         FROM helper_availability WHERE helper_id = $1
        ORDER BY day_of_week, start_time`,
      [helperId]
    );
    logger.info('Helper availability template updated', { helperId, slotCount: slots.length });
    res.json({ template: rows });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────
// GET /api/helper-profile/availability/overrides
//
// Backed by availability_blocks (the ONE dated-exceptions store). Mapped to
// the historical override shape so existing clients keep working.
// ─────────────────────────────────────────────────────────────────
function blockToOverride(b) {
  const start = new Date(b.start_time);
  const end = new Date(b.end_time);
  const pad = (n) => String(n).padStart(2, '0');
  const fullDay =
    start.getUTCHours() === 0 && start.getUTCMinutes() === 0 &&
    end.getUTCHours() === 0 && end.getUTCMinutes() === 0;
  return {
    id: b.id,
    helper_id: b.helper_id,
    override_date: start.toISOString().split('T')[0],
    is_blocked: b.type !== 'available',
    start_time: fullDay ? null : `${pad(start.getUTCHours())}:${pad(start.getUTCMinutes())}`,
    end_time: fullDay ? null : `${pad(end.getUTCHours())}:${pad(end.getUTCMinutes())}`,
    reason: b.title || b.notes || null,
    type: b.type,
  };
}

exports.getOverrides = async (req, res, next) => {
  try {
    const { from, to } = req.query;
    const conditions = ['helper_id = $1'];
    const params = [req.user.id];

    if (from) { params.push(from); conditions.push(`start_time >= $${params.length}::date`); }
    if (to)   { params.push(to);   conditions.push(`start_time < ($${params.length}::date + INTERVAL '1 day')`); }

    const { rows } = await pool.query(
      `SELECT id, helper_id, start_time, end_time, type, title, notes
         FROM availability_blocks
        WHERE ${conditions.join(' AND ')}
        ORDER BY start_time`,
      params
    );
    res.json({ overrides: rows.map(blockToOverride) });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────
// POST /api/helper-profile/availability/overrides
// Body: { override_date, is_blocked, start_time?, end_time?, reason? }
//
// Writes an availability_blocks row (the ONE exceptions store).
// ─────────────────────────────────────────────────────────────────
exports.createOverride = async (req, res, next) => {
  const helperId = req.user.id;
  const { override_date, is_blocked = true, start_time = null, end_time = null, reason = null } = req.body || {};

  if (!override_date || !/^\d{4}-\d{2}-\d{2}$/.test(override_date)) {
    return next(new AppError('override_date must be YYYY-MM-DD', 400, 'validation_failed', {
      override_date: 'Required, format YYYY-MM-DD',
    }));
  }
  if (start_time && !HHMM.test(start_time)) {
    return next(new AppError('start_time must be HH:MM', 400, 'validation_failed', { start_time: 'Must be HH:MM' }));
  }
  if (end_time && !HHMM.test(end_time)) {
    return next(new AppError('end_time must be HH:MM', 400, 'validation_failed', { end_time: 'Must be HH:MM' }));
  }

  try {
    const startTs = `${override_date}T${start_time || '00:00'}:00Z`;
    const endTs = end_time
      ? `${override_date}T${end_time}:00Z`
      : `${override_date}T00:00:00Z`;
    // Full-day block when no times given: end is the next midnight.
    const endIso = !start_time && !end_time
      ? new Date(new Date(`${override_date}T00:00:00Z`).getTime() + 86_400_000).toISOString()
      : new Date(endTs).toISOString();
    if (!(new Date(endIso) > new Date(startTs))) {
      return next(new AppError('end_time must be after start_time', 400, 'validation_failed', {
        end_time: 'Must be after start_time',
      }));
    }

    const { rows: [row] } = await pool.query(
      `INSERT INTO availability_blocks
         (helper_id, start_time, end_time, type, title, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, helper_id, start_time, end_time, type, title, notes`,
      [helperId, new Date(startTs).toISOString(), endIso, is_blocked ? 'unavailable' : 'available', reason, reason]
    );
    res.status(201).json(blockToOverride(row));
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────
// DELETE /api/helper-profile/availability/overrides/:id
// ─────────────────────────────────────────────────────────────────
exports.deleteOverride = async (req, res, next) => {
  const { id } = req.params;
  const helperId = req.user.id;
  try {
    const { rows } = await pool.query(
      'DELETE FROM availability_blocks WHERE id = $1 AND helper_id = $2 RETURNING id',
      [id, helperId]
    );
    if (!rows.length) return next(new AppError('Override not found', 404, 'not_found'));
    res.json({ deleted: true, id: rows[0].id });
  } catch (err) {
    next(err);
  }
};

// GET /api/helpers/:helperId/available-slots?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Returns available 60-minute windows for the next N days (max 28).
// Algorithm:
//   1. Load weekly template slots for this helper.
//   2. For each date in [from, to], expand template slots into free windows.
//   3. Subtract any is_blocked overrides for that date.
//   4. Subtract existing confirmed/in-progress appointments.
//   5. Return non-past slots that are at least 60 minutes long, split into
//      60-minute increments.
// ─────────────────────────────────────────────────────────────────
exports.getAvailableSlots = async (req, res, next) => {
  const { helperId } = req.params;
  if (!isUuid(helperId)) {
    return next(new AppError('Invalid helper ID', 400, 'validation_failed', { helperId: 'Must be a UUID' }));
  }

  let fromDate = req.query.from ? new Date(req.query.from + 'T00:00:00') : new Date();
  let toDate   = req.query.to   ? new Date(req.query.to   + 'T23:59:59') : null;

  // Clamp to max 28 days
  const maxDays = 28;
  if (!toDate || (toDate - fromDate) / 86_400_000 > maxDays) {
    toDate = new Date(fromDate);
    toDate.setDate(toDate.getDate() + maxDays);
  }

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    return next(new AppError('Invalid date range', 400, 'validation_failed', { from: 'Must be YYYY-MM-DD', to: 'Must be YYYY-MM-DD' }));
  }

  try {
    // Single-system computation: weekly template − dated blocks − appointments.
    // Anchored in the helper's timezone so "today" and block dates follow the
    // helper's wall clock, not the server's.
    const helperTimeZone = await availabilityService.getHelperTimeZone(pool, helperId);
    const pad = (n) => String(n).padStart(2, '0');
    const hhmm = (mins) => `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;

    const fromISO = fromDate.toISOString().split('T')[0];
    const toISO = toDate.toISOString().split('T')[0];
    const { days, hasTemplate, bookingBufferMinutes } =
      await availabilityService.computeAvailability(helperId, fromISO, toISO, pool, helperTimeZone);

    if (!hasTemplate) {
      return res.json({ slots: [], hasTemplate: false });
    }

    const now = new Date();
    const todayISO = availabilityService.zonedDateStr(now, helperTimeZone);
    const nowMinutes = availabilityService.zonedNowMinutes(now, helperTimeZone);
    const SLOT_DURATION = 60;
    const slots = [];

    for (const day of days) {
      if (day.status !== 'available' && day.status !== 'limited') continue;
      // Grid 60-min slots on the template/opening windows; drop any slot
      // that touches a busy range (blocks, appointments + buffer).
      for (const w of day.slotGrid) {
        let slotStart = w.startMin;
        while (slotStart + SLOT_DURATION <= w.endMin) {
          const slotEnd = slotStart + SLOT_DURATION;
          // Skip past slots today (plus the helper's booking buffer: a slot
          // starting inside the buffer cannot be booked).
          if (day.date === todayISO && slotStart <= nowMinutes + bookingBufferMinutes) {
            slotStart += SLOT_DURATION;
            continue;
          }
          const overlapsBusy = day.busy.some((b) => b.startMin < slotEnd && b.endMin > slotStart);
          if (!overlapsBusy) {
            slots.push({
              date: day.date,
              start: hhmm(slotStart),
              end: hhmm(slotEnd),
              startIso: `${day.date}T${hhmm(slotStart)}:00`,
              endIso: `${day.date}T${hhmm(slotEnd)}:00`,
            });
          }
          slotStart += SLOT_DURATION;
        }
      }
    }

    res.json({ slots, hasTemplate: true, count: slots.length, bookingBufferMinutes });
  } catch (err) {
    next(err);
  }
};
