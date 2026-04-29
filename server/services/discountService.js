const pool = require('../db');
const logger = require('../utils/logger');

/**
 * Validate and apply a discount code
 * @param {string} code - Discount code
 * @param {number} subtotalCents - Order subtotal in cents
 * @param {string} category - Product category
 * @param {array} productIds - Product IDs in order
 * @returns {object} { isValid, discountCents, message }
 */
async function validateAndApplyDiscount(code, subtotalCents, category = null, productIds = []) {
  try {
    if (!code || typeof code !== 'string') {
      return { isValid: false, discountCents: 0, message: 'Invalid code format' };
    }

    const codeUpper = code.toUpperCase().trim();

    // Find the discount code
    const result = await pool.query(
      `SELECT * FROM discount_codes
       WHERE UPPER(code) = UPPER($1)
       AND status = 'active'
       AND (start_date IS NULL OR start_date <= CURRENT_TIMESTAMP)
       AND (end_date IS NULL OR end_date >= CURRENT_TIMESTAMP)`,
      [codeUpper]
    );

    if (!result.rows.length) {
      logger.warn('Discount code not found or inactive', { code: codeUpper });
      return { isValid: false, discountCents: 0, message: 'Code not found or expired' };
    }

    const discount = result.rows[0];

    // Check usage limit
    if (discount.usage_limit && discount.usage_count >= discount.usage_limit) {
      logger.warn('Discount code usage limit exceeded', { code: codeUpper, used: discount.usage_count, limit: discount.usage_limit });
      return { isValid: false, discountCents: 0, message: 'Code has reached usage limit' };
    }

    // Check minimum order value
    if (discount.min_order_cents && subtotalCents < discount.min_order_cents) {
      return {
        isValid: false,
        discountCents: 0,
        message: `Minimum order: $${(discount.min_order_cents / 100).toFixed(2)}`
      };
    }

    // Check maximum order value
    if (discount.max_order_cents && subtotalCents > discount.max_order_cents) {
      return {
        isValid: false,
        discountCents: 0,
        message: `Maximum order: $${(discount.max_order_cents / 100).toFixed(2)}`
      };
    }

    // Check category eligibility
    if (discount.applicable_categories && discount.applicable_categories.length > 0) {
      if (!category || !discount.applicable_categories.includes(category)) {
        return { isValid: false, discountCents: 0, message: 'Code not applicable to this category' };
      }
    }

    // Check product eligibility
    if (discount.applicable_products && discount.applicable_products.length > 0) {
      const hasEligible = productIds.some(id => discount.applicable_products.includes(id));
      if (!hasEligible) {
        return { isValid: false, discountCents: 0, message: 'Code not applicable to items in cart' };
      }
    }

    // Calculate discount amount
    let discountCents = 0;

    if (discount.discount_type === 'fixed_cents') {
      discountCents = Math.min(discount.discount_amount, subtotalCents);
    } else if (discount.discount_type === 'percentage') {
      discountCents = Math.round(subtotalCents * (discount.discount_amount / 100));
      // Apply max discount cap if set
      if (discount.max_discount_cents) {
        discountCents = Math.min(discountCents, discount.max_discount_cents);
      }
    }

    // Ensure discount doesn't exceed subtotal
    discountCents = Math.min(discountCents, subtotalCents);

    logger.info('Discount code validated and applied', {
      code: codeUpper,
      type: discount.discount_type,
      discountCents,
      subtotalCents
    });

    return {
      isValid: true,
      discountCents,
      codeId: discount.id,
      message: `Discount applied: -$${(discountCents / 100).toFixed(2)}`
    };
  } catch (error) {
    logger.error('Error validating discount code', { error, code });
    return { isValid: false, discountCents: 0, message: 'Error validating code' };
  }
}

/**
 * Record discount usage
 */
async function recordDiscountUsage(orderId, discountCodeId, discountAppliedCents, code) {
  try {
    // Record the discount on the order
    await pool.query(
      `INSERT INTO order_discount_history (order_id, discount_code_id, code, discount_applied_cents)
       VALUES ($1, $2, $3, $4)`,
      [orderId, discountCodeId, code, discountAppliedCents]
    );

    // Increment usage count
    await pool.query(
      `UPDATE discount_codes SET usage_count = usage_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [discountCodeId]
    );

    logger.debug('Discount usage recorded', { orderId, codeId: discountCodeId, discountCents: discountAppliedCents });
  } catch (error) {
    logger.error('Error recording discount usage', { error, orderId, discountCodeId });
    // Don't fail the order if this fails
  }
}

/**
 * Get discount code stats for admin dashboard
 */
async function getDiscountStats() {
  try {
    const stats = await pool.query(`
      SELECT
        COUNT(*) as total_codes,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_codes,
        SUM(usage_count) as total_uses,
        SUM(COALESCE((
          SELECT COALESCE(SUM(discount_applied_cents), 0)
          FROM order_discount_history odh
          WHERE odh.discount_code_id = dc.id
        ), 0)) as total_discount_given_cents
      FROM discount_codes dc
    `);

    return stats.rows[0] || {
      total_codes: 0,
      active_codes: 0,
      total_uses: 0,
      total_discount_given_cents: 0
    };
  } catch (error) {
    logger.error('Error fetching discount stats', { error });
    return null;
  }
}

module.exports = {
  validateAndApplyDiscount,
  recordDiscountUsage,
  getDiscountStats
};
