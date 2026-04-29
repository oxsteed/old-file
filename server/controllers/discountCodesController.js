const pool = require('../db');
const { withTransaction } = require('../utils/transaction');
const logger = require('../utils/logger');
const { sendError, sendValidationError } = require('../utils/apiError');
const discountService = require('../services/discountService');

async function createDiscountCode(req, res) {
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
      end_date
    } = req.body;

    const userId = req.user?.id;
    if (!userId) return sendError(res, 401, 'Unauthorized');

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

    if (Object.keys(errors).length > 0) {
      return sendValidationError(res, errors);
    }

    const result = await pool.query(
      `INSERT INTO discount_codes
       (code, description, discount_type, discount_amount, max_discount_cents, usage_limit,
        min_order_cents, max_order_cents, applicable_categories, applicable_products,
        start_date, end_date, created_by, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
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
        'active'
      ]
    );

    logger.info('Discount code created', { codeId: result.rows[0].id, code });

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    logger.error('Error creating discount code', { error });
    sendError(res, 500, 'Failed to create discount code');
  }
}

async function updateDiscountCode(req, res) {
  try {
    const { codeId } = req.params;
    const { status, usage_limit, end_date } = req.body;

    const code = await pool.query(
      'SELECT * FROM discount_codes WHERE id = $1',
      [codeId]
    );

    if (!code.rows.length) return sendError(res, 404, 'Discount code not found');

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
    logger.error('Error updating discount code', { error });
    sendError(res, 500, 'Failed to update discount code');
  }
}

async function getDiscountCodes(req, res) {
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
    logger.error('Error fetching discount codes', { error });
    sendError(res, 500, 'Failed to fetch discount codes');
  }
}

async function getDiscountStats(req, res) {
  try {
    const stats = await discountService.getDiscountStats();

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    logger.error('Error fetching discount stats', { error });
    sendError(res, 500, 'Failed to fetch discount stats');
  }
}

async function getDiscountCodeUsage(req, res) {
  try {
    const { codeId } = req.params;

    const usage = await pool.query(
      `SELECT
        dc.id, dc.code, dc.usage_count, dc.usage_limit,
        COUNT(odh.id) as applied_count,
        SUM(odh.discount_applied_cents) as total_discount_given_cents
       FROM discount_codes dc
       LEFT JOIN order_discount_history odh ON dc.id = odh.discount_code_id
       WHERE dc.id = $1
       GROUP BY dc.id, dc.code, dc.usage_count, dc.usage_limit`,
      [codeId]
    );

    if (!usage.rows.length) return sendError(res, 404, 'Discount code not found');

    res.json({
      success: true,
      data: usage.rows[0]
    });
  } catch (error) {
    logger.error('Error fetching discount usage', { error });
    sendError(res, 500, 'Failed to fetch discount usage');
  }
}

module.exports = {
  createDiscountCode,
  updateDiscountCode,
  getDiscountCodes,
  getDiscountStats,
  getDiscountCodeUsage
};
