// server/controllers/businessCalendarController.js
//
// Per-business calendar:
//   * Internal events (business_events): team meetings, deliveries, vehicle
//     maintenance, training, holidays, etc.
//   * Customer-facing appointments (appointments) that have been associated
//     with a business via appointments.business_id are joined into the same
//     feed so a single calendar shows everything happening on the business.
//
// Access control:
//   * Read access  - owners, managers, and active representatives
//   * Write access - owners and managers only

const pool   = require('../db');
const logger = require('../utils/logger');
const { sendError, sendSuccess } = require('../utils/apiError');
const {
  canAccessBusinessTeam,
  canManageBusinessFinance,
} = require('../utils/businessOwnership');

const VALID_CATEGORIES = new Set([
  'team_meeting',
  'delivery',
  'supplier_visit',
  'vehicle_maintenance',
  'training',
  'marketing',
  'inspection',
  'site_visit',
  'admin',
  'holiday',
  'time_off',
  'other',
]);

const VALID_STATUS = new Set(['scheduled', 'completed', 'cancelled']);
const VALID_RECURRENCE = new Set(['none', 'daily', 'weekly', 'biweekly', 'monthly']);

const MAX_TITLE_LEN = 200;
const MAX_DESC_LEN = 4000;
const MAX_LOCATION_LEN = 255;

function parseDateOr(value, fallback) {
  if (!value) return fallback;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return fallback;
  return d;
}

function defaultRange() {
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - 7);
  const to = new Date(now);
  to.setDate(to.getDate() + 60);
  return { from, to };
}

/* ---------------------------------------------------------------------------
 * GET /api/businesses/:id/calendar
 * Combined feed: business_events + appointments tied to this business.
 * Query params: from, to (ISO dates), category, status, assignee_id
 * ------------------------------------------------------------------------- */
exports.listBusinessCalendar = async (req, res) => {
  try {
    const { id: bizId } = req.params;
    const access = await canAccessBusinessTeam(req.user.id, bizId);
    if (!access) return sendError(res, 403, 'Access denied', 'forbidden');

    const { from: defFrom, to: defTo } = defaultRange();
    const from = parseDateOr(req.query.from, defFrom);
    const to   = parseDateOr(req.query.to,   defTo);
    const { category, status, assignee_id } = req.query;

    const params = [bizId, from.toISOString(), to.toISOString()];
    let where = `business_id = $1 AND starts_at < $3 AND ends_at > $2 AND deleted_at IS NULL`;
    if (category && VALID_CATEGORIES.has(category)) {
      params.push(category);
      where += ` AND category = $${params.length}`;
    }
    if (status && VALID_STATUS.has(status)) {
      params.push(status);
      where += ` AND status = $${params.length}`;
    }
    if (assignee_id) {
      params.push(assignee_id);
      where += ` AND assignee_id = $${params.length}`;
    }

    const eventsQ = `
      SELECT id, business_id, created_by, assignee_id, category, title, description,
             location, starts_at, ends_at, all_day, color, status, remind_minutes,
             recurrence, related_job_id, related_invoice_id, related_appointment_id,
             created_at, updated_at
      FROM business_events
      WHERE ${where}
      ORDER BY starts_at ASC
      LIMIT 500
    `;

    const apptsQ = `
      SELECT a.id, a.business_id, a.customer_id, a.helper_id, a.job_id,
             a.status, a.scheduled_start_time AS starts_at, a.scheduled_end_time AS ends_at,
             a.service_description AS title, a.location_address AS location,
             cu.first_name AS customer_first_name, cu.last_name AS customer_last_name,
             h.first_name  AS helper_first_name,   h.last_name  AS helper_last_name,
             j.title        AS job_title
      FROM appointments a
      LEFT JOIN users cu ON cu.id = a.customer_id
      LEFT JOIN users h  ON h.id  = a.helper_id
      LEFT JOIN jobs j   ON j.id  = a.job_id
      WHERE a.business_id = $1
        AND a.scheduled_start_time < $3
        AND a.scheduled_end_time   > $2
        AND a.status NOT IN ('cancelled', 'declined', 'expired')
      ORDER BY a.scheduled_start_time ASC
      LIMIT 500
    `;

    const [evRes, apRes] = await Promise.all([
      pool.query(eventsQ, params),
      pool.query(apptsQ, [bizId, from.toISOString(), to.toISOString()]),
    ]);

    const events = evRes.rows.map((r) => ({
      kind: 'event',
      id: `evt_${r.id}`,
      raw_id: Number(r.id),
      business_id: r.business_id,
      category: r.category,
      title: r.title,
      description: r.description,
      location: r.location,
      starts_at: r.starts_at,
      ends_at: r.ends_at,
      all_day: r.all_day,
      color: r.color,
      status: r.status,
      assignee_id: r.assignee_id,
      created_by: r.created_by,
      remind_minutes: r.remind_minutes,
      recurrence: r.recurrence,
      related_job_id: r.related_job_id,
      related_invoice_id: r.related_invoice_id,
      related_appointment_id: r.related_appointment_id,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));

    const appts = apRes.rows.map((r) => {
      const customerName = [r.customer_first_name, r.customer_last_name].filter(Boolean).join(' ');
      return {
        kind: 'appointment',
        id: `apt_${r.id}`,
        raw_id: Number(r.id),
        business_id: r.business_id,
        category: 'appointment',
        title: r.title || r.job_title || (customerName ? `Appointment - ${customerName}` : 'Customer appointment'),
        description: null,
        location: r.location,
        starts_at: r.starts_at,
        ends_at: r.ends_at,
        all_day: false,
        color: null,
        status: r.status,
        customer_id: r.customer_id,
        customer_name: customerName,
        helper_id: r.helper_id,
        helper_name: [r.helper_first_name, r.helper_last_name].filter(Boolean).join(' '),
        job_id: r.job_id,
        job_title: r.job_title,
      };
    });

    sendSuccess(res, {
      from: from.toISOString(),
      to:   to.toISOString(),
      events,
      appointments: appts,
    });
  } catch (err) {
    logger.error('listBusinessCalendar failed', { error: err.message, stack: err.stack });
    sendError(res, 500, 'Failed to load calendar', 'calendar_load_failed');
  }
};

/* ---------------------------------------------------------------------------
 * GET /api/businesses/:id/calendar/summary
 * Quick counts for the Overview tab (today / this week).
 * ------------------------------------------------------------------------- */
exports.getBusinessCalendarSummary = async (req, res) => {
  try {
    const { id: bizId } = req.params;
    const access = await canAccessBusinessTeam(req.user.id, bizId);
    if (!access) return sendError(res, 403, 'Access denied', 'forbidden');

    const summaryQ = `
      WITH ev AS (
        SELECT starts_at, ends_at, status
        FROM business_events
        WHERE business_id = $1 AND deleted_at IS NULL
      ),
      ap AS (
        SELECT scheduled_start_time AS starts_at, scheduled_end_time AS ends_at, status
        FROM appointments
        WHERE business_id = $1
          AND status NOT IN ('cancelled', 'declined', 'expired')
      ),
      combined AS (
        SELECT * FROM ev
        UNION ALL
        SELECT * FROM ap
      )
      SELECT
        COUNT(*) FILTER (WHERE starts_at::date = CURRENT_DATE) AS today_count,
        COUNT(*) FILTER (WHERE starts_at >= date_trunc('week', NOW())
                          AND starts_at <  date_trunc('week', NOW()) + INTERVAL '7 days') AS this_week_count,
        COUNT(*) FILTER (WHERE starts_at >= NOW()
                          AND starts_at <  NOW() + INTERVAL '24 hours') AS next_24h_count,
        MIN(starts_at) FILTER (WHERE starts_at >= NOW()) AS next_event_at
      FROM combined
    `;
    const { rows } = await pool.query(summaryQ, [bizId]);
    const r = rows[0] || {};
    sendSuccess(res, {
      today_count: Number(r.today_count || 0),
      this_week_count: Number(r.this_week_count || 0),
      next_24h_count: Number(r.next_24h_count || 0),
      next_event_at: r.next_event_at || null,
    });
  } catch (err) {
    logger.error('getBusinessCalendarSummary failed', { error: err.message });
    sendError(res, 500, 'Failed to load calendar summary', 'calendar_summary_failed');
  }
};

/* ---------------------------------------------------------------------------
 * POST /api/businesses/:id/calendar/events
 * ------------------------------------------------------------------------- */
exports.createBusinessEvent = async (req, res) => {
  try {
    const { id: bizId } = req.params;
    const access = await canManageBusinessFinance(req.user.id, bizId);
    if (!access) return sendError(res, 403, 'Access denied', 'forbidden');

    const {
      title, description, location, category = 'other',
      starts_at, ends_at, all_day = false, color,
      status = 'scheduled', remind_minutes, recurrence = 'none',
      assignee_id, related_job_id, related_invoice_id, related_appointment_id,
    } = req.body || {};

    const fields = {};
    const tTitle = (title || '').trim();
    if (!tTitle) fields.title = 'Title is required';
    else if (tTitle.length > MAX_TITLE_LEN) fields.title = `Title must be ${MAX_TITLE_LEN} characters or fewer`;
    if (description && String(description).length > MAX_DESC_LEN) fields.description = `Description must be ${MAX_DESC_LEN} characters or fewer`;
    if (location && String(location).length > MAX_LOCATION_LEN) fields.location = `Location must be ${MAX_LOCATION_LEN} characters or fewer`;
    if (!VALID_CATEGORIES.has(category)) fields.category = 'Invalid category';
    if (!VALID_STATUS.has(status)) fields.status = 'Invalid status';
    if (!VALID_RECURRENCE.has(recurrence)) fields.recurrence = 'Invalid recurrence';

    const startsDate = new Date(starts_at);
    const endsDate   = new Date(ends_at);
    if (Number.isNaN(startsDate.getTime())) fields.starts_at = 'Invalid start time';
    if (Number.isNaN(endsDate.getTime()))   fields.ends_at   = 'Invalid end time';
    if (!fields.starts_at && !fields.ends_at && endsDate <= startsDate) {
      fields.ends_at = 'End time must be after start time';
    }
    if (remind_minutes !== undefined && remind_minutes !== null) {
      const m = Number(remind_minutes);
      if (!Number.isFinite(m) || m < 0 || m > 10080) fields.remind_minutes = 'Reminder must be 0-10080 minutes';
    }

    if (Object.keys(fields).length) {
      return sendError(res, 400, 'Validation failed', 'validation_failed', { fields });
    }

    const { rows } = await pool.query(
      `INSERT INTO business_events
         (business_id, created_by, assignee_id, category, title, description, location,
          starts_at, ends_at, all_day, color, status, remind_minutes, recurrence,
          related_job_id, related_invoice_id, related_appointment_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING *`,
      [
        bizId, req.user.id, assignee_id || null, category, tTitle,
        description || null, location || null,
        startsDate.toISOString(), endsDate.toISOString(), !!all_day,
        color || null, status,
        remind_minutes == null ? null : Number(remind_minutes),
        recurrence,
        related_job_id || null, related_invoice_id || null, related_appointment_id || null,
      ]
    );
    sendSuccess(res, { event: rows[0] }, 201);
  } catch (err) {
    logger.error('createBusinessEvent failed', { error: err.message });
    sendError(res, 500, 'Failed to create event', 'event_create_failed');
  }
};

/* ---------------------------------------------------------------------------
 * PUT /api/businesses/:id/calendar/events/:eventId
 * ------------------------------------------------------------------------- */
exports.updateBusinessEvent = async (req, res) => {
  try {
    const { id: bizId, eventId } = req.params;
    const access = await canManageBusinessFinance(req.user.id, bizId);
    if (!access) return sendError(res, 403, 'Access denied', 'forbidden');

    const existing = await pool.query(
      'SELECT * FROM business_events WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL',
      [eventId, bizId]
    );
    if (existing.rowCount === 0) return sendError(res, 404, 'Event not found', 'not_found');

    const updates = [];
    const params = [];
    const fields = {};

    const pushSet = (col, value) => {
      params.push(value);
      updates.push(`${col} = $${params.length}`);
    };

    const body = req.body || {};
    if ('title' in body) {
      const t = String(body.title || '').trim();
      if (!t) fields.title = 'Title is required';
      else if (t.length > MAX_TITLE_LEN) fields.title = `Title must be ${MAX_TITLE_LEN} chars or fewer`;
      else pushSet('title', t);
    }
    if ('description' in body) {
      const d = body.description == null ? null : String(body.description);
      if (d && d.length > MAX_DESC_LEN) fields.description = `Description must be ${MAX_DESC_LEN} chars or fewer`;
      else pushSet('description', d);
    }
    if ('location' in body) {
      const l = body.location == null ? null : String(body.location);
      if (l && l.length > MAX_LOCATION_LEN) fields.location = `Location must be ${MAX_LOCATION_LEN} chars or fewer`;
      else pushSet('location', l);
    }
    if ('category' in body) {
      if (!VALID_CATEGORIES.has(body.category)) fields.category = 'Invalid category';
      else pushSet('category', body.category);
    }
    if ('status' in body) {
      if (!VALID_STATUS.has(body.status)) fields.status = 'Invalid status';
      else pushSet('status', body.status);
    }
    if ('recurrence' in body) {
      if (!VALID_RECURRENCE.has(body.recurrence)) fields.recurrence = 'Invalid recurrence';
      else pushSet('recurrence', body.recurrence);
    }
    if ('starts_at' in body) {
      const d = new Date(body.starts_at);
      if (Number.isNaN(d.getTime())) fields.starts_at = 'Invalid start time';
      else pushSet('starts_at', d.toISOString());
    }
    if ('ends_at' in body) {
      const d = new Date(body.ends_at);
      if (Number.isNaN(d.getTime())) fields.ends_at = 'Invalid end time';
      else pushSet('ends_at', d.toISOString());
    }
    if ('all_day'   in body) pushSet('all_day', !!body.all_day);
    if ('color'     in body) pushSet('color', body.color || null);
    if ('assignee_id'  in body) pushSet('assignee_id', body.assignee_id || null);
    if ('related_job_id' in body) pushSet('related_job_id', body.related_job_id || null);
    if ('related_invoice_id' in body) pushSet('related_invoice_id', body.related_invoice_id || null);
    if ('related_appointment_id' in body) pushSet('related_appointment_id', body.related_appointment_id || null);
    if ('remind_minutes' in body) {
      const m = body.remind_minutes == null ? null : Number(body.remind_minutes);
      if (m != null && (!Number.isFinite(m) || m < 0 || m > 10080)) fields.remind_minutes = 'Reminder must be 0-10080 minutes';
      else pushSet('remind_minutes', m);
    }

    if (Object.keys(fields).length) {
      return sendError(res, 400, 'Validation failed', 'validation_failed', { fields });
    }
    if (updates.length === 0) {
      return sendSuccess(res, { event: existing.rows[0] });
    }

    params.push(eventId);
    params.push(bizId);
    const { rows } = await pool.query(
      `UPDATE business_events SET ${updates.join(', ')}
         WHERE id = $${params.length - 1} AND business_id = $${params.length} AND deleted_at IS NULL
         RETURNING *`,
      params
    );
    if (rows.length === 0) return sendError(res, 404, 'Event not found', 'not_found');

    // Reject end <= start after merging
    const merged = rows[0];
    if (new Date(merged.ends_at) <= new Date(merged.starts_at)) {
      // Roll back: best-effort restore previous times
      await pool.query(
        'UPDATE business_events SET starts_at = $1, ends_at = $2 WHERE id = $3',
        [existing.rows[0].starts_at, existing.rows[0].ends_at, eventId]
      );
      return sendError(res, 400, 'End time must be after start time', 'validation_failed', {
        fields: { ends_at: 'End time must be after start time' },
      });
    }

    sendSuccess(res, { event: merged });
  } catch (err) {
    logger.error('updateBusinessEvent failed', { error: err.message });
    sendError(res, 500, 'Failed to update event', 'event_update_failed');
  }
};

/* ---------------------------------------------------------------------------
 * DELETE /api/businesses/:id/calendar/events/:eventId  (soft delete)
 * ------------------------------------------------------------------------- */
exports.deleteBusinessEvent = async (req, res) => {
  try {
    const { id: bizId, eventId } = req.params;
    const access = await canManageBusinessFinance(req.user.id, bizId);
    if (!access) return sendError(res, 403, 'Access denied', 'forbidden');

    const { rowCount } = await pool.query(
      `UPDATE business_events
         SET deleted_at = NOW()
       WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
      [eventId, bizId]
    );
    if (rowCount === 0) return sendError(res, 404, 'Event not found', 'not_found');
    sendSuccess(res, { ok: true });
  } catch (err) {
    logger.error('deleteBusinessEvent failed', { error: err.message });
    sendError(res, 500, 'Failed to delete event', 'event_delete_failed');
  }
};
