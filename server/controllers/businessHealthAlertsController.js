const pool = require('../db');
const { tNotif } = require('../utils/i18n');

// Maps alert_type to the i18n notification key.
const ALERT_TYPE_TO_I18N_KEY = {
  no_recent_reviews: 'health_alert_no_recent_reviews',
  low_rating:        'health_alert_low_rating',
  overdue_invoices:  'health_alert_overdue_invoices',
};

// Returns the requesting user's preferred language (falls back to 'en').
async function getUserLang(userId) {
  if (!userId) return 'en';
  try {
    const { rows } = await pool.query(
      'SELECT preferred_language FROM users WHERE id = $1',
      [userId]
    );
    return rows[0]?.preferred_language || 'en';
  } catch {
    return 'en';
  }
}

// Overlays localized title/message onto an alert row using its alert_type.
function localizeAlert(alert, lang) {
  const i18nKey = ALERT_TYPE_TO_I18N_KEY[alert.alert_type];
  if (!i18nKey) return alert;
  const { title, body } = tNotif(i18nKey, lang);
  return { ...alert, title: title || alert.title, message: body || alert.message };
}

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
    const lang = await getUserLang(req.user?.id);
    res.json(rows.rows.map((a) => localizeAlert(a, lang)));
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
      // Store canonical English — listAlerts will translate at read time.
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

    // Upsert all alerts (canonical English stored; translations applied at read time)
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
    const lang = await getUserLang(req.user?.id);
    res.json(updated.rows.map((a) => localizeAlert(a, lang)));
  } catch (err) { next(err); }
};
