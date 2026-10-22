const pool = require('../db');
const { withTransaction } = require('../utils/transaction');
const { logBusinessAction } = require('../services/businessAuditLog');

// Shifts
//
// Review P1-5-F02: the StaffScheduler write path must produce rows the
// booking slot engine reads. business_staff_shifts stores
// (shift_date DATE, start_time TIME, end_time TIME, role_label) — see
// migration 238 — so this controller converts the form's
// shift_start/shift_end wall-clock datetimes into that shape on write, and
// derives shift_start/shift_end back on read so the existing client keeps
// working. Shifts are keyed on user_id: the slot engine only treats a
// staff member as shift-bound when shifts carry their user id, so user_id
// is required (never null).
const WALL_CLOCK_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

// Parse two wall-clock datetimes into the (shift_date, start_time, end_time)
// shape the table and the slot engine use. The components are taken
// verbatim (no timezone conversion): what the manager types is the
// business-local wall clock the engine interprets.
function toShiftParts(shiftStart, shiftEnd) {
  const s = String(shiftStart || '').match(WALL_CLOCK_RE);
  const e = String(shiftEnd || '').match(WALL_CLOCK_RE);
  if (!s || !e) return { error: 'shift_start and shift_end must be valid datetimes (YYYY-MM-DDTHH:MM)' };
  const startMs = Date.UTC(+s[1], +s[2] - 1, +s[3], +s[4], +s[5], +(s[6] || 0));
  const endMs = Date.UTC(+e[1], +e[2] - 1, +e[3], +e[4], +e[5], +(e[6] || 0));
  if (endMs <= startMs) return { error: 'shift_end must be after shift_start' };
  if (endMs - startMs > 24 * 3600 * 1000) {
    return { error: 'Shifts cannot span more than 24 hours' };
  }
  const pad = (n) => String(n).padStart(2, '0');
  return {
    shiftDate: `${s[1]}-${s[2]}-${s[3]}`,
    startTime: `${s[4]}:${s[5]}:${s[6] || '00'}`,
    endTime: `${e[4]}:${e[5]}:${e[6] || '00'}`,
  };
}

async function assertShiftMember(businessId, userId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM business_members WHERE business_id = $1 AND member_id = $2 AND status = 'active'
      UNION SELECT 1 FROM businesses WHERE id = $1 AND user_id = $2`,
    [businessId, userId]
  );
  return rows.length > 0;
}

// node-pg returns DATE as a Date object and TIME as 'HH:MM:SS' text;
// normalize both to wall-clock components for the datetime-local form.
function wallDatePart(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}
function wallTimePart(v) {
  if (v instanceof Date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}:${pad(v.getUTCSeconds())}`;
  }
  return String(v).slice(0, 8);
}

exports.listShifts = async (req, res, next) => {
  const { businessId } = req.params;
  const { user_id, from, to } = req.query;
  try {
    let where = 'WHERE s.business_id = $1';
    const params = [businessId];
    let p = 2;
    if (user_id) { where += ` AND s.user_id = $${p++}`; params.push(user_id); }
    if (from) { where += ` AND s.shift_date >= $${p++}::date`; params.push(from); }
    if (to)   { where += ` AND s.shift_date <= $${p++}::date`; params.push(to); }
    // S-04: drafts stay manager-only until published. Managers see every
    // row with its published flag; everyone else sees published shifts.
    const manager = await isBusinessManager(req, businessId, req.user.id);
    if (!manager) where += ' AND s.published_at IS NOT NULL';
    const rows = await pool.query(
      `SELECT s.*,
              u.email AS user_email,
              COALESCE(u.display_name_preference, u.first_name || ' ' || u.last_name) AS user_name,
              -- Derived wall-clock datetimes for the existing client, which
              -- renders new Date(shift_start)/new Date(shift_end).
              (s.shift_date::text || 'T' || s.start_time::text) AS shift_start,
              (s.shift_date::text || 'T' || s.end_time::text) AS shift_end,
              s.role_label AS role,
              (s.published_at IS NOT NULL) AS published
         FROM business_staff_shifts s
         -- LEFT JOIN: S-11 keeps shift rows after an account hard-delete
         -- (user_id SET NULL); the row must stay visible as history.
         LEFT JOIN users u ON s.user_id = u.id
         ${where} ORDER BY s.shift_date, s.start_time`,
      params
    );
    res.json(rows.rows);
  } catch (err) { next(err); }
};

exports.createShift = async (req, res, next) => {
  const { businessId } = req.params;
  const { user_id, shift_start, shift_end, role, notes } = req.body;
  if (!user_id || !shift_start || !shift_end) {
    return res.status(400).json({ error: 'user_id, shift_start, and shift_end are required' });
  }
  const parts = toShiftParts(shift_start, shift_end);
  if (parts.error) {
    return res.status(400).json({ error: parts.error });
  }
  try {
    if (!await assertShiftMember(businessId, user_id)) {
      return res.status(400).json({ error: 'User is not a member of this business' });
    }
    const row = await pool.query(
      `INSERT INTO business_staff_shifts (business_id, user_id, shift_date, start_time, end_time, role_label, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [businessId, user_id, parts.shiftDate, parts.startTime, parts.endTime, role || null, notes || null]
    );
    res.status(201).json(row.rows[0]);
  } catch (err) { next(err); }
};

exports.updateShift = async (req, res, next) => {
  const { businessId, shiftId } = req.params;
  const { shift_start, shift_end, role, notes } = req.body;
  try {
    let shiftDate, startTime, endTime;
    if (shift_start || shift_end) {
      const current = await pool.query(
        'SELECT shift_date, start_time, end_time FROM business_staff_shifts WHERE id = $1 AND business_id = $2',
        [shiftId, businessId]
      );
      if (!current.rows.length) return res.status(404).json({ error: 'Not found' });
      const cur = current.rows[0];
      const curStart = `${wallDatePart(cur.shift_date)}T${wallTimePart(cur.start_time)}`;
      const curEnd = `${wallDatePart(cur.shift_date)}T${wallTimePart(cur.end_time)}`;
      const parts = toShiftParts(shift_start || curStart, shift_end || curEnd);
      if (parts.error) return res.status(400).json({ error: parts.error });
      ({ shiftDate, startTime, endTime } = parts);
    }
    const row = await pool.query(
      `UPDATE business_staff_shifts
          SET shift_date = COALESCE($1, shift_date),
              start_time = COALESCE($2, start_time),
              end_time   = COALESCE($3, end_time),
              role_label = COALESCE($4, role_label),
              notes      = COALESCE($5, notes)
        WHERE id = $6 AND business_id = $7 RETURNING *`,
      [shiftDate || null, startTime || null, endTime || null, role || null, notes || null, shiftId, businessId]
    );
    if (!row.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(row.rows[0]);
  } catch (err) { next(err); }
};

exports.deleteShift = async (req, res, next) => {
  const { businessId, shiftId } = req.params;
  try {
    await pool.query('DELETE FROM business_staff_shifts WHERE id=$1 AND business_id=$2', [shiftId, businessId]);
    res.json({ success: true });
  } catch (err) { next(err); }
};

// Time entries — one punch model (S-05).
//
// The pre-S-05 handlers read and wrote clock_in / clock_out / notes /
// updated_at, none of which exist on business_time_entries (migration
// 238, punch columns added by 948), so every call threw a 500 against a
// real database; the unit test mocked the pool and could not see it.
// Punches now live in clock_in_at / clock_out_at / breaks, hours_worked
// is computed at clock-out (net of breaks), edits are append-only rows in
// business_time_entry_edits with a reason and a manager approver, and
// entries are voided, never hard-deleted. Manual-hours entries created
// through staffSchedulingController.logHours keep working alongside:
// they carry entry_date + hours_worked and no punch timestamps.

const PUNCH_SOURCES = new Set(['web', 'pos', 'kiosk', 'mobile', 'manual']);

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

function parseAvailabilityWindow(window) {
  const day = Number(window?.day_of_week ?? window?.dayOfWeek);
  const start = String(window?.start_time ?? window?.startTime ?? '');
  const end = String(window?.end_time ?? window?.endTime ?? '');
  if (!Number.isInteger(day) || day < 0 || day > 6 || !TIME_RE.test(start) || !TIME_RE.test(end)) {
    return { error: 'day_of_week must be 0-6 and start_time/end_time must be valid times' };
  }
  const startValue = start.length === 5 ? `${start}:00` : start;
  const endValue = end.length === 5 ? `${end}:00` : end;
  if (startValue >= endValue) return { error: 'end_time must be after start_time' };
  return {
    day,
    start: startValue,
    end: endValue,
    notes: window?.notes ? String(window.notes).slice(0, 500) : null,
  };
}

async function assertBusinessMember(businessId, userId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM business_members WHERE business_id=$1 AND member_id=$2 AND status='active'
     UNION SELECT 1 FROM businesses WHERE id=$1 AND user_id=$2`,
    [businessId, userId]
  );
  return rows.length > 0;
}

exports.listAvailability = async (req, res, next) => {
  const { businessId } = req.params;
  const requestedUserId = req.query.user_id || req.user.id;
  try {
    if (String(requestedUserId) !== String(req.user.id)
      && !await isBusinessManager(req, businessId, req.user.id)) {
      return res.status(403).json({ error: 'Only a manager can view another staff member availability' });
    }
    const { rows } = await pool.query(
      `SELECT id, business_id, user_id, day_of_week, start_time, end_time, notes
         FROM business_staff_availability
        WHERE business_id=$1 AND user_id=$2
        ORDER BY day_of_week, start_time, id`,
      [businessId, requestedUserId]
    );
    return res.json({ user_id: requestedUserId, windows: rows });
  } catch (err) { return next(err); }
};

exports.replaceAvailability = async (req, res, next) => {
  const { businessId } = req.params;
  const windows = Array.isArray(req.body?.windows) ? req.body.windows : null;
  if (!windows) return res.status(400).json({ error: 'windows must be an array' });
  if (windows.length > 42) return res.status(400).json({ error: 'A maximum of 42 availability windows is allowed' });
  const parsed = windows.map(parseAvailabilityWindow);
  const invalid = parsed.find((item) => item.error);
  if (invalid) return res.status(400).json({ error: invalid.error });
  const dedupe = new Set();
  for (const item of parsed) {
    const key = `${item.day}:${item.start}:${item.end}`;
    if (dedupe.has(key)) return res.status(400).json({ error: 'Duplicate availability windows are not allowed' });
    dedupe.add(key);
  }
  try {
    if (!await assertBusinessMember(businessId, req.user.id)) {
      return res.status(403).json({ error: 'Not a member of this business' });
    }
    const rows = await withTransaction(pool, async (client) => {
      await client.query(
        'DELETE FROM business_staff_availability WHERE business_id=$1 AND user_id=$2',
        [businessId, req.user.id]
      );
      for (const item of parsed) {
        await client.query(
          `INSERT INTO business_staff_availability
             (business_id, user_id, day_of_week, start_time, end_time, notes)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [businessId, req.user.id, item.day, item.start, item.end, item.notes]
        );
      }
      const result = await client.query(
        `SELECT id, business_id, user_id, day_of_week, start_time, end_time, notes
           FROM business_staff_availability
          WHERE business_id=$1 AND user_id=$2
          ORDER BY day_of_week, start_time, id`,
        [businessId, req.user.id]
      );
      return result.rows;
    });
    await logBusinessAction(req, {
      business_id: Number(businessId),
      action: 'business.staff.availability.replaced',
      target_type: 'staff_availability',
      target_id: req.user.id,
      after_state: { windows: rows },
    });
    return res.json({ user_id: req.user.id, windows: rows });
  } catch (err) { return next(err); }
};

exports.listShiftSwapRequests = async (req, res, next) => {
  const { businessId } = req.params;
  try {
    const manager = await isBusinessManager(req, businessId, req.user.id);
    const params = [businessId];
    let filter = '';
    if (!manager) {
      params.push(req.user.id);
      filter = ' AND (r.requester_user_id=$2 OR r.target_user_id=$2)';
    }
    const { rows } = await pool.query(
      `SELECT r.*, s.shift_date, s.start_time, s.end_time, s.role_label, s.user_id AS assigned_user_id
         FROM business_shift_swap_requests r
         JOIN business_staff_shifts s ON s.id=r.shift_id AND s.business_id=r.business_id
        WHERE r.business_id=$1${filter}
        ORDER BY r.created_at DESC, r.id DESC`,
      params
    );
    return res.json({ requests: rows });
  } catch (err) { return next(err); }
};

exports.createShiftSwapRequest = async (req, res, next) => {
  const { businessId, shiftId } = req.params;
  const targetUserId = req.body?.target_user_id || req.body?.targetUserId || null;
  const note = req.body?.note ? String(req.body.note).slice(0, 1000) : null;
  try {
    const { rows: shifts } = await pool.query(
      `SELECT id, user_id, shift_date, start_time, end_time
         FROM business_staff_shifts WHERE id=$1 AND business_id=$2`,
      [shiftId, businessId]
    );
    const shift = shifts[0];
    if (!shift) return res.status(404).json({ error: 'Shift not found' });
    const manager = await isBusinessManager(req, businessId, req.user.id);
    if (!manager && String(shift.user_id) !== String(req.user.id)) {
      return res.status(403).json({ error: 'You can only request a swap for your own shift' });
    }
    if (!targetUserId || String(targetUserId) === String(shift.user_id)) {
      return res.status(400).json({ error: 'A different target staff member is required' });
    }
    if (!await assertBusinessMember(businessId, targetUserId)) {
      return res.status(400).json({ error: 'Target user is not a member of this business' });
    }
    const { rows } = await pool.query(
      `INSERT INTO business_shift_swap_requests
         (business_id, shift_id, requester_user_id, target_user_id, note)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [businessId, shiftId, req.user.id, targetUserId, note]
    );
    await logBusinessAction(req, {
      business_id: Number(businessId),
      action: 'business.staff.shift_swap.requested',
      target_type: 'shift_swap_request',
      target_id: rows[0]?.id,
      after_state: rows[0],
    });
    return res.status(201).json({ request: rows[0] });
  } catch (err) { return next(err); }
};

async function decideShiftSwap(req, res, next, status) {
  const { businessId, requestId } = req.params;
  try {
    if (!await isBusinessManager(req, businessId, req.user.id)) {
      return res.status(403).json({ error: 'Only a manager can decide shift swaps' });
    }
    const result = await withTransaction(pool, async (client) => {
      const { rows } = await client.query(
        `SELECT r.*, s.user_id AS assigned_user_id
           FROM business_shift_swap_requests r
           JOIN business_staff_shifts s ON s.id=r.shift_id AND s.business_id=r.business_id
          WHERE r.id=$1 AND r.business_id=$2 FOR UPDATE`,
        [requestId, businessId]
      );
      const swap = rows[0];
      if (!swap) return { missing: true };
      if (swap.status !== 'requested') return { conflict: true };
      if (status === 'approved') {
        if (!swap.target_user_id) return { noTarget: true };
        await client.query(
          `UPDATE business_staff_shifts SET user_id=$1
            WHERE id=$2 AND business_id=$3 AND user_id=$4`,
          [swap.target_user_id, swap.shift_id, businessId, swap.assigned_user_id]
        );
      }
      const { rows: updated } = await client.query(
        `UPDATE business_shift_swap_requests
            SET status=$1, decided_by=$2, decided_at=NOW(), updated_at=NOW()
          WHERE id=$3 AND business_id=$4 RETURNING *`,
        [status, req.user.id, requestId, businessId]
      );
      return { request: updated[0] };
    });
    if (result.missing) return res.status(404).json({ error: 'Shift swap request not found' });
    if (result.conflict) return res.status(409).json({ error: 'Shift swap request is no longer pending' });
    if (result.noTarget) return res.status(409).json({ error: 'A target staff member is required before approval' });
    await logBusinessAction(req, {
      business_id: Number(businessId),
      action: `business.staff.shift_swap.${status}`,
      target_type: 'shift_swap_request',
      target_id: result.request?.id,
      before_state: { status: 'requested' },
      after_state: result.request,
    });
    return res.json({ request: result.request });
  } catch (err) { return next(err); }
}

exports.approveShiftSwapRequest = (req, res, next) => decideShiftSwap(req, res, next, 'approved');
exports.rejectShiftSwapRequest = (req, res, next) => decideShiftSwap(req, res, next, 'rejected');

function breakSeconds(breaks, nowMs) {
  if (!Array.isArray(breaks)) return 0;
  let total = 0;
  for (const b of breaks) {
    const start = Date.parse(b?.started_at || '');
    if (!Number.isFinite(start)) continue;
    const end = b?.ended_at ? Date.parse(b.ended_at) : nowMs;
    if (Number.isFinite(end) && end > start) total += (end - start) / 1000;
  }
  return total;
}

function computedHours(entry, nowMs = Date.now()) {
  if (!entry?.clock_in_at) return entry?.hours_worked != null ? Number(entry.hours_worked) : null;
  const start = new Date(entry.clock_in_at).getTime();
  const end = entry.clock_out_at ? new Date(entry.clock_out_at).getTime() : nowMs;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  const net = (end - start) / 1000 - breakSeconds(entry.breaks, nowMs);
  return Math.round(Math.max(0, net) / 36) / 100;
}

function presentTimeEntry(entry) {
  if (!entry) return entry;
  return {
    ...entry,
    hours: computedHours(entry),
    break_minutes: Math.round(breakSeconds(entry.breaks, Date.now()) / 60),
    // Legacy client field aliases (StaffScheduler renders clock_in/out).
    clock_in: entry.clock_in_at || null,
    clock_out: entry.clock_out_at || null,
  };
}

async function isBusinessManager(req, businessId, userId) {
  if (req.businessRole) return req.businessRole === 'owner' || req.businessRole === 'manager';
  const { rows } = await pool.query(
    `SELECT 1 FROM business_members WHERE business_id=$1 AND member_id=$2 AND status='active' AND role='manager'
     UNION SELECT 1 FROM businesses WHERE id=$1 AND user_id=$2`,
    [businessId, userId]
  );
  return rows.length > 0;
}

async function loadTimeEntry(businessId, entryId) {
  const { rows } = await pool.query(
    'SELECT * FROM business_time_entries WHERE id=$1 AND business_id=$2',
    [entryId, businessId]
  );
  return rows[0] || null;
}

exports.listTimeEntries = async (req, res, next) => {
  const { businessId } = req.params;
  const { user_id, from, to } = req.query;
  try {
    let where = 'WHERE te.business_id = $1 AND te.voided_at IS NULL';
    const params = [businessId];
    let p = 2;
    if (user_id) { where += ` AND te.user_id = $${p++}`; params.push(user_id); }
    if (from) { where += ` AND COALESCE(te.clock_in_at::date, te.entry_date) >= $${p++}::date`; params.push(from); }
    if (to)   { where += ` AND COALESCE(te.clock_in_at::date, te.entry_date) <= $${p++}::date`; params.push(to); }
    const rows = await pool.query(
      `SELECT te.*,
              COALESCE(u.display_name_preference, u.first_name || ' ' || u.last_name) AS user_name
       FROM business_time_entries te
       JOIN users u ON te.user_id = u.id
       ${where} ORDER BY COALESCE(te.clock_in_at, te.entry_date::timestamptz) DESC, te.id DESC`,
      params
    );
    res.json(rows.rows.map(presentTimeEntry));
  } catch (err) { next(err); }
};

exports.clockIn = async (req, res, next) => {
  const { businessId } = req.params;
  try {
    if (!await assertShiftMember(businessId, req.user.id)) {
      return res.status(403).json({ error: 'Not a member of this business' });
    }
    const open = await pool.query(
      `SELECT id FROM business_time_entries
        WHERE business_id=$1 AND user_id=$2
          AND clock_in_at IS NOT NULL AND clock_out_at IS NULL AND voided_at IS NULL`,
      [businessId, req.user.id]
    );
    if (open.rows.length) return res.status(409).json({ error: 'Already clocked in' });
    const source = PUNCH_SOURCES.has(req.body?.source) ? req.body.source : 'web';
    const punchMeta = {
      ip: req.ip || null,
      deviceLabel: typeof req.body?.device_label === 'string' ? req.body.device_label.slice(0, 120) : null,
      latitude: Number.isFinite(Number(req.body?.latitude)) && req.body?.latitude != null ? Number(req.body.latitude) : null,
      longitude: Number.isFinite(Number(req.body?.longitude)) && req.body?.longitude != null ? Number(req.body.longitude) : null,
    };
    const row = await pool.query(
      `INSERT INTO business_time_entries (business_id, user_id, entry_date, clock_in_at, source, punch_meta)
       VALUES ($1,$2, CURRENT_DATE, NOW(), $3, $4::jsonb) RETURNING *`,
      [businessId, req.user.id, source, JSON.stringify(punchMeta)]
    );
    res.status(201).json(presentTimeEntry(row.rows[0]));
  } catch (err) { next(err); }
};

exports.clockOut = async (req, res, next) => {
  const { businessId, entryId } = req.params;
  const { notes } = req.body || {};
  try {
    const entry = await loadTimeEntry(businessId, entryId);
    if (!entry || entry.voided_at || !entry.clock_in_at || entry.clock_out_at) {
      return res.status(404).json({ error: 'Active entry not found' });
    }
    // S-05: clockOut previously never checked ownership — anyone could
    // clock out anyone. Only the entry owner, or a manager, may close it.
    if (String(entry.user_id) !== String(req.user.id) && !await isBusinessManager(req, businessId, req.user.id)) {
      return res.status(403).json({ error: 'You can only clock out your own time entry' });
    }
    const now = new Date();
    // A punch closed within the same instant rounds to 0.00, which the
    // hours_worked > 0 check rejects; a closed punch counts at minimum
    // one centihour.
    const hours = Math.max(0.01, computedHours({ ...entry, clock_out_at: now }, now.getTime()));
    const row = await pool.query(
      `UPDATE business_time_entries
          SET clock_out_at=NOW(), hours_worked=$1,
              description = COALESCE($2, description)
        WHERE id=$3 AND business_id=$4 AND clock_out_at IS NULL AND voided_at IS NULL
        RETURNING *`,
      [hours, notes || null, entryId, businessId]
    );
    if (!row.rows.length) return res.status(404).json({ error: 'Active entry not found' });
    res.json(presentTimeEntry(row.rows[0]));
  } catch (err) { next(err); }
};

// Break start/end on an open punch. Breaks live in the entry's breaks
// JSONB array as { started_at, ended_at } pairs.
exports.punchBreak = async (req, res, next) => {
  const { businessId, entryId } = req.params;
  const action = req.body?.action === 'end' ? 'end' : 'start';
  try {
    const entry = await loadTimeEntry(businessId, entryId);
    if (!entry || entry.voided_at || !entry.clock_in_at || entry.clock_out_at) {
      return res.status(404).json({ error: 'Active entry not found' });
    }
    if (String(entry.user_id) !== String(req.user.id) && !await isBusinessManager(req, businessId, req.user.id)) {
      return res.status(403).json({ error: 'You can only manage breaks on your own time entry' });
    }
    const breaks = Array.isArray(entry.breaks) ? [...entry.breaks] : [];
    const openBreak = breaks.find((b) => b && !b.ended_at);
    if (action === 'start') {
      if (openBreak) return res.status(409).json({ error: 'A break is already in progress' });
      breaks.push({ started_at: new Date().toISOString(), ended_at: null });
    } else {
      if (!openBreak) return res.status(409).json({ error: 'No break is in progress' });
      openBreak.ended_at = new Date().toISOString();
    }
    const row = await pool.query(
      'UPDATE business_time_entries SET breaks=$1::jsonb WHERE id=$2 AND business_id=$3 RETURNING *',
      [JSON.stringify(breaks), entryId, businessId]
    );
    res.json(presentTimeEntry(row.rows[0]));
  } catch (err) { next(err); }
};

// Append-only punch edits: the entry row is updated, but every changed
// field leaves a business_time_entry_edits row with the old and new
// values, the editor, the approving manager (the editor must be one),
// and a mandatory reason. Nothing about the original record is lost.
exports.editTimeEntry = async (req, res, next) => {
  const { businessId, entryId } = req.params;
  const { clock_in_at, clock_out_at, description, reason } = req.body || {};
  try {
    if (!await isBusinessManager(req, businessId, req.user.id)) {
      return res.status(403).json({ error: 'Only a manager can edit time entries' });
    }
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ error: 'A reason is required to edit a time entry' });
    }
    const entry = await loadTimeEntry(businessId, entryId);
    if (!entry || entry.voided_at) return res.status(404).json({ error: 'Entry not found' });
    const changes = [];
    const nextIn = clock_in_at ? new Date(clock_in_at) : null;
    const nextOut = clock_out_at ? new Date(clock_out_at) : null;
    if (clock_in_at !== undefined) {
      if (!nextIn || Number.isNaN(nextIn.getTime())) return res.status(400).json({ error: 'clock_in_at must be a valid datetime' });
      changes.push({ field: 'clock_in_at', oldValue: entry.clock_in_at, newValue: nextIn.toISOString() });
    }
    if (clock_out_at !== undefined) {
      if (clock_out_at !== null && (!nextOut || Number.isNaN(nextOut.getTime()))) {
        return res.status(400).json({ error: 'clock_out_at must be a valid datetime or null' });
      }
      changes.push({ field: 'clock_out_at', oldValue: entry.clock_out_at, newValue: clock_out_at === null ? null : nextOut.toISOString() });
    }
    if (description !== undefined) {
      changes.push({ field: 'description', oldValue: entry.description, newValue: description || null });
    }
    if (!changes.length) return res.status(400).json({ error: 'No changes supplied' });
    const merged = { ...entry };
    for (const change of changes) merged[change.field] = change.newValue;
    if (merged.clock_in_at && merged.clock_out_at
      && new Date(merged.clock_out_at) <= new Date(merged.clock_in_at)) {
      return res.status(400).json({ error: 'clock_out_at must be after clock_in_at' });
    }
    const hours = merged.clock_in_at && merged.clock_out_at
      ? Math.max(0.01, computedHours(merged))
      : merged.clock_in_at
        ? null // punch reopened by clearing clock_out_at: hours unknown until it closes
        : entry.hours_worked;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const row = await client.query(
        `UPDATE business_time_entries
            SET clock_in_at = COALESCE($1::timestamptz, clock_in_at),
                clock_out_at = CASE WHEN $2::boolean THEN $3::timestamptz ELSE clock_out_at END,
                description = CASE WHEN $9::boolean THEN $4 ELSE description END,
                hours_worked = $5,
                approved_by = $6
          WHERE id=$7 AND business_id=$8 AND voided_at IS NULL
          RETURNING *`,
        [
          merged.clock_in_at ? new Date(merged.clock_in_at).toISOString() : null,
          changes.some((c) => c.field === 'clock_out_at'),
          merged.clock_out_at ? new Date(merged.clock_out_at).toISOString() : null,
          description !== undefined ? (description || null) : null,
          hours,
          req.user.id,
          entryId,
          businessId,
          description !== undefined,
        ]
      );
      if (!row.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Entry not found' });
      }
      for (const change of changes) {
        await client.query(
          `INSERT INTO business_time_entry_edits (entry_id, business_id, editor_user_id, approved_by, field, old_value, new_value, reason)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            entryId,
            businessId,
            req.user.id,
            req.user.id,
            change.field,
            change.oldValue == null ? null : String(change.oldValue instanceof Date ? change.oldValue.toISOString() : change.oldValue),
            change.newValue == null ? null : String(change.newValue),
            String(reason).slice(0, 1000),
          ]
        );
      }
      await client.query('COMMIT');
      return res.json(presentTimeEntry(row.rows[0]));
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
};

// Voiding replaces deletion: the row stays for payroll history, marked
// with who voided it and why, plus an audit row. Voided entries are
// excluded from lists and totals.
exports.voidTimeEntry = async (req, res, next) => {
  const { businessId, entryId } = req.params;
  const { reason } = req.body || {};
  try {
    if (!await isBusinessManager(req, businessId, req.user.id)) {
      return res.status(403).json({ error: 'Only a manager can void time entries' });
    }
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ error: 'A reason is required to void a time entry' });
    }
    const entry = await loadTimeEntry(businessId, entryId);
    if (!entry || entry.voided_at) return res.status(404).json({ error: 'Entry not found' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const row = await client.query(
        `UPDATE business_time_entries
            SET voided_at = NOW(), voided_by = $1, void_reason = $2
          WHERE id=$3 AND business_id=$4 AND voided_at IS NULL
          RETURNING *`,
        [req.user.id, String(reason).slice(0, 1000), entryId, businessId]
      );
      await client.query(
        `INSERT INTO business_time_entry_edits (entry_id, business_id, editor_user_id, approved_by, field, old_value, new_value, reason)
         VALUES ($1,$2,$3,$4,'voided_at',NULL,NOW()::text,$5)`,
        [entryId, businessId, req.user.id, req.user.id, String(reason).slice(0, 1000)]
      );
      await client.query('COMMIT');
      return res.json(presentTimeEntry(row.rows[0]));
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
};

// ── Schedule publishing (S-04) ──────────────────────────────────────────
// New shifts are drafts (published_at IS NULL) until a manager publishes
// them. Publishing flips the rows and notifies each assigned staff member
// once (S-17, type + params so the client localizes per S-19). Non-
// managers only ever see published shifts (listShifts filters below); the
// booking slot engine and the payroll scheduled-hours read likewise only
// count published shifts, so a draft never blocks customer bookings or
// inflates planned labor.

const { sendNotification } = require('../services/notificationService');

function shiftSummaryLabel(shifts) {
  if (shifts.length === 1) return shifts[0].role_label || 'Shift';
  return `${shifts.length} shifts`;
}

// node-pg returns DATE columns as Date objects and TIME as text;
// normalize both to an ISO instant for notification params.
function shiftStartIso(shift) {
  const d = shift.shift_date instanceof Date
    ? shift.shift_date.toISOString().slice(0, 10)
    : String(shift.shift_date).slice(0, 10);
  const t = shift.start_time instanceof Date
    ? shift.start_time.toISOString().slice(11, 19)
    : String(shift.start_time).slice(0, 8);
  return new Date(`${d}T${t}Z`).toISOString();
}

exports.publishShifts = async (req, res, next) => {
  const { businessId } = req.params;
  const { from, to, shift_ids, restaurant_id } = req.body || {};
  try {
    if (!await isBusinessManager(req, businessId, req.user.id)) {
      return res.status(403).json({ error: 'Only a manager can publish schedules' });
    }
    const { rows: [biz] } = await pool.query(
      'SELECT id, business_name FROM businesses WHERE id = $1',
      [businessId]
    );
    if (!biz) return res.status(404).json({ error: 'Business not found' });

    const params = [businessId];
    let where = 'business_id = $1 AND published_at IS NULL';
    if (Array.isArray(shift_ids) && shift_ids.length) {
      const ids = shift_ids.map(Number).filter(Number.isFinite);
      if (!ids.length) return res.status(400).json({ error: 'shift_ids must be a non-empty array of ids' });
      params.push(ids);
      where += ` AND id = ANY($${params.length}::bigint[])`;
    }
    if (from) { params.push(from); where += ` AND shift_date >= $${params.length}::date`; }
    if (to) { params.push(to); where += ` AND shift_date <= $${params.length}::date`; }
    if (restaurant_id) {
      const rid = Number(restaurant_id);
      if (!Number.isFinite(rid)) return res.status(400).json({ error: 'restaurant_id must be a number' });
      params.push(rid);
      where += ` AND (restaurant_id = $${params.length} OR restaurant_id IS NULL)`;
    }

    params.push(req.user.id);
    const { rows: published } = await pool.query(
      `UPDATE business_staff_shifts
          SET published_at = NOW(), published_by = $${params.length}
        WHERE ${where}
        RETURNING id, user_id, shift_date, start_time, role_label`,
      params
    );

    // One summary notification per assigned staff member (S-17). The
    // crew_shift_published locale strings render from type + params
    // (S-19); restaurantName carries the business name for business-hub
    // schedules.
    const byUser = new Map();
    for (const shift of published) {
      if (!shift.user_id || String(shift.user_id) === String(req.user.id)) continue;
      const list = byUser.get(shift.user_id) || [];
      list.push(shift);
      byUser.set(shift.user_id, list);
    }
    for (const [userId, list] of byUser) {
      list.sort((a, b) => String(a.shift_date).localeCompare(String(b.shift_date)));
      const earliest = list[0];
      await sendNotification({
        userId,
        type: 'crew_shift_published',
        title: 'New shifts published',
        body: `${list.length} shift${list.length === 1 ? '' : 's'} at ${biz.business_name}`,
        action_url: '/business',
        data: {
          business_id: biz.id,
          shift_ids: list.map((s) => s.id),
          params: {
            restaurantName: biz.business_name,
            shiftLabel: shiftSummaryLabel(list),
            startsAt: shiftStartIso(earliest),
          },
        },
      }).catch(() => {});
    }

    await logBusinessAction(req, {
      business_id: Number(businessId),
      action: 'business.staff.shifts.published',
      target_type: 'staff_schedule',
      after_state: { published: published.length, shift_ids: published.map((s) => s.id) },
    });
    return res.json({ published: published.length, shift_ids: published.map((s) => s.id) });
  } catch (err) { return next(err); }
};

// ── Time-off / PTO requests (S-04) ─────────────────────────────────────
// Members request time off for themselves; managers approve or deny.
// Approved ranges surface as conflicts on new requests so double-booking
// a shift against approved leave is visible before it happens.

const TIME_OFF_TYPES = new Set(['vacation', 'sick', 'personal', 'unpaid', 'other']);
const TIME_OFF_STATUSES = new Set(['pending', 'approved', 'denied', 'cancelled', 'withdrawn']);
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateTimeOffInput(body) {
  const requestType = String(body?.request_type || body?.requestType || 'vacation').toLowerCase();
  const startDate = String(body?.start_date || body?.startDate || '');
  const endDate = String(body?.end_date || body?.endDate || '');
  if (!TIME_OFF_TYPES.has(requestType)) return { error: `request_type must be one of: ${[...TIME_OFF_TYPES].join(', ')}` };
  if (!DATE_ONLY_RE.test(startDate) || !DATE_ONLY_RE.test(endDate)) {
    return { error: 'start_date and end_date are required as YYYY-MM-DD' };
  }
  if (endDate < startDate) return { error: 'end_date must be on or after start_date' };
  return { requestType, startDate, endDate };
}

async function findTimeOffConflicts(businessId, userId, startDate, endDate) {
  const { rows } = await pool.query(
    `SELECT id, shift_date, start_time, end_time, role_label
       FROM business_staff_shifts
      WHERE business_id = $1 AND user_id = $2 AND published_at IS NOT NULL
        AND shift_date BETWEEN $3::date AND $4::date
      ORDER BY shift_date, start_time`,
    [businessId, userId, startDate, endDate]
  );
  return rows;
}

exports.createTimeOffRequest = async (req, res, next) => {
  const { businessId } = req.params;
  try {
    if (!await assertBusinessMember(businessId, req.user.id)) {
      return res.status(403).json({ error: 'Not a member of this business' });
    }
    const valid = validateTimeOffInput(req.body);
    if (valid.error) return res.status(400).json({ error: valid.error });
    let restaurantId = null;
    if (req.body?.restaurant_id || req.body?.restaurantId) {
      const rid = Number(req.body.restaurant_id || req.body.restaurantId);
      if (!Number.isFinite(rid)) return res.status(400).json({ error: 'restaurant_id must be a number' });
      const { rows: [rest] } = await pool.query(
        `SELECT r.id FROM food_restaurants r JOIN businesses b ON b.id = r.business_id
          WHERE r.id = $1 AND b.id = $2`,
        [rid, businessId]
      );
      if (!rest) return res.status(400).json({ error: 'Restaurant does not belong to this business' });
      restaurantId = rid;
    }
    const { rows: [request] } = await pool.query(
      `INSERT INTO business_time_off_requests
         (business_id, user_id, restaurant_id, request_type, start_date, end_date, reason)
       VALUES ($1,$2,$3,$4,$5::date,$6::date,$7)
       RETURNING *`,
      [businessId, req.user.id, restaurantId, valid.requestType, valid.startDate, valid.endDate,
        req.body?.reason ? String(req.body.reason).slice(0, 2000) : null]
    );
    const conflicts = await findTimeOffConflicts(businessId, req.user.id, valid.startDate, valid.endDate);
    await logBusinessAction(req, {
      business_id: Number(businessId),
      action: 'business.staff.time_off.requested',
      target_type: 'time_off_request',
      target_id: request.id,
      after_state: request,
    });
    return res.status(201).json({ request, conflicts });
  } catch (err) { return next(err); }
};

exports.listTimeOffRequests = async (req, res, next) => {
  const { businessId } = req.params;
  const { status, user_id } = req.query;
  try {
    const manager = await isBusinessManager(req, businessId, req.user.id);
    const params = [businessId];
    let where = 'r.business_id = $1';
    if (!manager) {
      params.push(req.user.id);
      where += ` AND r.user_id = $${params.length}`;
    } else if (user_id) {
      params.push(user_id);
      where += ` AND r.user_id = $${params.length}`;
    }
    if (status) {
      if (!TIME_OFF_STATUSES.has(String(status))) return res.status(400).json({ error: 'Invalid status filter' });
      params.push(String(status));
      where += ` AND r.status = $${params.length}`;
    }
    const { rows } = await pool.query(
      `SELECT r.*,
              COALESCE(u.display_name_preference, u.first_name || ' ' || u.last_name) AS user_name
         FROM business_time_off_requests r
         JOIN users u ON u.id = r.user_id
        WHERE ${where}
        ORDER BY r.start_date DESC, r.created_at DESC`,
      params
    );
    return res.json({ requests: rows });
  } catch (err) { return next(err); }
};

exports.decideTimeOffRequest = async (req, res, next) => {
  const { businessId, requestId } = req.params;
  const decision = String(req.body?.decision || '').toLowerCase();
  try {
    if (!await isBusinessManager(req, businessId, req.user.id)) {
      return res.status(403).json({ error: 'Only a manager can decide time-off requests' });
    }
    if (!['approved', 'denied'].includes(decision)) {
      return res.status(400).json({ error: 'decision must be approved or denied' });
    }
    const { rows: [request] } = await pool.query(
      `UPDATE business_time_off_requests
          SET status = $1, decided_by = $2, decided_at = NOW(), updated_at = NOW()
        WHERE id = $3 AND business_id = $4 AND status = 'pending'
        RETURNING *`,
      [decision, req.user.id, requestId, businessId]
    );
    if (!request) return res.status(404).json({ error: 'Pending time-off request not found' });
    await logBusinessAction(req, {
      business_id: Number(businessId),
      action: `business.staff.time_off.${decision}`,
      target_type: 'time_off_request',
      target_id: request.id,
      before_state: { status: 'pending' },
      after_state: request,
    });
    // Fire-and-forget: the requester hears the decision.
    sendNotification({
      userId: request.user_id,
      type: 'time_off_decided',
      title: `Time-off ${decision}`,
      body: `Your ${request.request_type} request for ${String(request.start_date).slice(0, 10)} to ${String(request.end_date).slice(0, 10)} was ${decision}.`,
      data: { business_id: Number(businessId), request_id: request.id, decision },
    }).catch(() => {});
    return res.json({ request });
  } catch (err) { return next(err); }
};

exports.cancelTimeOffRequest = async (req, res, next) => {
  const { businessId, requestId } = req.params;
  try {
    const { rows: [request] } = await pool.query(
      `UPDATE business_time_off_requests
          SET status = 'cancelled', updated_at = NOW()
        WHERE id = $1 AND business_id = $2 AND user_id = $3 AND status = 'pending'
        RETURNING *`,
      [requestId, businessId, req.user.id]
    );
    if (!request) return res.status(404).json({ error: 'Pending time-off request not found' });
    await logBusinessAction(req, {
      business_id: Number(businessId),
      action: 'business.staff.time_off.cancelled',
      target_type: 'time_off_request',
      target_id: request.id,
      before_state: { status: 'pending' },
      after_state: request,
    });
    return res.json({ request });
  } catch (err) { return next(err); }
};
