const db          = require('../db');
const { logAdminAction } = require('../services/auditService');
const { sendNotification } = require('../services/notificationService');

// Helper: check if a table exists
async function tableExists(name) {
  try {
    const { rows } = await db.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1",
      [name]
    );
    return rows.length > 0;
  } catch { return false; }
}

// ─── Regular Admin Dashboard Stats ───────────────────────────
exports.getDashboardStats = async (req, res) => {
  try {
    const hasJobs = await tableExists('jobs');
    const hasReports = await tableExists('content_reports');

    const { rows } = await db.query(`
      SELECT
        ${hasJobs ? "(SELECT COUNT(*) FROM jobs WHERE status = 'published')" : '0'}
          AS open_jobs,
        ${hasJobs ? "(SELECT COUNT(*) FROM jobs WHERE status = 'in_progress')" : '0'}
          AS active_jobs,
        ${hasJobs ? "(SELECT COUNT(*) FROM jobs WHERE status = 'disputed')" : '0'}
          AS open_disputes,
        ${hasReports ? "(SELECT COUNT(*) FROM content_reports WHERE status = 'pending')" : '0'}
          AS pending_reports,
        (SELECT COUNT(*) FROM users
          WHERE created_at >= now() - interval '7 days'
            AND role NOT IN ('admin','super_admin'))
          AS new_users_7d,
        ${hasJobs ? "(SELECT COUNT(*) FROM jobs WHERE created_at >= now() - interval '7 days')" : '0'}
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
    if (!(await tableExists('content_reports'))) {
      return res.json({ reports: [], total: 0, page: 1, limit: 25 });
    }
    const { status = 'pending', page = 1, limit = 25 } = req.query;
    const offset = (page - 1) * limit;

    const { rows } = await db.query(`
      SELECT
        cr.*,
        u_reporter.first_name || ' ' || u_reporter.last_name AS reporter_name,
        u_reporter.email AS reporter_email,
        u_reviewed.first_name || ' ' || u_reviewed.last_name AS reviewed_by_name
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
      total: parseInt(countRows[0].count),
      page: parseInt(page),
      limit: parseInt(limit)
    });
  } catch (err) {
    console.error('getReports error:', err);
    res.status(500).json({ error: 'Failed to fetch reports.' });
  }
};

// ─── Content Reports: Review ──────────────────────────────────
exports.reviewReport = async (req, res) => {
  if (!(await tableExists('content_reports'))) {
    return res.status(400).json({ error: 'Content reports table not available.' });
  }
  const dbClient = await db.connect();
  try {
    await dbClient.query('BEGIN');

    const { reportId } = req.params;
    const { action, action_taken } = req.body;
    const adminId = req.user.id;

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

    await dbClient.query(`
      UPDATE content_reports
      SET status = $1,
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

    if (action === 'remove_content') {
      if (report.target_type === 'job' && await tableExists('jobs')) {
        await dbClient.query(`
          UPDATE jobs
          SET status = 'cancelled',
              cancellation_reason = 'Removed by moderation',
              updated_at = now()
          WHERE id = $1
        `, [report.target_id]);
      }
      if (report.target_type === 'review' && await tableExists('reviews')) {
        await dbClient.query(`
          UPDATE reviews
          SET is_public = false, updated_at = now()
          WHERE id = $1
        `, [report.target_id]);
      }
    }

    let notificationSent = false;
    if (action === 'warn_user' && report.target_id) {
      try {
        let offendingUserId = null;

        // Use db pool (not dbClient) for these read-only lookups so a failed
        // query cannot abort the surrounding transaction.
        switch (report.target_type) {
          case 'user':
            offendingUserId = report.target_id;
            break;
          case 'job': {
            const { rows } = await db.query(
              'SELECT client_id FROM jobs WHERE id = $1', [report.target_id]
            );
            offendingUserId = rows[0]?.client_id || null;
            break;
          }
          case 'review': {
            const { rows } = await db.query(
              'SELECT reviewer_id FROM reviews WHERE id = $1', [report.target_id]
            );
            offendingUserId = rows[0]?.reviewer_id || null;
            break;
          }
          case 'bid': {
            const { rows } = await db.query(
              'SELECT helper_id FROM bids WHERE id = $1', [report.target_id]
            );
            offendingUserId = rows[0]?.helper_id || null;
            break;
          }
          default:
            console.warn(`reviewReport: unknown target_type "${report.target_type}" for report ${report.id}, skipping notification`);
        }

        if (offendingUserId) {
          await sendNotification({
            userId: offendingUserId,
            type: 'content_warning',
            title: 'Content warning issued',
            body: 'A warning has been added to your account regarding reported content.',
          });
          notificationSent = true;
        }
      } catch (e) {
        console.warn('reviewReport: failed to send warn_user notification:', e.message);
        // Do not re-throw — notification failure must not abort the report review.
      }
    }

    await dbClient.query('COMMIT');

    try {
      await logAdminAction({
        adminId,
        action: `report_${action}`,
        targetType: report.target_type,
        targetId: report.target_id,
        description: action_taken || null,
        req
      });
    } catch(e) {}

    if (action === 'warn_user') {
      return res.json({
        message: notificationSent
          ? 'Report reviewed and warning notification sent.'
          : 'Report reviewed. Warning notification could not be sent — content may have been deleted or the user was not found.',
        notificationSent,
      });
    }
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
    if (!(await tableExists('jobs')) || !(await tableExists('content_reports')) || !(await tableExists('categories'))) {
      return res.json({ queue: [] });
    }
    const { rows } = await db.query(`
      SELECT
        j.id, j.title, j.description, j.status,
        j.created_at, j.media_urls,
        c.name AS category_name,
        u.first_name || ' ' || u.last_name AS client_name,
        u.email AS client_email,
        COUNT(cr.id) AS report_count
      FROM jobs j
      JOIN users u ON j.client_id = u.id
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
    if (!(await tableExists('markets'))) {
      return res.json({ markets: [] });
    }
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
    if (!(await tableExists('markets'))) {
      return res.status(400).json({ error: 'Markets table not available.' });
    }
    const { marketId } = req.params;
    const { zipCodes } = req.body;

    if (!Array.isArray(zipCodes) || zipCodes.length === 0) {
      return res.status(400).json({ error: 'zipCodes must be a non-empty array.' });
    }
    const invalidZips = zipCodes.filter(z => !/^\d{5}$/.test(z));
    if (invalidZips.length > 0) {
      return res.status(400).json({ error: `Invalid zip codes: ${invalidZips.join(', ')}` });
    }

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

    try {
      await logAdminAction({
        adminId: req.user.id,
        action: 'add_zip_codes',
        targetType: 'market',
        targetId: marketId,
        description: `Added ${zipCodes.length} zip codes`,
        req
      });
    } catch(e) {}

    res.json({ market: rows[0] });
  } catch (err) {
    console.error('addZipCodes error:', err);
    res.status(500).json({ error: 'Failed to add zip codes.' });
  }
};

exports.removeZipCodes = async (req, res) => {
  try {
    if (!(await tableExists('markets'))) {
      return res.status(400).json({ error: 'Markets table not available.' });
    }
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

    try {
      await logAdminAction({
        adminId: req.user.id,
        action: 'remove_zip_codes',
        targetType: 'market',
        targetId: marketId,
        description: `Removed ${zipCodes.length} zip codes`,
        req
      });
    } catch(e) {}

    res.json({ market: rows[0] });
  } catch (err) {
    console.error('removeZipCodes error:', err);
    res.status(500).json({ error: 'Failed to remove zip codes.' });
  }
};

// ─── Content Management ───────────────────────────────────────
// GET /admin/content?type=bids|reviews&page=1&limit=25&search=
exports.getContent = async (req, res) => {
  try {
    const { type = 'bids', page = 1, limit = 25, search = '', status = '' } = req.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * Math.min(parseInt(limit) || 25, 100);

    if (type === 'bids') {
      if (!(await tableExists('bids'))) return res.json({ items: [], total: 0 });
      const params = []; let paramIdx = 1; let conditions = [];
      if (search) { conditions.push(`(b.message ILIKE $${paramIdx} OR j.title ILIKE $${paramIdx})`); params.push(`%${search}%`); paramIdx++; }
      if (status) { conditions.push(`b.status = $${paramIdx++}`); params.push(status); }
      const wc = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await db.query(`
        SELECT b.id, b.job_id, b.amount, b.message, b.status, b.created_at,
               j.title AS job_title,
               u.first_name || ' ' || u.last_name AS helper_name, u.email AS helper_email
        FROM bids b
        JOIN jobs j ON b.job_id = j.id
        JOIN users u ON b.helper_id = u.id
        ${wc}
        ORDER BY b.created_at DESC
        LIMIT $${paramIdx++} OFFSET $${paramIdx++}
      `, [...params, Math.min(parseInt(limit) || 25, 100), offset]);
      const { rows: countRows } = await db.query(`SELECT COUNT(*) FROM bids b JOIN jobs j ON b.job_id = j.id ${wc}`, params);
      return res.json({ items: rows, total: parseInt(countRows[0].count), type: 'bids' });
    }

    if (type === 'reviews') {
      if (!(await tableExists('reviews'))) return res.json({ items: [], total: 0 });
      const params = []; let paramIdx = 1; let conditions = [];
      if (search) { conditions.push(`(r.comment ILIKE $${paramIdx} OR j.title ILIKE $${paramIdx})`); params.push(`%${search}%`); paramIdx++; }
      if (status === 'hidden') conditions.push(`r.is_public = false`);
      else if (status === 'visible') conditions.push(`r.is_public = true`);
      const wc = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await db.query(`
        SELECT r.id, r.job_id, r.rating, r.comment, r.is_public, r.created_at,
               j.title AS job_title,
               u_r.first_name || ' ' || u_r.last_name AS reviewer_name, u_r.email AS reviewer_email,
               u_e.first_name || ' ' || u_e.last_name AS reviewee_name
        FROM reviews r
        JOIN jobs j ON r.job_id = j.id
        JOIN users u_r ON r.reviewer_id = u_r.id
        JOIN users u_e ON r.reviewee_id = u_e.id
        ${wc}
        ORDER BY r.created_at DESC
        LIMIT $${paramIdx++} OFFSET $${paramIdx++}
      `, [...params, Math.min(parseInt(limit) || 25, 100), offset]);
      const { rows: countRows } = await db.query(`SELECT COUNT(*) FROM reviews r JOIN jobs j ON r.job_id = j.id ${wc}`, params);
      return res.json({ items: rows, total: parseInt(countRows[0].count), type: 'reviews' });
    }

    res.status(400).json({ error: 'type must be bids or reviews' });
  } catch (err) {
    console.error('getContent error:', err);
    res.status(500).json({ error: 'Failed to fetch content.' });
  }
};

// POST /admin/bids/:bidId/remove
exports.removeBid = async (req, res) => {
  try {
    if (!(await tableExists('bids'))) return res.status(400).json({ error: 'Bids table not available.' });
    const { bidId } = req.params;
    const { reason } = req.body;
    if (!reason?.trim()) return res.status(400).json({ error: 'Removal reason is required.' });
    const { rows: before } = await db.query('SELECT b.*, j.title AS job_title FROM bids b JOIN jobs j ON b.job_id = j.id WHERE b.id = $1', [bidId]);
    if (!before.length) return res.status(404).json({ error: 'Bid not found.' });
    if (before[0].status === 'removed') return res.status(400).json({ error: 'Bid already removed.' });
    await db.query(`UPDATE bids SET status = 'removed', updated_at = NOW() WHERE id = $1`, [bidId]);
    await logAdminAction({
      adminId: req.user.id,
      action: 'bid_removed',
      targetType: 'bid',
      targetId: bidId,
      description: reason.trim(),
      before: { status: before[0].status, job_title: before[0].job_title },
      after:  { status: 'removed' },
      req,
    });
    res.json({ message: 'Bid removed successfully.' });
  } catch (err) {
    console.error('removeBid error:', err);
    res.status(500).json({ error: 'Failed to remove bid.' });
  }
};

// POST /admin/reviews/:reviewId/remove
exports.removeReview = async (req, res) => {
  try {
    if (!(await tableExists('reviews'))) return res.status(400).json({ error: 'Reviews table not available.' });
    const { reviewId } = req.params;
    const { reason } = req.body;
    if (!reason?.trim()) return res.status(400).json({ error: 'Removal reason is required.' });
    const { rows: before } = await db.query('SELECT r.*, j.title AS job_title FROM reviews r JOIN jobs j ON r.job_id = j.id WHERE r.id = $1', [reviewId]);
    if (!before.length) return res.status(404).json({ error: 'Review not found.' });
    if (!before[0].is_public) return res.status(400).json({ error: 'Review is already hidden.' });
    await db.query(`UPDATE reviews SET is_public = false, updated_at = NOW() WHERE id = $1`, [reviewId]);
    await logAdminAction({
      adminId: req.user.id,
      action: 'review_removed',
      targetType: 'review',
      targetId: reviewId,
      description: reason.trim(),
      before: { is_public: true, rating: before[0].rating, job_title: before[0].job_title },
      after:  { is_public: false },
      req,
    });
    res.json({ message: 'Review hidden successfully.' });
  } catch (err) {
    console.error('removeReview error:', err);
    res.status(500).json({ error: 'Failed to hide review.' });
  }
};

// POST /admin/reviews/:reviewId/restore  (undo a hide)
exports.restoreReview = async (req, res) => {
  try {
    if (!(await tableExists('reviews'))) return res.status(400).json({ error: 'Reviews table not available.' });
    const { reviewId } = req.params;
    const { rows } = await db.query('SELECT id, is_public FROM reviews WHERE id = $1', [reviewId]);
    if (!rows.length) return res.status(404).json({ error: 'Review not found.' });
    if (rows[0].is_public) return res.status(400).json({ error: 'Review is already visible.' });
    await db.query(`UPDATE reviews SET is_public = true, updated_at = NOW() WHERE id = $1`, [reviewId]);
    await logAdminAction({
      adminId: req.user.id,
      action: 'review_restored',
      targetType: 'review',
      targetId: reviewId,
      req,
    });
    res.json({ message: 'Review restored.' });
  } catch (err) {
    console.error('restoreReview error:', err);
    res.status(500).json({ error: 'Failed to restore review.' });
  }
};
