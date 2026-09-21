const pool = require('../db');

const UI_TO_DB_STATUS = {
  waiting: 'waiting',
  notified: 'offered',
  booked: 'accepted',
  removed: 'cancelled',
  offered: 'offered',
  accepted: 'accepted',
  cancelled: 'cancelled',
  expired: 'expired',
};

const DB_TO_UI_STATUS = {
  waiting: 'waiting',
  offered: 'notified',
  accepted: 'booked',
  cancelled: 'removed',
  expired: 'removed',
};

function formatTimeRange(start, end) {
  if (start && end) return `${String(start).slice(0, 5)}–${String(end).slice(0, 5)}`;
  if (start) return String(start).slice(0, 5);
  return null;
}

function mapWaitlistRow(row) {
  return {
    id: row.id,
    business_id: row.business_id,
    service_id: row.service_id,
    customer_id: row.customer_id,
    customer_name: row.customer_name,
    customer_email: row.customer_email,
    service_name: row.service_name,
    status: DB_TO_UI_STATUS[row.status] || row.status,
    position: row.position_in_queue,
    preferred_date: row.preferred_date_start,
    preferred_time_range: formatTimeRange(row.preferred_time_start, row.preferred_time_end),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

exports.listWaitlist = async (req, res, next) => {
  const { businessId } = req.params;
  const { service_id, status } = req.query;
  try {
    let where = 'WHERE bs.business_id = $1';
    const params = [businessId];
    let p = 2;
    if (service_id) { where += ` AND w.service_id = $${p++}`; params.push(service_id); }
    if (status) {
      where += ` AND w.status = $${p++}`;
      params.push(UI_TO_DB_STATUS[status] || status);
    }
    const rows = await pool.query(
      `SELECT w.id, w.service_id, w.customer_id, w.status, w.position_in_queue,
              w.preferred_date_start, w.preferred_date_end, w.preferred_time_start, w.preferred_time_end,
              w.created_at, w.updated_at,
              bs.business_id,
              NULLIF(TRIM(BOTH FROM CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), '') AS customer_name,
              u.email AS customer_email,
              bs.name AS service_name
       FROM appointment_waitlist w
       JOIN business_services bs ON bs.id = w.service_id
       LEFT JOIN users u ON w.customer_id = u.id
       ${where}
       ORDER BY w.position_in_queue ASC NULLS LAST, w.created_at ASC`,
      params
    );
    res.json(rows.rows.map(mapWaitlistRow));
  } catch (err) { next(err); }
};

exports.addToWaitlist = async (req, res, next) => {
  const { businessId } = req.params;
  const { service_id, preferred_date, preferred_time_range } = req.body;
  try {
    if (!service_id) return res.status(400).json({ error: 'Service is required', code: 'validation_failed' });

    const service = await pool.query(
      'SELECT id FROM business_services WHERE id = $1 AND business_id = $2',
      [service_id, businessId]
    );
    if (!service.rows.length) return res.status(404).json({ error: 'Service not found', code: 'not_found' });

    const posRow = await pool.query(
      'SELECT COALESCE(MAX(position_in_queue),0)+1 AS next_pos FROM appointment_waitlist WHERE service_id=$1 AND status=\'waiting\'',
      [service_id]
    );

    let preferredTimeStart = null;
    let preferredTimeEnd = null;
    if (typeof preferred_time_range === 'string' && preferred_time_range.includes('–')) {
      const [start, end] = preferred_time_range.split('–').map((part) => part.trim());
      preferredTimeStart = start || null;
      preferredTimeEnd = end || null;
    } else if (typeof preferred_time_range === 'string' && preferred_time_range.includes('-')) {
      const [start, end] = preferred_time_range.split('-').map((part) => part.trim());
      preferredTimeStart = start || null;
      preferredTimeEnd = end || null;
    }

    const row = await pool.query(
      `INSERT INTO appointment_waitlist
         (service_id, customer_id, preferred_date_start, preferred_time_start, preferred_time_end, position_in_queue, status)
       VALUES ($1,$2,$3,$4,$5,$6,'waiting') RETURNING *`,
      [service_id, req.user.id, preferred_date || null, preferredTimeStart, preferredTimeEnd, posRow.rows[0].next_pos]
    );
    res.status(201).json(mapWaitlistRow({
      ...row.rows[0],
      business_id: Number(businessId),
      customer_name: null,
      customer_email: null,
      service_name: null,
    }));
  } catch (err) { next(err); }
};

exports.updateWaitlistEntry = async (req, res, next) => {
  const { businessId, entryId } = req.params;
  const { status } = req.body;
  try {
    const dbStatus = status ? (UI_TO_DB_STATUS[status] || status) : null;
    const row = await pool.query(
      `UPDATE appointment_waitlist w
         SET status = COALESCE($1, w.status), updated_at = NOW()
       FROM business_services bs
       WHERE w.id = $2
         AND w.service_id = bs.id
         AND bs.business_id = $3
       RETURNING w.*`,
      [dbStatus, entryId, businessId]
    );
    if (!row.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(mapWaitlistRow({ ...row.rows[0], business_id: Number(businessId), customer_name: null, customer_email: null, service_name: null }));
  } catch (err) { next(err); }
};

exports.removeFromWaitlist = async (req, res, next) => {
  const { businessId, entryId } = req.params;
  try {
    await pool.query(
      `UPDATE appointment_waitlist w
         SET status = 'cancelled', updated_at = NOW()
       FROM business_services bs
       WHERE w.id = $1
         AND w.service_id = bs.id
         AND bs.business_id = $2`,
      [entryId, businessId]
    );
    res.json({ success: true });
  } catch (err) { next(err); }
};
