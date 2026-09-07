const pool = require('../db');

async function checkAccess(businessId, userId) {
  const { rows } = await pool.query(
    `SELECT role FROM business_members WHERE business_id=$1 AND member_id=$2 AND status='active' AND role='manager'
     UNION
     SELECT 'owner' AS role FROM businesses WHERE id=$1 AND user_id=$2`,
    [businessId, userId]
  );
  return rows.length > 0;
}

exports.getWeekSchedule = async (req, res, next) => {
  try {
    const { businessId } = req.params;
    const { week_start } = req.query;

    if (!await checkAccess(businessId, req.user.id)) return res.status(403).json({ error: 'Access denied' });

    const start = week_start ? new Date(week_start) : (() => {
      const d = new Date();
      d.setDate(d.getDate() - d.getDay());
      return d;
    })();
    const end = new Date(start);
    end.setDate(end.getDate() + 6);

    const { rows } = await pool.query(
      `SELECT s.*, u.first_name, u.last_name, u.email
       FROM business_staff_shifts s
       JOIN users u ON u.id = s.user_id
       WHERE s.business_id=$1 AND s.shift_date BETWEEN $2 AND $3
       ORDER BY s.shift_date, s.start_time`,
      [businessId, start.toISOString().split('T')[0], end.toISOString().split('T')[0]]
    );

    // Group by user
    const byUser = {};
    for (const row of rows) {
      const key = row.user_id;
      if (!byUser[key]) {
        byUser[key] = {
          user_id: key,
          first_name: row.first_name,
          last_name: row.last_name,
          email: row.email,
          shifts: [],
        };
      }
      byUser[key].shifts.push(row);
    }

    res.json({
      schedule: Object.values(byUser),
      week_start: start.toISOString().split('T')[0],
      week_end: end.toISOString().split('T')[0],
    });
  } catch (err) {
    next(err);
  }
};

exports.createShift = async (req, res, next) => {
  try {
    const { businessId } = req.params;
    const userId = req.user.id;
    const { user_id, shift_date, start_time, end_time, role_label, notes } = req.body;

    if (!await checkAccess(businessId, userId)) return res.status(403).json({ error: 'Access denied' });
    if (!user_id || !shift_date || !start_time || !end_time) {
      return res.status(400).json({ error: 'user_id, shift_date, start_time, end_time required' });
    }

    // Verify user is a member of this business
    const memberCheck = await pool.query(
      `SELECT 1 FROM business_members WHERE business_id=$1 AND member_id=$2 AND status='active'
       UNION SELECT 1 FROM businesses WHERE id=$1 AND user_id=$2`,
      [businessId, user_id]
    );
    if (!memberCheck.rows.length) {
      return res.status(400).json({ error: 'User is not a member of this business' });
    }

    const { rows } = await pool.query(
      `INSERT INTO business_staff_shifts (business_id, user_id, shift_date, start_time, end_time, role_label, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [businessId, user_id, shift_date, start_time, end_time, role_label || null, notes || null]
    );
    res.status(201).json({ shift: rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.deleteShift = async (req, res, next) => {
  try {
    const { businessId, id } = req.params;
    const userId = req.user.id;

    if (!await checkAccess(businessId, userId)) return res.status(403).json({ error: 'Access denied' });

    const { rows } = await pool.query(
      'DELETE FROM business_staff_shifts WHERE id=$1 AND business_id=$2 RETURNING id',
      [id, businessId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Shift not found' });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

exports.logHours = async (req, res, next) => {
  try {
    const { businessId } = req.params;
    const userId = req.user.id;
    const { user_id, entry_date, hours_worked, description } = req.body;

    if (!await checkAccess(businessId, userId)) return res.status(403).json({ error: 'Access denied' });
    if (!user_id || !hours_worked) return res.status(400).json({ error: 'user_id and hours_worked required' });

    const memberCheck = await pool.query(
      `SELECT 1 FROM business_members WHERE business_id=$1 AND member_id=$2 AND status='active'
       UNION SELECT 1 FROM businesses WHERE id=$1 AND user_id=$2`,
      [businessId, user_id]
    );
    if (!memberCheck.rows.length) {
      return res.status(400).json({ error: 'User is not a member of this business' });
    }

    const hours = parseFloat(hours_worked);
    if (isNaN(hours) || hours <= 0 || hours > 24) {
      return res.status(400).json({ error: 'hours_worked must be between 0 and 24' });
    }

    const { rows } = await pool.query(
      `INSERT INTO business_time_entries (business_id, user_id, entry_date, hours_worked, description)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [businessId, user_id, entry_date || new Date().toISOString().split('T')[0], hours, description || null]
    );
    res.status(201).json({ entry: rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.getTimeEntries = async (req, res, next) => {
  try {
    const { businessId } = req.params;
    const { user_id, from_date, to_date } = req.query;

    if (!await checkAccess(businessId, req.user.id)) return res.status(403).json({ error: 'Access denied' });

    const conditions = ['te.business_id = $1'];
    const params = [businessId];
    let p = 2;

    if (user_id) { conditions.push(`te.user_id = $${p++}`); params.push(user_id); }
    if (from_date) { conditions.push(`te.entry_date >= $${p++}`); params.push(from_date); }
    if (to_date) { conditions.push(`te.entry_date <= $${p++}`); params.push(to_date); }

    const { rows } = await pool.query(
      `SELECT te.*, u.first_name, u.last_name, u.email
       FROM business_time_entries te
       JOIN users u ON u.id = te.user_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY te.entry_date DESC, te.id DESC`,
      params
    );

    // Compute total hours per user
    const totalsMap = {};
    for (const row of rows) {
      const key = row.user_id;
      if (!totalsMap[key]) totalsMap[key] = { user_id: key, name: `${row.first_name} ${row.last_name}`, total_hours: 0 };
      totalsMap[key].total_hours += parseFloat(row.hours_worked);
    }

    res.json({ entries: rows, totals: Object.values(totalsMap), total: rows.length });
  } catch (err) {
    next(err);
  }
};

exports.deleteTimeEntry = async (req, res, next) => {
  try {
    const { businessId, id } = req.params;
    const userId = req.user.id;

    if (!await checkAccess(businessId, userId)) return res.status(403).json({ error: 'Access denied' });

    const { rows } = await pool.query(
      'DELETE FROM business_time_entries WHERE id=$1 AND business_id=$2 RETURNING id',
      [id, businessId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Entry not found' });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};
