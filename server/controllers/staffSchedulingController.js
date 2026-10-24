const workforce = require('../services/restaurantWorkforceScope');
const { payrollLocation } = require('../services/restaurantPayrollLocation');
const pool = require('../db');
const { businessScopeSatisfies } = require('../middleware/scopeGates');
const { logBusinessAction } = require('../services/businessAuditLog');

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
    const storeContext = await workforce.context(req);
    const { week_start } = req.query;

    if (!(businessScopeSatisfies(req, businessId, 'manager') || await checkAccess(businessId, req.user.id))) return res.status(403).json({ error: 'Access denied' });

    const start = week_start ? new Date(week_start) : (() => {
      const d = new Date();
      d.setDate(d.getDate() - d.getDay());
      return d;
    })();
    const end = new Date(start);
    end.setDate(end.getDate() + 6);

    const params=[businessId,start.toISOString().split('T')[0],end.toISOString().split('T')[0]];
    const storeFilter=workforce.clause(storeContext,'s',params);
    const { rows } = await pool.query(
      `SELECT s.*, u.first_name, u.last_name, u.email
       FROM business_staff_shifts s
       JOIN users u ON u.id = s.user_id
       WHERE s.business_id=$1 AND s.shift_date BETWEEN $2 AND $3${storeFilter}
       ORDER BY s.shift_date, s.start_time`,
      params
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
    const storeContext = await workforce.context(req);
    const userId = req.user.id;
    const { user_id, shift_date, start_time, end_time, role_label, notes } = req.body;

    if (!(businessScopeSatisfies(req, businessId, 'manager') || await checkAccess(businessId, userId))) return res.status(403).json({ error: 'Access denied' });
    if (!user_id || !shift_date || !start_time || !end_time) {
      return res.status(400).json({ error: 'user_id, shift_date, start_time, end_time required' });
    }

    const locationId = await payrollLocation(businessId, req.user?.id, req.body.locationId ?? req.body.location_id ?? null);
    await workforce.assertStaff(storeContext,user_id,pool,locationId);
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
      `INSERT INTO business_staff_shifts (business_id, user_id, shift_date, start_time, end_time, role_label, notes, location_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [businessId, user_id, shift_date, start_time, end_time, role_label || null, notes || null, locationId]
    );
    res.status(201).json({ shift: rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.deleteShift = async (req, res, next) => {
  try {
    const { businessId, id } = req.params;
    const storeContext = await workforce.context(req);
    await workforce.assertRecord(storeContext,'business_staff_shifts',id);
    const userId = req.user.id;

    if (!(businessScopeSatisfies(req, businessId, 'manager') || await checkAccess(businessId, userId))) return res.status(403).json({ error: 'Access denied' });

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
    const storeContext = await workforce.context(req);
    const userId = req.user.id;
    const { user_id, entry_date, hours_worked, description } = req.body;

    if (!(businessScopeSatisfies(req, businessId, 'manager') || await checkAccess(businessId, userId))) return res.status(403).json({ error: 'Access denied' });
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

    const locationId = await payrollLocation(businessId, req.user?.id, req.body.locationId ?? req.body.location_id ?? null);
    await workforce.assertStaff(storeContext,user_id,pool,locationId);
    const { rows } = await pool.query(
      `INSERT INTO business_time_entries (business_id, user_id, entry_date, hours_worked, description, approved_by, source, location_id)
       VALUES ($1,$2,$3,$4,$5,$6,'manual',$7) RETURNING *`,
      [businessId, user_id, entry_date || new Date().toISOString().split('T')[0], hours, description || null, userId, locationId]
    );
    // S-16: time entries feed payroll; creating one is an auditable
    // staff action (deletion below was previously unaudited entirely).
    await logBusinessAction(req, {
      business_id: Number(businessId),
      action: 'business.time_entry.logged',
      target_type: 'time_entry',
      target_id: rows[0].id,
      after_state: {
        user_id, entry_date: rows[0].entry_date, hours_worked: rows[0].hours_worked,
      },
    });
    res.status(201).json({ entry: rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.getTimeEntries = async (req, res, next) => {
  try {
    const { businessId } = req.params;
    const storeContext = await workforce.context(req);
    const { user_id, from_date, to_date } = req.query;

    if (!(businessScopeSatisfies(req, businessId, 'manager') || await checkAccess(businessId, req.user.id))) return res.status(403).json({ error: 'Access denied' });

    const conditions = ['te.business_id = $1'];
    const params = [businessId];
    let p = 2;

    conditions.push('te.voided_at IS NULL');
    if (user_id) { conditions.push(`te.user_id = $${p++}`); params.push(user_id); }
    if (from_date) { conditions.push(`te.entry_date >= $${p++}`); params.push(from_date); }
    if (to_date) { conditions.push(`te.entry_date <= $${p++}`); params.push(to_date); }

    const storeFilter=workforce.clause(storeContext,'te',params);
    const { rows } = await pool.query(
      `SELECT te.*, u.first_name, u.last_name, u.email
       FROM business_time_entries te
       JOIN users u ON u.id = te.user_id
       WHERE ${conditions.join(' AND ')}${storeFilter}
       ORDER BY te.entry_date DESC, te.id DESC`,
      params
    );

    // Compute total hours per user. Open punches (S-05) carry a NULL
    // hours_worked until clock-out; they contribute 0 here, not NaN.
    const totalsMap = {};
    for (const row of rows) {
      const key = row.user_id;
      if (!totalsMap[key]) totalsMap[key] = { user_id: key, name: `${row.first_name} ${row.last_name}`, total_hours: 0 };
      totalsMap[key].total_hours += parseFloat(row.hours_worked) || 0;
    }

    res.json({ entries: rows, totals: Object.values(totalsMap), total: rows.length });
  } catch (err) {
    next(err);
  }
};

// S-05: time records are never hard-deleted. This endpoint keeps its
// route (StaffSchedulingTab calls it) but now voids the entry: the row
// stays for payroll history with voided_at/voided_by/void_reason set and
// an append-only audit row in business_time_entry_edits.
exports.deleteTimeEntry = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { businessId, id } = req.params;
    const storeContext = await workforce.context(req);
    await workforce.assertRecord(storeContext,'business_time_entries',id);
    const userId = req.user.id;

    if (!(businessScopeSatisfies(req, businessId, 'manager') || await checkAccess(businessId, userId))) return res.status(403).json({ error: 'Access denied' });

    const reason = (req.body?.reason && String(req.body.reason).slice(0, 1000)) || 'Voided via scheduling API';
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE business_time_entries
          SET voided_at = NOW(), voided_by = $1, void_reason = $2
        WHERE id=$3 AND business_id=$4 AND voided_at IS NULL
        RETURNING *`,
      [userId, reason, id, businessId]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Entry not found' });
    }
    await client.query(
      `INSERT INTO business_time_entry_edits (entry_id, business_id, editor_user_id, approved_by, field, old_value, new_value, reason)
       VALUES ($1,$2,$3,$4,'voided_at',NULL,NOW()::text,$5)`,
      [id, businessId, userId, userId, reason]
    );
    // S-16: voiding a time entry affects payroll evidence; mirror the void
    // into the business audit log (with the entry's state) so it is visible
    // in the Team activity view, not only in the entry edit log.
    await logBusinessAction(req, {
      business_id: Number(businessId),
      action: 'business.time_entry.voided',
      target_type: 'time_entry',
      target_id: id,
      before_state: {
        user_id: rows[0].user_id,
        entry_date: rows[0].entry_date,
        hours_worked: rows[0].hours_worked,
        description: rows[0].description,
      },
      after_state: { voided: true, void_reason: reason },
    });
    await client.query('COMMIT');
    res.json({ success: true, voided: true, entry: rows[0] });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
};
