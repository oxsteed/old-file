const pool = require('../db');

// Shifts
exports.listShifts = async (req, res, next) => {
  const { businessId } = req.params;
  const { user_id, from, to } = req.query;
  try {
    let where = 'WHERE business_id = $1';
    const params = [businessId];
    let p = 2;
    if (user_id) { where += ` AND user_id = $${p++}`; params.push(user_id); }
    if (from) { where += ` AND shift_start >= $${p++}`; params.push(from); }
    if (to)   { where += ` AND shift_end <= $${p++}`; params.push(to); }
    const rows = await pool.query(
      `SELECT s.*, u.email AS user_email,
              COALESCE(u.display_name_preference, u.first_name || ' ' || u.last_name) AS user_name
       FROM business_staff_shifts s
       JOIN users u ON s.user_id = u.id
       ${where} ORDER BY shift_start`,
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
  try {
    const row = await pool.query(
      `INSERT INTO business_staff_shifts (business_id, user_id, shift_start, shift_end, role, notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [businessId, user_id, shift_start, shift_end, role, notes]
    );
    res.status(201).json(row.rows[0]);
  } catch (err) { next(err); }
};

exports.updateShift = async (req, res, next) => {
  const { businessId, shiftId } = req.params;
  const { shift_start, shift_end, role, notes, status } = req.body;
  try {
    const row = await pool.query(
      `UPDATE business_staff_shifts SET shift_start=$1, shift_end=$2, role=$3, notes=$4,
       status=COALESCE($5,status), updated_at=NOW()
       WHERE id=$6 AND business_id=$7 RETURNING *`,
      [shift_start, shift_end, role, notes, status, shiftId, businessId]
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
