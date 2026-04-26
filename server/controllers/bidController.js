const pool = require('../db');
const logger = require('../utils/logger');
const { withTransaction } = require('../utils/transaction');

// Create a bid on a job
exports.createBid = async (req, res) => {
  try {
    const { job_id, amount, message, estimated_hours } = req.body;

    const job = await pool.query('SELECT * FROM jobs WHERE id = $1', [job_id]);
    if (!job.rows[0]) return res.status(404).json({ error: 'Job not found' });
    if (job.rows[0].client_id === req.user.id) return res.status(400).json({ error: 'Cannot bid on your own job' });
    if (!['published', 'matched'].includes(job.rows[0].status)) return res.status(400).json({ error: 'Job is not accepting bids' });

    // Check for existing bid
    const existing = await pool.query('SELECT * FROM bids WHERE job_id = $1 AND helper_id = $2', [job_id, req.user.id]);
    if (existing.rows[0]) return res.status(400).json({ error: 'You already placed a bid on this job' });

    // Create bid and update job status atomically
    const result = await withTransaction(pool, async (client) => {
      const bidResult = await client.query(
        'INSERT INTO bids (job_id, helper_id, amount, message, eta_hours) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [job_id, req.user.id, amount, message, estimated_hours]
      );

      // Update job status to matched if first bid
      await client.query(`UPDATE jobs SET status = 'matched', updated_at = NOW() WHERE id = $1 AND status = 'published'`, [job_id]);

      return bidResult.rows[0];
    });

    res.status(201).json(result);
  } catch (err) {
    logger.error('Create bid error', { userId: req.user?.id, jobId: req.body?.job_id, error: err.message });
    res.status(500).json({ error: 'Failed to create bid' });
  }
};

// Get bids for a job
exports.getJobBids = async (req, res) => {
  try {
    // Only the job's client or an admin may view all bids
    const jobCheck = await pool.query(
      'SELECT client_id FROM jobs WHERE id = $1', [req.params.jobId]
    );
    if (!jobCheck.rows[0]) return res.status(404).json({ error: 'Job not found' });
    const isAdmin = ['admin', 'super_admin'].includes(req.user.role);
    const isClient = jobCheck.rows[0].client_id === req.user.id;

    // Pagination — cap at 100 to prevent DoS on jobs with many bids
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit)  || 50));
    const offset = Math.max(0,              parseInt(req.query.offset) || 0);

    // Admins and the job client see all bids.
    // Helpers see only their own bid (so the UI can compute hasAlreadyBid).
    const helperFilter = (!isAdmin && !isClient) ? 'AND b.helper_id = $2' : '';
    const baseParams = helperFilter ? [req.params.jobId, req.user.id] : [req.params.jobId];
    const paginationParams = [...baseParams, limit, offset];
    const limitIdx  = baseParams.length + 1;
    const offsetIdx = baseParams.length + 2;

    const result = await pool.query(
      `SELECT b.id, b.job_id, b.helper_id, b.amount, b.message, b.status,
              b.eta_hours, b.created_at, b.updated_at,
              u.first_name as helper_name, hp.profile_photo_url as helper_avatar,
              hp.avg_rating as helper_rating,
              (SELECT COUNT(*) FROM jobs WHERE assigned_helper_id = b.helper_id AND status = 'completed') as jobs_completed
      FROM bids b
      JOIN users u ON b.helper_id = u.id
      LEFT JOIN helper_profiles hp ON hp.user_id = b.helper_id
      WHERE b.job_id = $1 ${helperFilter}
      ORDER BY b.created_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      paginationParams
    );
    res.json(result.rows);
  } catch (err) {
    logger.error('Get job bids error', { jobId: req.params?.jobId, userId: req.user?.id, error: err.message });
    res.status(500).json({ error: 'Failed to fetch bids' });
  }
};

// Get my bids (as helper)
exports.getMyBids = async (req, res) => {
  try {
    const { status } = req.query;
    let query = `SELECT b.*, j.title as job_title, j.category_name as job_category, j.status as job_status, j.location_city, j.location_state
      FROM bids b JOIN jobs j ON b.job_id = j.id WHERE b.helper_id = $1`;
    const params = [req.user.id];
    if (status) { query += ' AND b.status = $2'; params.push(status); }
    query += ' ORDER BY b.created_at DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    logger.error('Get my bids error', { userId: req.user?.id, error: err.message });
    res.status(500).json({ error: 'Failed to fetch bids' });
  }
};

// Update bid
exports.updateBid = async (req, res) => {
  try {
    const bidId = req.params.id;
    const userId = req.user.id;
    const { amount, message, eta_hours } = req.body;

    // Pre-check: bid must exist and belong to requester (outside transaction)
    const { rows: bidRows } = await pool.query(
      'SELECT id, helper_id, status FROM bids WHERE id = $1',
      [bidId]
    );

    if (!bidRows[0]) {
      return res.status(404).json({ error: 'Bid not found' });
    }

    const bid = bidRows[0];

    if (bid.helper_id !== userId) {
      return res.status(403).json({ error: 'Not authorized to update this bid' });
    }

    if (bid.status !== 'pending') {
      return res.status(400).json({
        error: `Bid cannot be updated in '${bid.status}' state. Only pending bids can be updated.`
      });
    }

    // Atomic: update bid with status safeguard to prevent race conditions
    const result = await withTransaction(pool, async (client) => {
      const { rows } = await client.query(
        `UPDATE bids
         SET
           amount = COALESCE($1, amount),
           message = COALESCE($2, message),
           eta_hours = COALESCE($3, eta_hours),
           updated_at = NOW()
         WHERE id = $4 AND status = 'pending'
         RETURNING *`,
        [amount, message, eta_hours, bidId]
      );

      if (!rows.length) {
        throw new Error('Bid state changed during update — status is no longer pending');
      }

      return rows[0];
    }, 'update_bid');

    logger.info('Bid updated', {
      bidId,
      userId,
      fieldsUpdated: [
        amount !== undefined && 'amount',
        message !== undefined && 'message',
        eta_hours !== undefined && 'eta_hours'
      ].filter(Boolean)
    });

    res.json(result);
  } catch (err) {
    logger.error('Update bid error', { bidId: req.params?.id, userId: req.user?.id, error: err.message });
    res.status(500).json({ error: 'Failed to update bid' });
  }
};

// Withdraw bid
exports.withdrawBid = async (req, res) => {
  try {
    const bidId = req.params.id;
    const userId = req.user.id;

    // Pre-check: bid must exist and belong to requester (outside transaction)
    const { rows: bidRows } = await pool.query(
      'SELECT id, job_id, helper_id, status FROM bids WHERE id = $1',
      [bidId]
    );

    if (!bidRows[0]) {
      return res.status(404).json({ error: 'Bid not found' });
    }

    const bid = bidRows[0];

    if (bid.helper_id !== userId) {
      return res.status(403).json({ error: 'Not authorized to withdraw this bid' });
    }

    if (bid.status !== 'pending') {
      return res.status(400).json({
        error: `Bid cannot be withdrawn in '${bid.status}' state. Only pending bids can be withdrawn.`
      });
    }

    // Atomic: withdraw bid with status safeguard to prevent race conditions
    const result = await withTransaction(pool, async (client) => {
      const { rows } = await client.query(
        `UPDATE bids
         SET status = 'withdrawn', withdrawn_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND status = 'pending'
         RETURNING *`,
        [bidId]
      );

      if (!rows.length) {
        throw new Error('Bid state changed during withdrawal — status is no longer pending');
      }

      return rows[0];
    }, 'withdraw_bid');

    logger.info('Bid withdrawn', {
      bidId,
      userId,
      jobId: bid.job_id
    });

    res.json(result);
  } catch (err) {
    logger.error('Withdraw bid error', { bidId: req.params?.id, userId: req.user?.id, error: err.message });
    res.status(500).json({ error: 'Failed to withdraw bid' });
  }
};

// Get recent bids (public, for homepage)
exports.getRecentBids = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT b.id, b.amount, b.created_at,
        j.title as job_title, j.location_city, j.location_state,
        u.first_name, LEFT(u.last_name, 1) as last_initial,
        hp.avg_rating, hp.is_licensed, hp.is_insured, hp.is_verified
      FROM bids b
      JOIN jobs j ON b.job_id = j.id
      JOIN users u ON b.helper_id = u.id
      LEFT JOIN helper_profiles hp ON hp.user_id = b.helper_id
      WHERE b.status = 'pending' AND j.status IN ('published', 'matched')
      ORDER BY b.created_at DESC
      LIMIT 6`
    );
    res.json(result.rows);
  } catch (err) {
    logger.error('Get recent bids error', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch recent bids' });
  }
};
