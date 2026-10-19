const pool = require('../db');
const { withTransaction } = require('../utils/transaction');
const logger = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const discountService = require('../services/discountService');
const promoRedemption = require('../services/promoRedemptionService');

async function createDiscountCode(req, res, next) {
  try {
    const {
      code,
      description,
      discount_type,
      discount_amount,
      max_discount_cents,
      usage_limit,
      min_order_cents,
      max_order_cents,
      applicable_categories,
      applicable_products,
      start_date,
      end_date,
      per_user_limit,
      currency_code,
      applicable_surfaces
    } = req.body;

    const userId = req.user?.id;
    if (!userId) throw new AppError('Unauthorized', 401, 'auth_error');

    // Validation
    const errors = {};

    if (!code || typeof code !== 'string' || code.trim().length === 0) {
      errors.code = 'Required string';
    } else if (code.trim().length > 50) {
      errors.code = 'Maximum 50 characters';
    }

    if (!discount_type || !['percentage', 'fixed_cents'].includes(discount_type)) {
      errors.discount_type = 'Must be "percentage" or "fixed_cents"';
    }

    if (!discount_amount || discount_amount <= 0) {
      errors.discount_amount = 'Must be positive';
    }

    if (discount_type === 'percentage' && discount_amount > 100) {
      errors.discount_amount = 'Percentage cannot exceed 100';
    }

    const intOrNull = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
    for (const [field, value] of [['usage_limit', usage_limit], ['per_user_limit', per_user_limit],
      ['min_order_cents', min_order_cents], ['max_order_cents', max_order_cents], ['max_discount_cents', max_discount_cents]]) {
      const n = intOrNull(value);
      if (n !== null && (!Number.isSafeInteger(n) || n < 0)) errors[field] = 'Must be a non-negative integer';
    }
    if (discount_type === 'fixed_cents' && discount_amount && !Number.isSafeInteger(Number(discount_amount))) {
      errors.discount_amount = 'Fixed discounts are integer cents';
    }
    if (currency_code != null && currency_code !== '' && !/^[A-Za-z]{3}$/.test(String(currency_code))) {
      errors.currency_code = 'Must be a 3-letter ISO currency';
    }
    let surfaces = null;
    if (applicable_surfaces != null) {
      if (!Array.isArray(applicable_surfaces) || applicable_surfaces.length === 0
        || applicable_surfaces.some((x) => !promoRedemption.SURFACES.includes(x))) {
        errors.applicable_surfaces = `Must be a non-empty subset of ${promoRedemption.SURFACES.join(', ')}`;
      } else {
        surfaces = [...new Set(applicable_surfaces)];
      }
    }

    if (Object.keys(errors).length > 0) {
      throw new AppError('Validation failed', 400, 'validation_failed', errors);
    }

    const result = await pool.query(
      `INSERT INTO discount_codes
       (code, description, discount_type, discount_amount, max_discount_cents, usage_limit,
        min_order_cents, max_order_cents, applicable_categories, applicable_products,
        start_date, end_date, created_by, status, per_user_limit, currency_code, applicable_surfaces)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       RETURNING *`,
      [
        code.toUpperCase().trim(),
        description || null,
        discount_type,
        discount_amount,
        max_discount_cents || null,
        usage_limit || null,
        min_order_cents || 0,
        max_order_cents || null,
        applicable_categories || null,
        applicable_products || null,
        start_date || null,
        end_date || null,
        userId,
        'active',
        intOrNull(per_user_limit),
        currency_code ? String(currency_code).toUpperCase() : null,
        surfaces
      ]
    );

    logger.info('Discount code created', { codeId: result.rows[0].id, code });

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    next(error);
  }
}

async function updateDiscountCode(req, res, next) {
  try {
    const { codeId } = req.params;
    const { status, usage_limit, end_date, per_user_limit } = req.body;

    const code = await pool.query(
      'SELECT * FROM discount_codes WHERE id = $1',
      [codeId]
    );

    if (!code.rows.length) throw new AppError('Discount code not found', 404, 'not_found');

    const updates = [];
    const values = [codeId];
    let paramCount = 2;

    if (status !== undefined && ['active', 'inactive', 'expired'].includes(status)) {
      updates.push(`status = $${paramCount}`);
      values.push(status);
      paramCount++;
    }

    if (usage_limit !== undefined) {
      updates.push(`usage_limit = $${paramCount}`);
      values.push(usage_limit);
      paramCount++;
    }

    if (per_user_limit !== undefined) {
      const n = per_user_limit === null || per_user_limit === '' ? null : Number(per_user_limit);
      if (n !== null && (!Number.isSafeInteger(n) || n < 0)) {
        throw new AppError('Validation failed', 400, 'validation_failed', { per_user_limit: 'Must be a non-negative integer' });
      }
      updates.push(`per_user_limit = $${paramCount}`);
      values.push(n);
      paramCount++;
    }

    if (end_date !== undefined) {
      updates.push(`end_date = $${paramCount}`);
      values.push(end_date);
      paramCount++;
    }

    if (updates.length === 0) return res.json({ success: true, data: code.rows[0] });

    updates.push('updated_at = CURRENT_TIMESTAMP');
    const result = await pool.query(
      `UPDATE discount_codes SET ${updates.join(', ')} WHERE id = $1 RETURNING *`,
      values
    );

    logger.info('Discount code updated', { codeId });

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    next(error);
  }
}

async function getDiscountCodes(req, res, next) {
  try {
    const { status, skip = 0, limit = 50 } = req.query;

    let query = 'SELECT * FROM discount_codes WHERE 1=1';
    const params = [];

    if (status) {
      query += ` AND status = $${params.length + 1}`;
      params.push(status);
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, skip);

    const codes = await pool.query(query, params);

    res.json({
      success: true,
      data: codes.rows
    });
  } catch (error) {
    next(error);
  }
}

async function getDiscountStats(req, res, next) {
  try {
    const stats = await discountService.getDiscountStats();

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    next(error);
  }
}

async function getDiscountCodeUsage(req, res, next) {
  try {
    const { codeId } = req.params;

    // Checkout redemptions (decision 2) live in promo_redemptions; legacy
    // cart applications stay in order_discount_history.
    const usage = await pool.query(
      `SELECT
        dc.id, dc.code, dc.usage_count, dc.usage_limit, dc.per_user_limit,
        (SELECT COUNT(*)::INT FROM order_discount_history odh WHERE odh.discount_code_id = dc.id) AS applied_count,
        (SELECT COALESCE(SUM(odh.discount_applied_cents), 0)::BIGINT FROM order_discount_history odh
          WHERE odh.discount_code_id = dc.id) AS total_discount_given_cents,
        COALESCE((SELECT jsonb_object_agg(x.surface, x.stats) FROM (
          SELECT pr.surface, jsonb_build_object(
                   'redeemed', COUNT(*) FILTER (WHERE pr.status = 'redeemed'),
                   'reserved', COUNT(*) FILTER (WHERE pr.status = 'reserved'),
                   'reversed', COUNT(*) FILTER (WHERE pr.status = 'reversed'),
                   'discount_cents_by_currency', (
                     SELECT COALESCE(jsonb_object_agg(c.currency_code, c.cents), '{}'::jsonb) FROM (
                       SELECT p2.currency_code, SUM(p2.discount_cents)::BIGINT AS cents
                         FROM promo_redemptions p2
                        WHERE p2.discount_code_id = dc.id AND p2.surface = pr.surface AND p2.status = 'redeemed'
                        GROUP BY 1) c)) AS stats
            FROM promo_redemptions pr WHERE pr.discount_code_id = dc.id GROUP BY pr.surface) x), '{}'::jsonb)
          AS checkout_redemptions
       FROM discount_codes dc
       WHERE dc.id = $1`,
      [codeId]
    );

    if (!usage.rows.length) throw new AppError('Discount code not found', 404, 'not_found');

    res.json({
      success: true,
      data: usage.rows[0]
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createDiscountCode,
  updateDiscountCode,
  getDiscountCodes,
  getDiscountStats,
  getDiscountCodeUsage
};
