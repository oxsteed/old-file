/**
 * Product Pricing Controller
 * Handles dynamic pricing for products including discounts, bundling, and bulk pricing
 *
 * Features:
 * - Volume-based discounts (bulk pricing tiers)
 * - Time-limited promotions and flash sales
 * - Bundle deals (buy X get Y discount)
 * - Category-wide discounts
 * - Customer segment pricing (VIP, wholesale, etc.)
 * - Cost-plus margin pricing
 * - Seasonal pricing adjustments
 * - Promotional codes with constraints
 *
 * Database:
 * - product_pricing_rules: Dynamic pricing rules with conditions
 * - product_promotions: Time-limited sales and discounts
 * - product_bundles: Multi-product bundle deals
 * - product_bulk_tiers: Volume-based pricing tiers
 * - product_pricing_history: Audit trail of pricing changes
 */

const { pool } = require('../db');
const { AppError } = require('../utils/apiError');
const { logger } = require('../utils/logger');
const { withTransaction } = require('../utils/transaction');

// ============================================================================
// Product Pricing Rules (Dynamic Pricing)
// ============================================================================

/**
 * List pricing rules for a business
 * GET /api/businesses/{businessId}/product-pricing/rules
 */
async function listPricingRules(req, res, next) {
  try {
    const { businessId } = req.params;
    const { page = 0, limit = 50 } = req.query;
    const userId = req.user.id;

    // Verify business ownership
    const bizCheck = await pool.query(
      'SELECT id FROM businesses WHERE id = $1 AND user_id = $2',
      [businessId, userId]
    );
    if (!bizCheck.rows.length) {
      throw new AppError('Unauthorized', 403, 'not_authorized');
    }

    const offset = page * limit;

    const result = await pool.query(
      `
      SELECT
        id, business_id, rule_name, rule_type, description,
        priority, is_active, applies_to, conditions_json, pricing_adjustment,
        start_date, end_date, created_at, updated_at
      FROM product_pricing_rules
      WHERE business_id = $1
      ORDER BY priority ASC, created_at DESC
      LIMIT $2 OFFSET $3
      `,
      [businessId, limit, offset]
    );

    const countResult = await pool.query(
      'SELECT COUNT(*) as total FROM product_pricing_rules WHERE business_id = $1',
      [businessId]
    );

    res.json({
      success: true,
      data: result.rows.map(r => ({
        id: r.id,
        name: r.rule_name,
        type: r.rule_type,
        description: r.description,
        priority: r.priority,
        isActive: r.is_active,
        appliesToType: r.applies_to, // 'product', 'category', 'all'
        adjustment: r.pricing_adjustment,
        startDate: r.start_date,
        endDate: r.end_date,
        createdAt: r.created_at,
      })),
      total: parseInt(countResult.rows[0].total),
      page,
      limit,
    });
  } catch (error) {
    logger.error('productPricingController.listPricingRules', { error });
    next(error);
  }
}

/**
 * Get a single pricing rule
 * GET /api/businesses/{businessId}/product-pricing/rules/{ruleId}
 */
async function getPricingRule(req, res, next) {
  try {
    const { businessId, ruleId } = req.params;

    const result = await pool.query(
      `
      SELECT * FROM product_pricing_rules
      WHERE id = $1 AND business_id = $2
      `,
      [ruleId, businessId]
    );

    if (!result.rows.length) {
      throw new AppError('Rule not found', 404, 'not_found');
    }

    const rule = result.rows[0];

    res.json({
      success: true,
      data: {
        id: rule.id,
        name: rule.rule_name,
        type: rule.rule_type,
        description: rule.description,
        priority: rule.priority,
        isActive: rule.is_active,
        appliesToType: rule.applies_to,
        appliesTo: rule.applies_to_id,
        conditions: rule.conditions_json,
        adjustment: rule.pricing_adjustment,
        startDate: rule.start_date,
        endDate: rule.end_date,
        createdAt: rule.created_at,
        updatedAt: rule.updated_at,
      },
    });
  } catch (error) {
    logger.error('productPricingController.getPricingRule', { error });
    next(error);
  }
}

/**
 * Create a pricing rule
 * POST /api/businesses/{businessId}/product-pricing/rules
 * Body: {
 *   name, type (volume|promotion|bundle|segment|seasonal),
 *   description, priority (1-100), appliesToType (product|category|all),
 *   appliesTo (product/category ID), conditions {}, adjustment {},
 *   startDate?, endDate?
 * }
 */
async function createPricingRule(req, res, next) {
  try {
    const { businessId } = req.params;
    const {
      name,
      type,
      description = '',
      priority = 50,
      appliesToType = 'product',
      appliesTo,
      conditions = {},
      adjustment = {},
      startDate,
      endDate,
    } = req.body;
    const userId = req.user.id;

    // Validate inputs
    if (!name || name.length === 0 || name.length > 200) {
      throw new AppError('Rule name required (1-200 chars)', 400, 'validation_failed');
    }

    const validTypes = ['volume', 'promotion', 'bundle', 'segment', 'seasonal'];
    if (!validTypes.includes(type)) {
      throw new AppError('Invalid rule type', 400, 'validation_failed');
    }

    if (typeof priority !== 'number' || priority < 1 || priority > 100) {
      throw new AppError('Priority must be 1-100', 400, 'validation_failed');
    }

    if (!['product', 'category', 'all'].includes(appliesToType)) {
      throw new AppError('Invalid applies_to type', 400, 'validation_failed');
    }

    // Verify business ownership
    const bizCheck = await pool.query(
      'SELECT id FROM businesses WHERE id = $1 AND user_id = $2',
      [businessId, userId]
    );
    if (!bizCheck.rows.length) {
      throw new AppError('Unauthorized', 403, 'not_authorized');
    }

    // Create rule
    const result = await pool.query(
      `
      INSERT INTO product_pricing_rules
      (business_id, rule_name, rule_type, description, priority,
       applies_to, applies_to_id, conditions_json, pricing_adjustment,
       start_date, end_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
      `,
      [
        businessId,
        name.trim(),
        type,
        description.trim(),
        priority,
        appliesToType,
        appliesTo || null,
        JSON.stringify(conditions),
        JSON.stringify(adjustment),
        startDate || null,
        endDate || null,
      ]
    );

    logger.info('Pricing rule created', { ruleId: result.rows[0].id, businessId });

    res.status(201).json({
      success: true,
      data: {
        id: result.rows[0].id,
        name: result.rows[0].rule_name,
        type: result.rows[0].rule_type,
        priority: result.rows[0].priority,
      },
    });
  } catch (error) {
    logger.error('productPricingController.createPricingRule', { error, body: req.body });
    next(error);
  }
}

/**
 * Update a pricing rule
 * PUT /api/businesses/{businessId}/product-pricing/rules/{ruleId}
 */
async function updatePricingRule(req, res, next) {
  try {
    const { businessId, ruleId } = req.params;
    const { name, description, priority, conditions, adjustment, isActive } = req.body;
    const userId = req.user.id;

    // Verify business ownership
    const bizCheck = await pool.query(
      'SELECT id FROM businesses WHERE id = $1 AND user_id = $2',
      [businessId, userId]
    );
    if (!bizCheck.rows.length) {
      throw new AppError('Unauthorized', 403, 'not_authorized');
    }

    const updates = [];
    const params = [ruleId, businessId];
    let paramIndex = 3;

    if (name !== undefined) {
      if (name.length === 0 || name.length > 200) {
        throw new AppError('Rule name required (1-200 chars)', 400, 'validation_failed');
      }
      updates.push(`rule_name = $${paramIndex}`);
      params.push(name.trim());
      paramIndex++;
    }

    if (description !== undefined) {
      updates.push(`description = $${paramIndex}`);
      params.push(description.trim());
      paramIndex++;
    }

    if (priority !== undefined) {
      if (typeof priority !== 'number' || priority < 1 || priority > 100) {
        throw new AppError('Priority must be 1-100', 400, 'validation_failed');
      }
      updates.push(`priority = $${paramIndex}`);
      params.push(priority);
      paramIndex++;
    }

    if (conditions !== undefined) {
      updates.push(`conditions_json = $${paramIndex}`);
      params.push(JSON.stringify(conditions));
      paramIndex++;
    }

    if (adjustment !== undefined) {
      updates.push(`pricing_adjustment = $${paramIndex}`);
      params.push(JSON.stringify(adjustment));
      paramIndex++;
    }

    if (isActive !== undefined) {
      updates.push(`is_active = $${paramIndex}`);
      params.push(isActive);
      paramIndex++;
    }

    if (updates.length === 0) {
      throw new AppError('No updates provided', 400, 'validation_failed');
    }

    const result = await pool.query(
      `UPDATE product_pricing_rules SET ${updates.join(', ')}, updated_at = now()
       WHERE id = $1 AND business_id = $2 RETURNING *`,
      params
    );

    if (!result.rows.length) {
      throw new AppError('Rule not found', 404, 'not_found');
    }

    logger.info('Pricing rule updated', { ruleId });

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    logger.error('productPricingController.updatePricingRule', { error });
    next(error);
  }
}

/**
 * Delete a pricing rule
 * DELETE /api/businesses/{businessId}/product-pricing/rules/{ruleId}
 */
async function deletePricingRule(req, res, next) {
  try {
    const { businessId, ruleId } = req.params;
    const userId = req.user.id;

    // Verify business ownership
    const bizCheck = await pool.query(
      'SELECT id FROM businesses WHERE id = $1 AND user_id = $2',
      [businessId, userId]
    );
    if (!bizCheck.rows.length) {
      throw new AppError('Unauthorized', 403, 'not_authorized');
    }

    await pool.query(
      'DELETE FROM product_pricing_rules WHERE id = $1 AND business_id = $2',
      [ruleId, businessId]
    );

    logger.info('Pricing rule deleted', { ruleId });

    res.json({ success: true, message: 'Rule deleted' });
  } catch (error) {
    logger.error('productPricingController.deletePricingRule', { error });
    next(error);
  }
}

// ============================================================================
// Price Calculation (Apply All Rules)
// ============================================================================

/**
 * Calculate final price for a product given context
 * POST /api/businesses/{businessId}/product-pricing/calculate
 * Body: {
 *   productId, quantity, customerId?, categoryId?, promoCode?
 * }
 */
async function calculatePrice(req, res, next) {
  try {
    const { businessId } = req.params;
    const { productId, quantity = 1, customerId, categoryId, promoCode } = req.body;

    if (!productId) {
      throw new AppError('Product ID required', 400, 'validation_failed');
    }

    // Get base product price
    const productResult = await pool.query(
      `SELECT price_cents, category FROM business_products
       WHERE id = $1 AND business_id = $2`,
      [productId, businessId]
    );

    if (!productResult.rows.length) {
      throw new AppError('Product not found', 404, 'not_found');
    }

    const basePrice = productResult.rows[0].price_cents / 100;
    const category = productResult.rows[0].category;

    // Get applicable pricing rules (ordered by priority)
    const rulesResult = await pool.query(
      `
      SELECT id, rule_type, conditions_json, pricing_adjustment
      FROM product_pricing_rules
      WHERE business_id = $1 AND is_active = true
      AND (applies_to IS NULL OR applies_to = 'all'
        OR (applies_to = 'product' AND applies_to_id = $2)
        OR (applies_to = 'category' AND applies_to_id = $3))
      AND (start_date IS NULL OR start_date <= now())
      AND (end_date IS NULL OR end_date >= now())
      ORDER BY priority ASC
      `,
      [businessId, productId, category]
    );

    let finalPrice = basePrice;
    const appliedRules = [];

    // Apply each rule in priority order
    for (const rule of rulesResult.rows) {
      const adjustment = rule.pricing_adjustment;

      // Evaluate rule conditions
      if (shouldApplyRule(rule, quantity, customerId)) {
        // Apply adjustment
        if (adjustment.type === 'percentage') {
          finalPrice *= 1 - adjustment.value / 100;
        } else if (adjustment.type === 'fixed') {
          finalPrice -= adjustment.value;
        } else if (adjustment.type === 'multiplier') {
          finalPrice *= adjustment.value;
        }

        appliedRules.push({
          ruleId: rule.id,
          type: rule.rule_type,
          adjustment: adjustment,
        });
      }
    }

    // Ensure price doesn't go negative
    finalPrice = Math.max(finalPrice, 0);

    res.json({
      success: true,
      data: {
        productId,
        basePrice,
        finalPrice: parseFloat(finalPrice.toFixed(2)),
        totalPrice: parseFloat((finalPrice * quantity).toFixed(2)),
        quantity,
        savings: parseFloat((basePrice - finalPrice).toFixed(2)),
        appliedRules,
      },
    });
  } catch (error) {
    logger.error('productPricingController.calculatePrice', { error });
    next(error);
  }
}

/**
 * Helper: Determine if a rule applies based on conditions
 */
function shouldApplyRule(rule, quantity, customerId) {
  const conditions = rule.conditions_json || {};

  // Volume-based: check minimum quantity
  if (rule.rule_type === 'volume' && conditions.minQuantity) {
    if (quantity < conditions.minQuantity) return false;
  }

  // Segment-based: check customer eligibility
  if (rule.rule_type === 'segment' && conditions.customerSegment) {
    // TODO: Implement customer segment check (VIP, wholesale, etc.)
    // For now, assume all customers eligible
  }

  return true;
}

// ============================================================================
// Bulk Pricing Tiers
// ============================================================================

/**
 * Set bulk pricing tiers for a product
 * POST /api/businesses/{businessId}/products/{productId}/bulk-pricing
 * Body: {
 *   tiers: [
 *     { minQuantity: 10, discountPercent: 5 },
 *     { minQuantity: 50, discountPercent: 10 },
 *   ]
 * }
 */
async function setBulkPricingTiers(req, res, next) {
  try {
    const { businessId, productId } = req.params;
    const { tiers } = req.body;
    const userId = req.user.id;

    // Validate inputs
    if (!Array.isArray(tiers) || tiers.length === 0) {
      throw new AppError('Tiers array required', 400, 'validation_failed');
    }

    // Verify business ownership
    const bizCheck = await pool.query(
      'SELECT id FROM businesses WHERE id = $1 AND user_id = $2',
      [businessId, userId]
    );
    if (!bizCheck.rows.length) {
      throw new AppError('Unauthorized', 403, 'not_authorized');
    }

    // Verify product exists
    const productCheck = await pool.query(
      'SELECT id FROM business_products WHERE id = $1 AND business_id = $2',
      [productId, businessId]
    );
    if (!productCheck.rows.length) {
      throw new AppError('Product not found', 404, 'not_found');
    }

    // Create tiers in transaction
    await withTransaction(async (client) => {
      // Delete existing tiers
      await client.query('DELETE FROM product_bulk_tiers WHERE product_id = $1', [productId]);

      // Insert new tiers
      for (const tier of tiers) {
        if (!tier.minQuantity || typeof tier.discountPercent !== 'number') {
          throw new AppError('Invalid tier structure', 400, 'validation_failed');
        }

        await client.query(
          `
          INSERT INTO product_bulk_tiers
          (product_id, min_quantity, discount_percent)
          VALUES ($1, $2, $3)
          `,
          [productId, tier.minQuantity, tier.discountPercent]
        );
      }
    });

    logger.info('Bulk pricing tiers set', { productId, tierCount: tiers.length });

    res.json({
      success: true,
      message: `Set ${tiers.length} pricing tier(s)`,
    });
  } catch (error) {
    logger.error('productPricingController.setBulkPricingTiers', { error });
    next(error);
  }
}

/**
 * Get bulk pricing tiers for a product
 * GET /api/businesses/{businessId}/products/{productId}/bulk-pricing
 */
async function getBulkPricingTiers(req, res, next) {
  try {
    const { businessId, productId } = req.params;

    // Verify product exists
    const productCheck = await pool.query(
      'SELECT id FROM business_products WHERE id = $1 AND business_id = $2',
      [productId, businessId]
    );
    if (!productCheck.rows.length) {
      throw new AppError('Product not found', 404, 'not_found');
    }

    const result = await pool.query(
      `
      SELECT min_quantity, discount_percent
      FROM product_bulk_tiers
      WHERE product_id = $1
      ORDER BY min_quantity ASC
      `,
      [productId]
    );

    res.json({
      success: true,
      data: result.rows.map(tier => ({
        minQuantity: parseInt(tier.min_quantity),
        discountPercent: parseFloat(tier.discount_percent),
      })),
    });
  } catch (error) {
    logger.error('productPricingController.getBulkPricingTiers', { error });
    next(error);
  }
}

module.exports = {
  listPricingRules,
  getPricingRule,
  createPricingRule,
  updatePricingRule,
  deletePricingRule,
  calculatePrice,
  setBulkPricingTiers,
  getBulkPricingTiers,
};
