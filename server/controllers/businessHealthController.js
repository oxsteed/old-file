const pool = require('../db');

async function checkAccess(businessId, userId) {
  const { rows } = await pool.query(
    `SELECT role FROM business_members WHERE business_id=$1 AND user_id=$2 AND status='active'
     UNION
     SELECT 'owner' AS role FROM businesses WHERE id=$1 AND user_id=$2`,
    [businessId, userId]
  );
  return rows.length > 0;
}

async function upsertAlert(businessId, alertType, severity, title, message, actionUrl) {
  await pool.query(
    `INSERT INTO business_health_alerts (business_id, alert_type, severity, title, message, action_url)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (business_id, alert_type) DO UPDATE SET
       severity = EXCLUDED.severity,
       title = EXCLUDED.title,
       message = EXCLUDED.message,
       action_url = EXCLUDED.action_url,
       is_dismissed = false,
       dismissed_at = NULL,
       created_at = now()`,
    [businessId, alertType, severity, title, message, actionUrl]
  );
}

exports.getAlerts = async (req, res, next) => {
  try {
    const { businessId } = req.params;

    // Run all signal checks in parallel
    const [convRes, apptRes, reviewRes, clientRes] = await Promise.allSettled([
      pool.query(
        `SELECT COUNT(*) FROM business_conversations
         WHERE business_id=$1 AND last_message_at < now()-INTERVAL '24 hours' AND status='open'`,
        [businessId]
      ),
      pool.query(
        `SELECT COUNT(*) FROM business_appointments
         WHERE business_id=$1 AND scheduled_start >= now()
           AND scheduled_start < now()+INTERVAL '7 days'
           AND status NOT IN ('cancelled','no_show')`,
        [businessId]
      ),
      pool.query(
        `SELECT AVG(rating) AS avg_rating FROM business_reviews WHERE business_id=$1`,
        [businessId]
      ).catch(() => ({ rows: [{}] })),
      pool.query(
        `SELECT MAX(created_at) AS last_client FROM business_clients WHERE business_id=$1`,
        [businessId]
      ).catch(() => ({ rows: [{}] })),
    ]);

    // Process signals and upsert alerts
    if (convRes.status === 'fulfilled') {
      const count = parseInt(convRes.value.rows[0].count || 0);
      if (count > 0) {
        await upsertAlert(businessId, 'unanswered_messages', 'warning',
          `${count} unanswered conversation${count > 1 ? 's' : ''}`,
          `You have ${count} open conversation${count > 1 ? 's' : ''} with no reply in over 24 hours.`,
          '?tab=messages'
        );
      }
    }

    if (apptRes.status === 'fulfilled') {
      const count = parseInt(apptRes.value.rows[0].count || 0);
      if (count === 0) {
        await upsertAlert(businessId, 'no_upcoming_bookings', 'info',
          'No upcoming appointments this week',
          'You have no confirmed appointments in the next 7 days. Consider marketing to your clients.',
          '?tab=appointments'
        );
      }
    }

    if (reviewRes.status === 'fulfilled') {
      const avg = parseFloat(reviewRes.value.rows[0]?.avg_rating || 0);
      if (avg > 0 && avg < 4.0) {
        await upsertAlert(businessId, 'low_reviews', 'warning',
          `Average rating is ${avg.toFixed(1)} stars`,
          'Your average rating is below 4.0. Consider reaching out to recent clients for feedback.',
          '?tab=reviews'
        );
      }
    }

    if (clientRes.status === 'fulfilled') {
      const lastClient = clientRes.value.rows[0]?.last_client;
      if (!lastClient || new Date(lastClient) < new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)) {
        await upsertAlert(businessId, 'inactive_clients', 'info',
          'No new clients in the last 30 days',
          'You haven\'t had a new client in 30+ days. This might be a good time to run a promotion.',
          '?tab=marketing'
        );
      }
    }

    // Return all non-dismissed alerts sorted by severity
    const severityOrder = `CASE severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END`;
    const { rows } = await pool.query(
      `SELECT * FROM business_health_alerts
       WHERE business_id=$1 AND is_dismissed=false
       ORDER BY ${severityOrder}, created_at DESC`,
      [businessId]
    );

    res.json({ alerts: rows });
  } catch (err) {
    next(err);
  }
};

exports.dismissAlert = async (req, res, next) => {
  try {
    const { businessId, id } = req.params;
    const userId = req.user.id;

    if (!await checkAccess(businessId, userId)) return res.status(403).json({ error: 'Access denied' });

    const { rows } = await pool.query(
      `UPDATE business_health_alerts SET is_dismissed=true, dismissed_at=now()
       WHERE id=$1 AND business_id=$2 RETURNING *`,
      [id, businessId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Alert not found' });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};
