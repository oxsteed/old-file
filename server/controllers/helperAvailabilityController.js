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
  const h = Math.floor(mins / 60);
  const m = mins % 60;
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
// GET /api/helper-profile/availability/overrides
// ─────────────────────────────────────────────────────────────────
exports.getOverrides = async (req, res, next) => {
  try {
    const { from, to } = req.query;
    const conditions = ['helper_id = $1'];
    const params = [req.user.id];

    if (from) { params.push(from); conditions.push(`override_date >= $${params.length}`); }
    if (to)   { params.push(to);   conditions.push(`override_date <= $${params.length}`); }

    const { rows } = await pool.query(
      `SELECT * FROM helper_availability_overrides
        WHERE ${conditions.join(' AND ')}
        ORDER BY override_date`,
      params
    );
    res.json({ overrides: rows });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────
// POST /api/helper-profile/availability/overrides
// Body: { override_date, is_blocked, start_time?, end_time?, reason? }
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
    const { rows: [row] } = await pool.query(
      `INSERT INTO helper_availability_overrides
         (helper_id, override_date, is_blocked, start_time, end_time, reason)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [helperId, override_date, is_blocked, start_time, end_time, reason]
    );
    res.status(201).json(row);
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
      'DELETE FROM helper_availability_overrides WHERE id = $1 AND helper_id = $2 RETURNING id',
      [id, helperId]
    );
    if (!rows.length) return next(new AppError('Override not found', 404, 'not_found'));
    res.json({ deleted: true, id: rows[0].id });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────
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
    // 1. Weekly template
    const { rows: templateRows } = await pool.query(
      `SELECT day_of_week,
              EXTRACT(HOUR FROM start_time)::int * 60 + EXTRACT(MINUTE FROM start_time)::int AS start_min,
              EXTRACT(HOUR FROM end_time)::int   * 60 + EXTRACT(MINUTE FROM end_time)::int   AS end_min
         FROM helper_availability
        WHERE helper_id = $1 AND is_active = TRUE
        ORDER BY day_of_week, start_min`,
      [helperId]
    );

    // If no template is set, return empty (helper hasn't configured availability)
    if (templateRows.length === 0) {
      return res.json({ slots: [], hasTemplate: false });
    }

    // Group template by day_of_week
    const templateByDay = {};
    for (const r of templateRows) {
      if (!templateByDay[r.day_of_week]) templateByDay[r.day_of_week] = [];
      templateByDay[r.day_of_week].push({ start: r.start_min, end: r.end_min });
    }

    // 2. Overrides in range (is_blocked entries)
    const fromStr = fromDate.toISOString().split('T')[0];
    const toStr   = toDate.toISOString().split('T')[0];
    const { rows: overrides } = await pool.query(
      `SELECT override_date::text AS date, is_blocked,
              COALESCE(EXTRACT(HOUR FROM start_time)::int * 60 + EXTRACT(MINUTE FROM start_time)::int, 0)   AS start_min,
              COALESCE(EXTRACT(HOUR FROM end_time)::int   * 60 + EXTRACT(MINUTE FROM end_time)::int,   1440) AS end_min
         FROM helper_availability_overrides
        WHERE helper_id = $1 AND override_date BETWEEN $2 AND $3`,
      [helperId, fromStr, toStr]
    );

    // Group overrides by date
    const blocksByDate = {};
    for (const o of overrides) {
      if (!o.is_blocked) continue; // Extra openings not yet needed for subtraction
      if (!blocksByDate[o.date]) blocksByDate[o.date] = [];
      blocksByDate[o.date].push({ start: o.start_min, end: o.end_min });
    }

    // 3. Existing confirmed / in_progress appointments
    const { rows: appts } = await pool.query(
      `SELECT scheduled_start_time, scheduled_end_time
         FROM appointments
        WHERE helper_id = $1
          AND status IN ('requested', 'confirmed', 'in_progress')
          AND scheduled_start_time >= $2
          AND scheduled_end_time   <= $3`,
      [helperId, fromDate, toDate]
    );

    // Group appointment busy ranges by date string
    const apptsByDate = {};
    for (const a of appts) {
      const start = new Date(a.scheduled_start_time);
      const end   = new Date(a.scheduled_end_time);
      const dateKey = start.toISOString().split('T')[0];
      if (!apptsByDate[dateKey]) apptsByDate[dateKey] = [];
      apptsByDate[dateKey].push({
        start: start.getHours() * 60 + start.getMinutes(),
        end:   end.getHours()   * 60 + end.getMinutes(),
      });
    }

    // 4. Build slot list
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const slots = [];
    const SLOT_DURATION = 60; // minutes

    let cursor = new Date(fromDate);
    cursor.setHours(0, 0, 0, 0);

    while (cursor <= toDate) {
      const dateKey = cursor.toISOString().split('T')[0];
      const dow = cursor.getDay(); // 0=Sun
      const isToday = cursor.toDateString() === now.toDateString();

      const dayWindows = templateByDay[dow] || [];
      const dayBlocks  = (blocksByDate[dateKey] || []).concat(apptsByDate[dateKey] || []);

      for (const window of dayWindows) {
        // Generate 60-min slots from window.start to window.end
        let slotStart = window.start;
        while (slotStart + SLOT_DURATION <= window.end) {
          const slotEnd = slotStart + SLOT_DURATION;

          // Skip past slots
          if (isToday && slotStart <= nowMinutes) {
            slotStart += SLOT_DURATION;
            continue;
          }

          // Subtract blocked/busy ranges
          const isBusy = dayBlocks.some(b => b.start < slotEnd && b.end > slotStart);
          if (!isBusy) {
            slots.push({
              date: dateKey,
              start: fromMinutes(slotStart),
              end:   fromMinutes(slotEnd),
              startIso: `${dateKey}T${fromMinutes(slotStart)}:00`,
              endIso:   `${dateKey}T${fromMinutes(slotEnd)}:00`,
            });
          }

          slotStart += SLOT_DURATION;
        }
      }

      cursor.setDate(cursor.getDate() + 1);
    }

    res.json({ slots, hasTemplate: true, count: slots.length });
  } catch (err) {
    next(err);
  }
};
