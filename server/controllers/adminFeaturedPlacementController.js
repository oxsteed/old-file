'use strict';

/**
 * Admin controller for the featured placement lifecycle (migration 677).
 *
 * Businesses request featured placement from the promote page
 * (POST /api/businesses/:businessId/featured-placement-requests), but nothing
 * fulfilled those requests. This controller closes the loop: admins review
 * requests, approve them onto a specific restaurant with a rank and a
 * time-boxed window, decline them, or revoke an active feature.
 *
 * GET  /api/admin/featured-placements?status=requested|contacted|approved|declined|closed|all
 * GET  /api/admin/featured-placements/featured
 * POST /api/admin/featured-placements/:id/contact
 * POST /api/admin/featured-placements/:id/approve   {restaurantId, rank?, days?, note?}
 * POST /api/admin/featured-placements/:id/decline   {note?}
 * POST /api/admin/featured-placements/:id/revoke
 *
 * All routes sit behind requireAdmin (see routes/adminFeaturedPlacement.js).
 * Every mutation runs in a transaction and records decided_by_id /
 * decided_at / decision_note. Logs carry IDs only, never PII.
 */

const pool = require('../db');
const logger = require('../utils/logger');
const AppError = require('../utils/appError');

// Stateless effective-featured predicate: expiry is evaluated in the query,
// so no sweeper job is needed. NULL featured_until = open-ended feature.
const EFFECTIVE_FEATURED_SQL =
  `(fr.is_featured AND (fr.featured_until IS NULL OR fr.featured_until > NOW()))`;

const REQUEST_STATUSES = ['requested', 'contacted', 'approved', 'declined', 'closed'];

function parseRequestId(value) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function parseRestaurantId(value) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function parseRank(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 1000) {
    throw new AppError('Validation failed', 400, 'validation_failed', {
      rank: 'Rank must be an integer between 0 and 1000',
    });
  }
  return n;
}

function parseDays(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 365) {
    throw new AppError('Validation failed', 400, 'validation_failed', {
      days: 'Days must be an integer between 1 and 365',
    });
  }
  return n;
}

function normalizeNote(value) {
  if (value === undefined || value === null) return null;
  const note = String(value).trim();
  if (note.length > 1000) {
    throw new AppError('Validation failed', 400, 'validation_failed', {
      note: 'Note must be at most 1000 characters',
    });
  }
  return note === '' ? null : note;
}

function adminId(req) {
  return req.user && req.user.id ? req.user.id : null;
}

function formatRequest(row, restaurantsByBusiness) {
  return {
    id: Number(row.id),
    businessId: Number(row.business_id),
    businessName: row.business_name || null,
    requestedById: row.requested_by_id ? String(row.requested_by_id) : null,
    requesterEmail: row.requester_email || null,
    category: row.category || null,
    zip: row.zip || null,
    note: row.note || null,
    source: row.source || null,
    status: row.status,
    restaurants: restaurantsByBusiness.get(Number(row.business_id)) || [],
    decidedById: row.decided_by_id ? String(row.decided_by_id) : null,
    decidedAt: row.decided_at || null,
    decisionNote: row.decision_note || null,
    featuredRestaurantId: row.featured_restaurant_id != null ? Number(row.featured_restaurant_id) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function formatRestaurant(row) {
  return {
    id: Number(row.id),
    businessId: Number(row.business_id),
    name: row.display_name || null,
    isFeatured: Boolean(row.is_featured),
    featuredRank: row.featured_rank != null ? Number(row.featured_rank) : null,
    featuredUntil: row.featured_until || null,
  };
}

async function loadRestaurantsByBusiness(businessIds) {
  if (!businessIds.length) return new Map();
  const { rows } = await pool.query(
    `SELECT fr.id, fr.business_id, fr.display_name, fr.is_featured,
            fr.featured_rank, fr.featured_until
       FROM food_restaurants fr
      WHERE fr.business_id = ANY($1)
      ORDER BY fr.business_id, fr.display_name`,
    [businessIds]
  );
  const byBusiness = new Map();
  for (const row of rows) {
    const key = Number(row.business_id);
    if (!byBusiness.has(key)) byBusiness.set(key, []);
    byBusiness.get(key).push(formatRestaurant(row));
  }
  return byBusiness;
}

/**
 * GET /api/admin/featured-placements?status=...&limit=..&offset=..
 * Review queue: requests joined with their business, the business's
 * restaurants, and the requester's email. Newest first.
 */
exports.listRequests = async (req, res) => {
  const rawStatus = String(req.query.status || 'all').toLowerCase();
  if (rawStatus !== 'all' && !REQUEST_STATUSES.includes(rawStatus)) {
    throw new AppError('Validation failed', 400, 'validation_failed', {
      status: `Status must be one of: ${['all', ...REQUEST_STATUSES].join(', ')}`,
    });
  }
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 30, 1), 100);
  const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);

  const { rows } = await pool.query(
    `SELECT r.id, r.business_id, r.requested_by_id, r.category, r.zip, r.note,
            r.source, r.status, r.created_at, r.updated_at, r.decided_by_id,
            r.decided_at, r.decision_note, r.featured_restaurant_id,
            b.business_name,
            u.email AS requester_email
       FROM business_featured_placement_requests r
       JOIN businesses b ON b.id = r.business_id
       LEFT JOIN users u ON u.id = r.requested_by_id
      WHERE ($1 = 'all' OR r.status = $1)
      ORDER BY r.created_at DESC
      LIMIT $2 OFFSET $3`,
    [rawStatus, limit, offset]
  );

  const businessIds = [...new Set(rows.map((r) => Number(r.business_id)))];
  const restaurantsByBusiness = await loadRestaurantsByBusiness(businessIds);

  res.json({
    requests: rows.map((row) => formatRequest(row, restaurantsByBusiness)),
    limit,
    offset,
    status: rawStatus,
  });
};

/**
 * GET /api/admin/featured-placements/featured
 * Currently effectively-featured restaurants (the live featured set).
 */
exports.listFeatured = async (req, res) => {
  const { rows } = await pool.query(
    `SELECT fr.id, fr.business_id, fr.display_name, fr.is_featured,
            fr.featured_rank, fr.featured_until, b.business_name
       FROM food_restaurants fr
       JOIN businesses b ON b.id = fr.business_id
      WHERE ${EFFECTIVE_FEATURED_SQL}
      ORDER BY fr.featured_rank ASC, fr.avg_rating DESC NULLS LAST, fr.display_name ASC`
  );
  res.json({
    featured: rows.map((row) => ({
      ...formatRestaurant(row),
      businessName: row.business_name || null,
    })),
  });
};

/**
 * POST /api/admin/featured-placements/:id/contact
 * Marks a request as contacted (admin reached out to the business).
 */
exports.contactRequest = async (req, res) => {
  const id = parseRequestId(req.params.id);
  if (!id) throw new AppError('Validation failed', 400, 'validation_failed', { id: 'Invalid request id' });

  const { rows } = await pool.query(
    `UPDATE business_featured_placement_requests
        SET status = 'contacted', updated_at = NOW()
      WHERE id = $1
      RETURNING id, status`,
    [id]
  );
  if (!rows.length) throw new AppError('Featured placement request not found', 404, 'not_found');

  logger.info('admin featured placement contacted', { request_id: id, admin_id: adminId(req) });
  res.json({ id, status: rows[0].status });
};

/**
 * POST /api/admin/featured-placements/:id/decline {note?}
 * Declines a request, recording the admin decision audit trail.
 */
exports.declineRequest = async (req, res) => {
  const id = parseRequestId(req.params.id);
  if (!id) throw new AppError('Validation failed', 400, 'validation_failed', { id: 'Invalid request id' });
  const note = normalizeNote(req.body && req.body.note);

  const { rows } = await pool.query(
    `UPDATE business_featured_placement_requests
        SET status = 'declined',
            decided_by_id = $2,
            decided_at = NOW(),
            decision_note = $3,
            updated_at = NOW()
      WHERE id = $1
      RETURNING id, status`,
    [id, adminId(req), note]
  );
  if (!rows.length) throw new AppError('Featured placement request not found', 404, 'not_found');

  logger.info('admin featured placement declined', { request_id: id, admin_id: adminId(req) });
  res.json({ id, status: rows[0].status });
};

/**
 * POST /api/admin/featured-placements/:id/approve {restaurantId, rank?, days?, note?}
 * Features a restaurant in one transaction: sets the flag, rank, and
 * time-boxed window, and records the decision on the request.
 */
exports.approveRequest = async (req, res) => {
  const id = parseRequestId(req.params.id);
  if (!id) throw new AppError('Validation failed', 400, 'validation_failed', { id: 'Invalid request id' });

  const restaurantId = parseRestaurantId(req.body && (req.body.restaurantId ?? req.body.restaurant_id));
  if (!restaurantId) {
    throw new AppError('Validation failed', 400, 'validation_failed', {
      restaurantId: 'restaurantId is required and must be a positive integer',
    });
  }
  const rank = parseRank(req.body && req.body.rank, 10);
  const days = parseDays(req.body && req.body.days, 30);
  const note = normalizeNote(req.body && req.body.note);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: reqRows } = await client.query(
      `SELECT id, business_id, status, featured_restaurant_id
         FROM business_featured_placement_requests
        WHERE id = $1
        FOR UPDATE`,
      [id]
    );
    if (!reqRows.length) {
      throw new AppError('Featured placement request not found', 404, 'not_found');
    }
    const request = reqRows[0];

    const { rows: restRows } = await client.query(
      `SELECT id, business_id, is_featured, featured_until
         FROM food_restaurants
        WHERE id = $1
        FOR UPDATE`,
      [restaurantId]
    );
    if (!restRows.length) {
      throw new AppError('Restaurant not found', 404, 'not_found');
    }
    const restaurant = restRows[0];
    if (Number(restaurant.business_id) !== Number(request.business_id)) {
      throw new AppError('Restaurant does not belong to the requesting business', 400, 'validation_failed');
    }

    const effectivelyFeatured =
      restaurant.is_featured &&
      (restaurant.featured_until == null || new Date(restaurant.featured_until) > new Date());
    const sameRequestReapprove =
      request.status === 'approved' && Number(request.featured_restaurant_id) === Number(restaurantId);
    if (effectivelyFeatured && !sameRequestReapprove) {
      throw new AppError('Restaurant is already featured', 409, 'already_featured');
    }

    const { rows: updated } = await client.query(
      `UPDATE food_restaurants
          SET is_featured = TRUE,
              featured_rank = $2,
              featured_until = NOW() + make_interval(days => $3)
        WHERE id = $1
        RETURNING id, is_featured, featured_rank, featured_until`,
      [restaurantId, rank, days]
    );

    await client.query(
      `UPDATE business_featured_placement_requests
          SET status = 'approved',
              decided_by_id = $2,
              decided_at = NOW(),
              decision_note = $3,
              featured_restaurant_id = $4,
              updated_at = NOW()
        WHERE id = $1`,
      [id, adminId(req), note, restaurantId]
    );

    await client.query('COMMIT');
    logger.info('admin featured placement approved', {
      request_id: id,
      restaurant_id: restaurantId,
      rank,
      days,
      admin_id: adminId(req),
    });
    res.status(200).json({
      id,
      status: 'approved',
      restaurant: formatRestaurant(updated[0]),
    });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      logger.error('admin featured placement approve rollback failed', {
        request_id: id,
        error: rollbackErr.message,
      });
    }
    throw err;
  } finally {
    client.release();
  }
};

/**
 * POST /api/admin/featured-placements/:id/revoke
 * Ends an active feature: clears the flag and expiry, closes the request.
 * 404 when nothing is currently featured under the request.
 */
exports.revokeRequest = async (req, res) => {
  const id = parseRequestId(req.params.id);
  if (!id) throw new AppError('Validation failed', 400, 'validation_failed', { id: 'Invalid request id' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: reqRows } = await client.query(
      `SELECT id, featured_restaurant_id
         FROM business_featured_placement_requests
        WHERE id = $1
        FOR UPDATE`,
      [id]
    );
    if (!reqRows.length) {
      throw new AppError('Featured placement request not found', 404, 'not_found');
    }
    const request = reqRows[0];

    let restaurantId = request.featured_restaurant_id != null ? Number(request.featured_restaurant_id) : null;
    if (restaurantId) {
      const { rows: restRows } = await client.query(
        `SELECT id FROM food_restaurants
          WHERE id = $1
            AND is_featured
            AND (featured_until IS NULL OR featured_until > NOW())
          FOR UPDATE`,
        [restaurantId]
      );
      if (!restRows.length) restaurantId = null;
    }

    if (!restaurantId) {
      throw new AppError('Nothing is currently featured under this request', 404, 'not_found');
    }

    await client.query(
      `UPDATE food_restaurants
          SET is_featured = FALSE,
              featured_until = NULL
        WHERE id = $1`,
      [restaurantId]
    );
    await client.query(
      `UPDATE business_featured_placement_requests
          SET status = 'closed',
              decided_by_id = $2,
              decided_at = NOW(),
              updated_at = NOW()
        WHERE id = $1`,
      [id, adminId(req)]
    );

    await client.query('COMMIT');
    logger.info('admin featured placement revoked', {
      request_id: id,
      restaurant_id: restaurantId,
      admin_id: adminId(req),
    });
    res.json({ id, status: 'closed', restaurantId });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      logger.error('admin featured placement revoke rollback failed', {
        request_id: id,
        error: rollbackErr.message,
      });
    }
    throw err;
  } finally {
    client.release();
  }
};
