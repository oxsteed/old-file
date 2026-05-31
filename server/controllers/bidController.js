const pool = require('../db');
const logger = require('../utils/logger');
const { withTransaction } = require('../utils/transaction');
const { AppError } = require('../middleware/errorHandler');
const { sendNotification } = require('../services/notificationService');

// Create a bid on a job
exports.createBid = async (req, res, next) => {
  try {
    const { job_id, amount, message, eta_hours } = req.body;
    const estimated_hours = req.body.estimated_hours ?? eta_hours;

    // Input validation
    const fields = {};
    if (!job_id) fields.job_id = 'Job ID is required';
    // Amount is required to place a bid - "let's discuss" is not a valid quote.
    if (amount === undefined || amount === null || amount === '') {
      fields.amount = 'Amount is required';
    } else if (isNaN(Number(amount)) || Number(amount) <= 0) {
      fields.amount = 'Amount must be a positive number';
    } else if (Number(amount) > 10_000_000) {
      // Sanity cap - prevents fat-finger / overflow
      fields.amount = 'Amount is too large';
    }
    if (message !== undefined && typeof message === 'string') {
      if (message.trim().length === 0) {
        fields.message = 'Message cannot be empty';
      } else if (message.length > 2000) {
        fields.message = 'Message must be 2000 characters or fewer';
      }
    }
    if (estimated_hours !== undefined && estimated_hours !== null && estimated_hours !== '') {
      const eh = Number(estimated_hours);
      if (isNaN(eh) || eh <= 0 || eh > 480) {
        fields.estimated_hours = 'Estimated hours must be between 0 and 480';
      }
    }
    if (Object.keys(fields).length > 0) {
      throw new AppError('Validation failed', 400, 'validation_failed', fields);
    }

    const job = await pool.query(
      'SELECT id, client_id, status, deleted_at FROM jobs WHERE id = $1',
      [job_id]
    );
    if (!job.rows[0] || job.rows[0].deleted_at) {
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
      // FOR UPDATE locks any matching row so two concurrent createBid() calls
      // from the same helper cannot both insert.
      const existing = await client.query(
        'SELECT id FROM bids WHERE job_id = $1 AND helper_id = $2 FOR UPDATE',
        [job_id, req.user.id]
      );
      if (existing.rows.length > 0) {
        throw new AppError('You already placed a bid on this job', 409, 'bid_already_exists');
      }

      const bidResult = await client.query(
        'INSERT INTO bids (job_id, helper_id, amount, message, eta_hours) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [job_id, req.user.id, amount, message !== undefined ? message.trim() : message, estimated_hours]
      );

      // Job status intentionally NOT changed here - jobs remain 'published'
      // until the customer accepts a bid via assignHelper().
      return bidResult.rows[0];
    });

    res.status(201).json(result);

    // Notify the job owner that a new bid arrived (non-blocking, after response)
    try {
      const jobRow = await pool.query(
        `SELECT j.client_id, j.title, u.first_name AS helper_name
         FROM jobs j JOIN users u ON u.id = $1
         WHERE j.id = $2`,
        [req.user.id, result.job_id]
      );
      if (jobRow.rows[0]) {
        const { client_id, title, helper_name } = jobRow.rows[0];
        await sendNotification({
          userId: client_id,
          type: 'bid_received',
          title: 'New Bid on Your Job',
          body: `${helper_name} placed a bid of $${Number(result.amount).toFixed(2)} on "${title}"`,
          data: { job_id: result.job_id, bid_id: result.id },
          action_url: `/jobs/${result.job_id}`,
        });
      }
    } catch (notifErr) {
      logger.warn('Failed to send bid notification', { error: notifErr.message });
    }
  } catch (err) {
    next(err);
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

// Get my bids (as helper) - paginated
exports.getMyBids = async (req, res, next) => {
  try {
    const { status } = req.query;
    const VALID_BID_STATUSES = ['pending', 'accepted', 'rejected', 'withdrawn'];
    if (status && !VALID_BID_STATUSES.includes(status)) {
      throw new AppError('Invalid bid status', 400, 'validation_failed', {
        status: `status must be one of ${VALID_BID_STATUSES.join(', ')}`,
      });
    }

    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit, 10)  || 50));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

    const params = [req.user.id];
    let where = 'WHERE b.helper_id = $1 AND j.deleted_at IS NULL';
    if (status) {
      params.push(status);
      where += ` AND b.status = $${params.length}`;
    }

    params.push(limit, offset);
    const limitIdx  = params.length - 1;
    const offsetIdx = params.length;

    const result = await pool.query(
      `SELECT b.*, j.title as job_title, j.category_name as job_category,
              j.status as job_status, j.location_city, j.location_state
         FROM bids b
         JOIN jobs j ON b.job_id = j.id
         ${where}
         ORDER BY b.created_at DESC
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params
    );

    // Compatibility: legacy clients call /bids/me and expect a bare array.
    // We keep the array as the response body but expose total via headers.
    const countParams = status ? [req.user.id, status] : [req.user.id];
    const countWhere = status
      ? 'WHERE b.helper_id = $1 AND j.deleted_at IS NULL AND b.status = $2'
      : 'WHERE b.helper_id = $1 AND j.deleted_at IS NULL';
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) FROM bids b JOIN jobs j ON b.job_id = j.id ${countWhere}`,
      countParams
    );
    res.set('X-Total-Count', String(countRows[0].count));
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
        throw new AppError('Bid state changed during update - status is no longer pending', 409, 'state_conflict');
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

    const result = await withTransaction(pool, async (client) => {
      const { rows } = await client.query(
        `UPDATE bids
         SET status = 'withdrawn', withdrawn_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND status = 'pending'
         RETURNING *`,
        [bidId]
      );

      if (!rows.length) {
        throw new AppError('Bid state changed during withdrawal - status is no longer pending', 409, 'state_conflict');
      }

      return rows[0];
    }, 'withdraw_bid');

    logger.info('Bid withdrawn', { bidId, userId, jobId: bid.job_id });
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
