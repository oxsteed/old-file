const pool = require('../db');

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
    const rows = await pool.query(
      `SELECT s.*,
              u.email AS user_email,
              COALESCE(u.display_name_preference, u.first_name || ' ' || u.last_name) AS user_name,
              -- Derived wall-clock datetimes for the existing client, which
              -- renders new Date(shift_start)/new Date(shift_end).
              (s.shift_date::text || 'T' || s.start_time::text) AS shift_start,
              (s.shift_date::text || 'T' || s.end_time::text) AS shift_end,
              s.role_label AS role
         FROM business_staff_shifts s
         JOIN users u ON s.user_id = u.id
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

// Time entries
exports.listTimeEntries = async (req, res, next) => {
  const { businessId } = req.params;
  const { user_id, from, to } = req.query;
  try {
    let where = 'WHERE te.business_id = $1';
    const params = [businessId];
    let p = 2;
    if (user_id) { where += ` AND te.user_id = $${p++}`; params.push(user_id); }
    if (from) { where += ` AND te.clock_in >= $${p++}`; params.push(from); }
    if (to)   { where += ` AND te.clock_in <= $${p++}`; params.push(to); }
    const rows = await pool.query(
      `SELECT te.*,
              COALESCE(u.display_name_preference, u.first_name || ' ' || u.last_name) AS user_name,
              EXTRACT(EPOCH FROM (COALESCE(te.clock_out, NOW()) - te.clock_in))/3600 AS hours
       FROM business_time_entries te
       JOIN users u ON te.user_id = u.id
       ${where} ORDER BY te.clock_in DESC`,
      params
    );
    res.json(rows.rows);
  } catch (err) { next(err); }
};

exports.clockIn = async (req, res, next) => {
  const { businessId } = req.params;
  try {
    const open = await pool.query(
      'SELECT id FROM business_time_entries WHERE business_id=$1 AND user_id=$2 AND clock_out IS NULL',
      [businessId, req.user.id]
    );
    if (open.rows.length) return res.status(409).json({ error: 'Already clocked in' });
    const row = await pool.query(
      'INSERT INTO business_time_entries (business_id, user_id, clock_in) VALUES ($1,$2,NOW()) RETURNING *',
      [businessId, req.user.id]
    );
    res.status(201).json(row.rows[0]);
  } catch (err) { next(err); }
};

exports.clockOut = async (req, res, next) => {
  const { businessId, entryId } = req.params;
  const { notes } = req.body;
  try {
    const row = await pool.query(
      `UPDATE business_time_entries SET clock_out=NOW(), notes=$1, updated_at=NOW()
       WHERE id=$2 AND business_id=$3 AND clock_out IS NULL RETURNING *`,
      [notes, entryId, businessId]
    );
    if (!row.rows.length) return res.status(404).json({ error: 'Active entry not found' });
    res.json(row.rows[0]);
  } catch (err) { next(err); }
};
