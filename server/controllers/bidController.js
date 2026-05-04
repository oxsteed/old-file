const pool = require('../db');
const logger = require('../utils/logger');
const { withTransaction } = require('../utils/transaction');
const { AppError } = require('../middleware/errorHandler');

// Create a bid on a job
exports.createBid = async (req, res, next) => {
  try {
    const { job_id, amount, message, estimated_hours } = req.body;

    // Input validation
    const fields = {};
    if (!job_id) fields.job_id = 'Job ID is required';
    if (amount !== undefined && (isNaN(Number(amount)) || Number(amount) <= 0)) {
      fields.amount = 'Amount must be a positive number';
    }
    if (message !== undefined && typeof message === 'string' && message.trim().length === 0) {
      fields.message = 'Message cannot be empty';
    }
    if (Object.keys(fields).length > 0) {
      throw new AppError('Validation failed', 400, 'validation_failed', fields);
    }

    const job = await pool.query('SELECT * FROM jobs WHERE id = $1', [job_id]);
    if (!job.rows[0]) {
      throw new AppError('Job not found', 404, 'job_not_found');
    }
    if (job.rows[0].client_id === req.user.id) {
      throw new AppError('Cannot bid on your own job', 400, 'self_bid_not_allowed');
    }
    if (!['published', 'matched'].includes(job.rows[0].status)) {
      throw new AppError('Job is not accepting bids', 400, 'job_not_accepting_bids');
    }

    // Create bid (duplicate check inside transaction to prevent race condition)
    const result = await withTransaction(pool, async (client) => {
      // Check for existing bid inside the transaction to avoid race window
      const existing = await client.query(
        'SELECT id FROM bids WHERE job_id = $1 AND helper_id = $2 FOR UPDATE',
        [job_id, req.user.id]
      );
      if (existing.rows.length > 0) {
        const err = new Error('You already placed a bid on this job');
        err.status = 409;
        throw err;
      }

      const bidResult = await client.query(
        'INSERT INTO bids (job_id, helper_id, amount, message, eta_hours) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [job_id, req.user.id, amount, message !== undefined ? message.trim() : message, estimated_hours]
      );

      // NOTE: Job status intentionally NOT changed here.
      // A job remains 'published' (visible on the job board) until the customer
      // explicitly accepts a bid via assignHelper(). Multiple helpers should be
      // able to discover and bid on the same job concurrently.

      return bidResult.rows[0];
    });

    res.status(201).json(result);
  } catch (err) {
    if (err.message === 'You already placed a bid on this job') {
      next(new AppError(err.message, 409, 'bid_already_exists'));
    } else {
      next(err);
    }
  }
};

// Get bids for a job
exports.getJobBids = async (req, res, next) => {
  try {
    // Only the job's client or an admin may view all bids
    const jobCheck = await pool.query(
      'SELECT client_id FROM jobs WHERE id = $1', [req.params.jobId]
    );
    if (!jobCheck.rows[0]) {
      throw new AppError('Job not found', 404, 'job_not_found');
    }
    const isAdmin = ['admin', 'super_admin'].includes(req.user.role);
    const isClient = jobCheck.rows[0].client_id === req.user.id;

    // Pagination - cap at 100 to prevent DoS on jobs with many bids
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
    next(err);
  }
};

// Get my bids (as helper)
exports.getMyBids = async (req, res, next) => {
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
    next(err);
  }
};

// Update bid
exports.updateBid = async (req, res, next) => {
  try {
    const { amount, message, eta_hours } = req.body;
    const bidId = req.params.id;
    const userId = req.user.id;

    // Pre-check: bid must exist and belong to requester (outside transaction)
    const { rows: bidRows } = await pool.query(
      'SELECT id, helper_id, status FROM bids WHERE id = $1',
      [bidId]
    );

    if (!bidRows[0]) {
      throw new AppError('Bid not found', 404, 'bid_not_found');
    }

    const bid = bidRows[0];

    if (bid.helper_id !== userId) {
      throw new AppError('Not authorized to update this bid', 403, 'forbidden');
    }

    if (bid.status !== 'pending') {
      throw new AppError(`Bid cannot be updated in '${bid.status}' state. Only pending bids can be updated.`, 400, 'invalid_bid_state');
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
        throw new Error('Bid state changed during update - status is no longer pending');
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
    next(err);
  }
};

// Withdraw bid
exports.withdrawBid = async (req, res, next) => {
  try {
    const bidId = req.params.id;
    const userId = req.user.id;

    // Pre-check: bid must exist and belong to requester (outside transaction)
    const { rows: bidRows } = await pool.query(
      'SELECT id, job_id, helper_id, status FROM bids WHERE id = $1',
      [bidId]
    );

    if (!bidRows[0]) {
      throw new AppError('Bid not found', 404, 'bid_not_found');
    }

    const bid = bidRows[0];

    if (bid.helper_id !== userId) {
      throw new AppError('Not authorized to withdraw this bid', 403, 'forbidden');
    }

    if (bid.status !== 'pending') {
      throw new AppError(`Bid cannot be withdrawn in '${bid.status}' state. Only pending bids can be withdrawn.`, 400, 'invalid_bid_state');
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
        throw new Error('Bid state changed during withdrawal - status is no longer pending');
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
    next(err);
  }
};

// Get recent bids (public, for homepage)
exports.getRecentBids = async (req, res, next) => {
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
    next(err);
  }
};
