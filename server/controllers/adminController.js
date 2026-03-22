const db               = require('../db');
const { logAdminAction } = require('../services/auditService');
const { sendNotification } = require('../services/notificationService');

// ─── Regular Admin Dashboard Stats ───────────────────────────
exports.getDashboardStats = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM jobs WHERE status = 'published')
          AS open_jobs,
        (SELECT COUNT(*) FROM jobs WHERE status = 'in_progress')
          AS active_jobs,
        (SELECT COUNT(*) FROM jobs WHERE status = 'disputed')
          AS open_disputes,
        (SELECT COUNT(*) FROM content_reports WHERE status = 'pending')
          AS pending_reports,
        (SELECT COUNT(*) FROM users
         WHERE created_at >= now() - interval '7 days'
           AND role NOT IN ('admin','super_admin'))
          AS new_users_7d,
        (SELECT COUNT(*) FROM jobs
         WHERE created_at >= now() - interval '7 days')
          AS new_jobs_7d
    `);

    res.json({ stats: rows[0] });
  } catch (err) {
    console.error('admin getDashboardStats error:', err);
    res.status(500).json({ error: 'Failed to load stats.' });
  }
};

// ─── Content Reports: List ────────────────────────────────────
exports.getReports = async (req, res) => {
  try {
    const { status = 'pending', page = 1, limit = 25 } = req.query;
    const offset = (page - 1) * limit;

    const { rows } = await db.query(`
      SELECT
        cr.*,
        u_reporter.first_name || ' ' || u_reporter.last_name AS reporter_name,
        u_reporter.email                                       AS reporter_email,
        u_reviewed.first_name || ' ' || u_reviewed.last_name  AS reviewed_by_name
      FROM content_reports cr
      LEFT JOIN users u_reporter ON cr.reporter_id = u_reporter.id
      LEFT JOIN users u_reviewed ON cr.reviewed_by = u_reviewed.id
      WHERE cr.status = $1
      ORDER BY cr.created_at ASC
      LIMIT $2 OFFSET $3
    `, [status, limit, offset]);

    const { rows: countRows } = await db.query(
      `SELECT COUNT(*) FROM content_reports WHERE status = $1`, [status]
    );

    res.json({
      reports: rows,
      total:   parseInt(countRows[0].count),
      page:    parseInt(page),
      limit:   parseInt(limit)
    });
  } catch (err) {
    console.error('getReports error:', err);
    res.status(500).json({ error: 'Failed to fetch reports.' });
  }
};

// ─── Content Reports: Review ──────────────────────────────────
exports.reviewReport = async (req, res) => {
  const dbClient = await db.connect();
  try {
    await dbClient.query('BEGIN');

    const { reportId }             = req.params;
    const { action, action_taken } = req.body;
    const adminId                  = req.user.id;

    // Valid actions
    const allowed = ['dismiss','warn_user','remove_content','escalate'];
    if (!allowed.includes(action)) {
      return res.status(400).json({ error: 'Invalid action.' });
    }

    const { rows: reportRows } = await dbClient.query(
      `SELECT * FROM content_reports WHERE id = $1`, [reportId]
    );
    if (!reportRows.length) {
      return res.status(404).json({ error: 'Report not found.' });
    }

    const report = reportRows[0];

    // Mark report reviewed
    await dbClient.query(`
      UPDATE content_reports
      SET status      = $1,
          reviewed_by = $2,
          reviewed_at = now(),
          action_taken = $3
      WHERE id = $4
    `, [
      action === 'escalate' ? 'escalated' : 'reviewed',
      adminId,
      action_taken || action,
      reportId
    ]);

    // Take content action
    if (action === 'remove_content') {
      if (report.target_type === 'job') {
        await dbClient.query(`
          UPDATE jobs
          SET status = 'cancelled',
              cancellation_reason = 'Removed by moderation',
              updated_at = now()
          WHERE id = $1
        `, [report.target_id]);
      }
      if (report.target_type === 'review') {
        await dbClient.query(`
          UPDATE reviews
          SET is_visible = false, updated_at = now()
          WHERE id = $1
        `, [report.target_id]);
      }
    }

    if (action === 'warn_user' && report.reporter_id) {
      await sendNotification({
        userId: report.reporter_id,
        type:   'content_warning',
        title:  'Content warning issued',
        body:   'A warning has been added to your account regarding reported content.',
      });
    }

    await dbClient.query('COMMIT');

    await logAdminAction({
      adminId,
      action:     `report_${action}`,
      targetType: report.target_type,
      targetId:   report.target_id,
      description: action_taken || null,
      req
    });

    res.json({ message: `Report ${action} successfully.` });
  } catch (err) {
    await dbClient.query('ROLLBACK');
    console.error('reviewReport error:', err);
    res.status(500).json({ error: 'Failed to process report.' });
  } finally {
    dbClient.release();
  }
};

// ─── Jobs: moderation list ────────────────────────────────────
exports.getModerationQueue = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        j.id, j.title, j.description, j.status,
        j.created_at, j.media_urls,
        c.name AS category_name,
        u.first_name || ' ' || u.last_name AS client_name,
        u.email AS client_email,
        COUNT(cr.id) AS report_count
      FROM jobs j
      JOIN users u      ON j.client_id = u.id
      JOIN categories c ON j.category_id = c.id
      LEFT JOIN content_reports cr
        ON cr.target_type = 'job'
       AND cr.target_id = j.id
       AND cr.status = 'pending'
      WHERE j.status != 'cancelled'
        AND (
          j.metadata->>'admin_flagged' = 'true'
          OR EXISTS (
            SELECT 1 FROM content_reports cr2
            WHERE cr2.target_type = 'job'
              AND cr2.target_id = j.id
              AND cr2.status = 'pending'
          )
        )
      GROUP BY j.id, c.name, u.first_name, u.last_name, u.email
      ORDER BY report_count DESC, j.created_at ASC
    `);

    res.json({ queue: rows });
  } catch (err) {
    console.error('getModerationQueue error:', err);
    res.status(500).json({ error: 'Failed to fetch moderation queue.' });
  }
};

// —— Market Zip Code Management ————————————————————————————
exports.getMarkets = async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, name, state, zipcodes, active, launched_at FROM markets ORDER BY name'
    );
    res.json({ markets: rows });
  } catch (err) {
    console.error('getMarkets error:', err);
    res.status(500).json({ error: 'Failed to fetch markets.' });
  }
};

exports.addZipCodes = async (req, res) => {
  try {
    const { marketId } = req.params;
    const { zipCodes } = req.body;

    if (!Array.isArray(zipCodes) || zipCodes.length === 0) {
      return res.status(400).json({ error: 'zipCodes must be a non-empty array.' });
    }

    // Validate each zip code is 5 digits
    const invalidZips = zipCodes.filter(z => !/^\d{5}$/.test(z));
    if (invalidZips.length > 0) {
      return res.status(400).json({ error: `Invalid zip codes: ${invalidZips.join(', ')}` });
    }

    // Add new zip codes (merge with existing, no duplicates)
    const { rows } = await db.query(
      `UPDATE markets
       SET zipcodes = (
         SELECT ARRAY(SELECT DISTINCT unnest(zipcodes || $1::text[]))
       ),
       updated_at = NOW()
       WHERE id = $2
       RETURNING id, name, state, zipcodes, active`,
      [zipCodes, marketId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Market not found.' });
    }

    await logAdminAction(req.user.id, 'add_zip_codes', {
      marketId,
      addedZips: zipCodes,
      totalZips: rows[0].zipcodes.length
    });

    res.json({ market: rows[0] });
  } catch (err) {
    console.error('addZipCodes error:', err);
    res.status(500).json({ error: 'Failed to add zip codes.' });
  }
};

exports.removeZipCodes = async (req, res) => {
  try {
    const { marketId } = req.params;
    const { zipCodes } = req.body;

    if (!Array.isArray(zipCodes) || zipCodes.length === 0) {
      return res.status(400).json({ error: 'zipCodes must be a non-empty array.' });
    }

    const { rows } = await db.query(
      `UPDATE markets
       SET zipcodes = (
         SELECT ARRAY(SELECT unnest(zipcodes) EXCEPT SELECT unnest($1::text[]))
       ),
       updated_at = NOW()
       WHERE id = $2
       RETURNING id, name, state, zipcodes, active`,
      [zipCodes, marketId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Market not found.' });
    }

    await logAdminAction(req.user.id, 'remove_zip_codes', {
      marketId,
      removedZips: zipCodes,
      totalZips: rows[0].zipcodes.length
    });

    res.json({ market: rows[0] });
  } catch (err) {
    console.error('removeZipCodes error:', err);
    res.status(500).json({ error: 'Failed to remove zip codes.' });
  }
};
