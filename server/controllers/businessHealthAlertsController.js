const pool = require('../db');

exports.listAlerts = async (req, res, next) => {
  const { businessId } = req.params;
  const { dismissed } = req.query;
  try {
    let where = 'WHERE business_id = $1';
    if (dismissed === 'false' || !dismissed) where += ' AND is_dismissed = FALSE';
    const rows = await pool.query(
      `SELECT * FROM business_health_alerts ${where} ORDER BY severity DESC, created_at DESC`,
      [businessId]
    );
    res.json(rows.rows);
  } catch (err) { next(err); }
};

exports.dismissAlert = async (req, res, next) => {
  const { businessId, alertId } = req.params;
  try {
    await pool.query(
      'UPDATE business_health_alerts SET is_dismissed=TRUE, dismissed_at=NOW() WHERE id=$1 AND business_id=$2',
      [alertId, businessId]
    );
    res.json({ success: true });
  } catch (err) { next(err); }
};

exports.generateAlerts = async (req, res, next) => {
  const { businessId } = req.params;
  try {
    const alerts = [];

    // Check: no reviews in 30 days
    const reviewCheck = await pool.query(
      `SELECT COUNT(*) FROM business_reviews WHERE business_id=$1 AND created_at > NOW() - INTERVAL '30 days'`,
      [businessId]
    );
    if (parseInt(reviewCheck.rows[0].count) === 0) {
      alerts.push({ alert_type: 'no_recent_reviews', severity: 'info', title: 'No recent reviews', message: 'You have not received any reviews in the past 30 days. Consider sending review requests to recent customers.' });
    }

    // Check: low average rating
    const ratingCheck = await pool.query(
      'SELECT AVG(rating) AS avg FROM business_reviews WHERE business_id=$1',
      [businessId]
    );
    if (ratingCheck.rows[0].avg && parseFloat(ratingCheck.rows[0].avg) < 3.5) {
      alerts.push({ alert_type: 'low_rating', severity: 'warning', title: 'Low average rating', message: `Your average rating is ${parseFloat(ratingCheck.rows[0].avg).toFixed(1)}. Respond to reviews and improve service quality.` });
    }

    // Check: overdue invoices
    const invoiceCheck = await pool.query(
      `SELECT COUNT(*) FROM business_invoices WHERE business_id=$1 AND status='overdue'`,
      [businessId]
    );
    if (parseInt(invoiceCheck.rows[0].count) > 0) {
      alerts.push({ alert_type: 'overdue_invoices', severity: 'warning', title: 'Overdue invoices', message: `You have ${invoiceCheck.rows[0].count} overdue invoice(s). Follow up with customers to collect payment.` });
    }

    // Upsert all alerts
    for (const a of alerts) {
      await pool.query(
        `INSERT INTO business_health_alerts (business_id, alert_type, severity, title, message)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (business_id, alert_type) DO UPDATE SET severity=$3, title=$4, message=$5, is_dismissed=FALSE, updated_at=NOW()`,
        [businessId, a.alert_type, a.severity, a.title, a.message]
      );
    }

    const updated = await pool.query(
      'SELECT * FROM business_health_alerts WHERE business_id=$1 AND is_dismissed=FALSE ORDER BY severity DESC',
      [businessId]
    );
    res.json(updated.rows);
  } catch (err) { next(err); }
};
