/**
 * loyaltyTiersController.js
 * CRUD for business_loyalty_tiers + customer listing per tier.
 * Mounted under /businesses/:businessId via businessOperations.js.
 */
const pool = require('../db');
const AppError = require('../utils/appError');

// ── helpers ───────────────────────────────────────────────────────────────────

function parseTier(row) {
  return {
    ...row,
    discount_percent: parseFloat(row.discount_percent) || 0,
    min_points: parseInt(row.min_points, 10) || 0,
    benefits: Array.isArray(row.benefits) ? row.benefits : [],
    customer_count: parseInt(row.customer_count, 10) || 0,
  };
}

// ── GET /businesses/:businessId/loyalty-tiers ─────────────────────────────────

async function listLoyaltyTiers(req, res, next) {
  const { businessId } = req.params;
  try {
    const result = await pool.query(
      `SELECT lt.*,
              COALESCE(
                (SELECT COUNT(*)::int
                 FROM customer_business_profile cbp
                 WHERE cbp.business_id = $1
                   AND cbp.loyalty_tier = lt.tier_name),
                0
              ) AS customer_count
       FROM business_loyalty_tiers lt
       WHERE lt.business_id = $1
       ORDER BY lt.min_points ASC`,
      [businessId]
    );
    res.json(result.rows.map(parseTier));
  } catch (err) {
    next(err);
  }
}

// ── POST /businesses/:businessId/loyalty-tiers ────────────────────────────────

async function createLoyaltyTier(req, res, next) {
  const { businessId } = req.params;
  const { tier_name, discount_percent, min_points, benefits } = req.body;

  if (!tier_name) {
    return next(new AppError('tier_name is required', 400, 'validation_failed'));
  }
  if (discount_percent < 0 || discount_percent > 100) {
    return next(new AppError('discount_percent must be 0–100', 400, 'validation_failed'));
  }

  try {
    const result = await pool.query(
      `INSERT INTO business_loyalty_tiers
         (business_id, tier_name, discount_percent, min_points, benefits)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [businessId, tier_name, discount_percent || 0, min_points || 0, benefits || []]
    );
    res.status(201).json(parseTier({ ...result.rows[0], customer_count: 0 }));
  } catch (err) {
    if (err.code === '23505') {
      return next(new AppError(`A ${tier_name} tier already exists for this business`, 409, 'conflict'));
    }
    next(err);
  }
}

// ── PUT /businesses/:businessId/loyalty-tiers/:tierId ────────────────────────

async function updateLoyaltyTier(req, res, next) {
  const { businessId, tierId } = req.params;
  const { tier_name, discount_percent, min_points, benefits } = req.body;

  if (!tier_name) {
    return next(new AppError('tier_name is required', 400, 'validation_failed'));
  }

  try {
    const result = await pool.query(
      `UPDATE business_loyalty_tiers
       SET tier_name       = $1,
           discount_percent = $2,
           min_points       = $3,
           benefits         = $4,
           updated_at       = NOW()
       WHERE id = $5 AND business_id = $6
       RETURNING *`,
      [tier_name, discount_percent || 0, min_points || 0, benefits || [], tierId, businessId]
    );
    if (!result.rows.length) {
      return next(new AppError('Loyalty tier not found', 404, 'not_found'));
    }
    // Re-fetch customer_count
    const count = await pool.query(
      `SELECT COUNT(*)::int AS n FROM customer_business_profile
       WHERE business_id = $1 AND loyalty_tier = $2`,
      [businessId, result.rows[0].tier_name]
    );
    res.json(parseTier({ ...result.rows[0], customer_count: count.rows[0]?.n || 0 }));
  } catch (err) {
    if (err.code === '23505') {
      return next(new AppError(`A ${tier_name} tier already exists for this business`, 409, 'conflict'));
    }
    next(err);
  }
}

// ── DELETE /businesses/:businessId/loyalty-tiers/:tierId ─────────────────────

async function deleteLoyaltyTier(req, res, next) {
  const { businessId, tierId } = req.params;
  try {
    await pool.query(
      `DELETE FROM business_loyalty_tiers WHERE id = $1 AND business_id = $2`,
      [tierId, businessId]
    );
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

// ── GET /businesses/:businessId/loyalty/tier/:tierId/customers ────────────────

async function listTierCustomers(req, res, next) {
  const { businessId, tierId } = req.params;
  try {
    // Resolve tier_name from the tier id
    const tierResult = await pool.query(
      `SELECT tier_name FROM business_loyalty_tiers WHERE id = $1 AND business_id = $2`,
      [tierId, businessId]
    );
    if (!tierResult.rows.length) return res.json([]);
    const tierName = tierResult.rows[0].tier_name;

    const customers = await pool.query(
      `SELECT u.id,
              COALESCE(u.display_name, TRIM(u.first_name || ' ' || u.last_name)) AS name,
              u.email,
              cbp.lifetime_bookings AS appointment_count,
              0                     AS loyalty_points
       FROM customer_business_profile cbp
       JOIN users u ON u.id = cbp.customer_id
       WHERE cbp.business_id = $1 AND cbp.loyalty_tier = $2
       ORDER BY cbp.lifetime_bookings DESC
       LIMIT 100`,
      [businessId, tierName]
    );
    res.json(customers.rows);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listLoyaltyTiers,
  createLoyaltyTier,
  updateLoyaltyTier,
  deleteLoyaltyTier,
  listTierCustomers,
};
