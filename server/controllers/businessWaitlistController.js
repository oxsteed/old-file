const pool = require('../db');

exports.listWaitlist = async (req, res, next) => {
  const { businessId } = req.params;
  const { service_id, status } = req.query;
  try {
    let where = 'WHERE w.business_id = $1';
    const params = [businessId];
    let p = 2;
    if (service_id) { where += ` AND w.service_id = $${p++}`; params.push(service_id); }
    if (status) { where += ` AND w.status = $${p++}`; params.push(status); }
    const rows = await pool.query(
      `SELECT w.*,
              COALESCE(u.display_name_preference, u.first_name || ' ' || u.last_name) AS customer_name,
              u.email AS customer_email,
              bs.name AS service_name
       FROM appointment_waitlist w
       LEFT JOIN users u ON w.customer_id = u.id
       LEFT JOIN business_services bs ON w.service_id = bs.id
       ${where} ORDER BY w.position ASC, w.created_at ASC`,
      params
    );
    res.json(rows.rows);
  } catch (err) { next(err); }
};

exports.addToWaitlist = async (req, res, next) => {
  const { businessId } = req.params;
  const { service_id, preferred_date, preferred_time_range, notes } = req.body;
  try {
    const posRow = await pool.query(
      'SELECT COALESCE(MAX(position),0)+1 AS next_pos FROM appointment_waitlist WHERE business_id=$1 AND service_id=$2 AND status=\'waiting\'',
      [businessId, service_id]
    );
    const row = await pool.query(
      `INSERT INTO appointment_waitlist (business_id, customer_id, service_id, preferred_date, preferred_time_range, notes, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [businessId, req.user.id, service_id, preferred_date, preferred_time_range, notes, posRow.rows[0].next_pos]
    );
    res.status(201).json(row.rows[0]);
  } catch (err) { next(err); }
};

exports.updateWaitlistEntry = async (req, res, next) => {
  const { businessId, entryId } = req.params;
  const { status, notes } = req.body;
  try {
    const row = await pool.query(
      `UPDATE appointment_waitlist SET status=COALESCE($1,status), notes=COALESCE($2,notes), updated_at=NOW()
       WHERE id=$3 AND business_id=$4 RETURNING *`,
      [status, notes, entryId, businessId]
    );
    if (!row.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(row.rows[0]);
  } catch (err) { next(err); }
};

exports.removeFromWaitlist = async (req, res, next) => {
  const { businessId, entryId } = req.params;
  try {
    await pool.query(
      'UPDATE appointment_waitlist SET status=\'removed\' WHERE id=$1 AND business_id=$2',
      [entryId, businessId]
    );
    res.json({ success: true });
  } catch (err) { next(err); }
};
