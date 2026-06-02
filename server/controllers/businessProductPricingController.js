/**
 * Business Product Pricing Controller
 * Dynamic pricing rules (volume, promotion, bundle, segment, seasonal),
 * price calculation, and bulk pricing tiers — all scoped per business.
 *
 * Endpoints (all under /api/businesses/:businessId/product-pricing):
 *   GET    /rules                  – list rules (owner)
 *   GET    /rules/:ruleId          – get single rule (owner)
 *   POST   /rules                  – create rule (owner)
 *   PUT    /rules/:ruleId          – update rule (owner)
 *   DELETE /rules/:ruleId          – delete rule (owner)
 *   POST   /calculate              – calculate final price (public)
 *
 * Bulk pricing (under /api/businesses/:businessId/products/:productId):
 *   GET    /bulk-pricing           – get tiers
 *   POST   /bulk-pricing           – set tiers (owner)
 */

const pool = require('../db');
const { AppError } = require('../utils/apiError');
const logger = require('../utils/logger');
const { withTransaction } = require('../utils/transaction');

// ── List pricing rules ────────────────────────────────────────────────────────
async function listPricingRules(req, res, next) {
  try {
    const { businessId } = req.params;
    const { page = 0, limit = 50 } = req.query;

    const safeLimit  = Math.min(parseInt(limit) || 50, 200);
    const safeOffset = (parseInt(page) || 0) * safeLimit;

    const [rows, countRow] = await Promise.all([
      pool.query(
        `SELECT id, business_id, rule_name, rule_type, description,
                priority, is_active, applies_to, conditions_json, pricing_adjustment,
                start_date, end_date, created_at, updated_at
         FROM product_pricing_rules
         WHERE business_id = $1
         ORDER BY priority ASC, created_at DESC
         LIMIT $2 OFFSET $3`,
        [businessId, safeLimit, safeOffset]
      ),
      pool.query(
        'SELECT COUNT(*) AS total FROM product_pricing_rules WHERE business_id = $1',
        [businessId]
      ),
    ]);

    res.json({
      success: true,
      data: rows.rows.map(r => ({
        id:            r.id,
        name:          r.rule_name,
        type:          r.rule_type,
        description:   r.description,
        priority:      r.priority,
        isActive:      r.is_active,
        appliesToType: r.applies_to,
        adjustment:    r.pricing_adjustment,
        startDate:     r.start_date,
        endDate:       r.end_date,
        createdAt:     r.created_at,
      })),
      total: parseInt(countRow.rows[0].total),
      page:  parseInt(page),
      limit: safeLimit,
    });
  } catch (error) {
    logger.error('businessProductPricingController.listPricingRules', { error });
    next(error);
  }
}

// ── Get single pricing rule ───────────────────────────────────────────────────
async function getPricingRule(req, res, next) {
  try {
    const { businessId, ruleId } = req.params;
    const r = await pool.query(
      'SELECT * FROM product_pricing_rules WHERE id = $1 AND business_id = $2',
      [ruleId, businessId]
    );
    if (!r.rows.length) throw new AppError('Rule not found', 404, 'not_found');

    const rule = r.rows[0];
    res.json({
      success: true,
      data: {
        id:            rule.id,
        name:          rule.rule_name,
        type:          rule.rule_type,
        description:   rule.description,
        priority:      rule.priority,
        isActive:      rule.is_active,
        appliesToType: rule.applies_to,
        appliesTo:     rule.applies_to_id,
        conditions:    rule.conditions_json,
        adjustment:    rule.pricing_adjustment,
        startDate:     rule.start_date,
        endDate:       rule.end_date,
        createdAt:     rule.created_at,
        updatedAt:     rule.updated_at,
      },
    });
  } catch (error) {
    logger.error('businessProductPricingController.getPricingRule', { error });
    next(error);
  }
}

// ── Create pricing rule ───────────────────────────────────────────────────────
async function createPricingRule(req, res, next) {
  try {
    const { businessId } = req.params;
    const {
      name, type, description = '', priority = 50,
      appliesToType = 'product', appliesTo,
      conditions = {}, adjustment = {},
      startDate, endDate,
    } = req.body;

    if (!name || name.length > 200)
      throw new AppError('Rule name required (1-200 chars)', 400, 'validation_failed');

    const validTypes = ['volume', 'promotion', 'bundle', 'segment', 'seasonal'];
    if (!validTypes.includes(type))
      throw new AppError(`Invalid type. Must be one of: ${validTypes.join(', ')}`, 400, 'validation_failed');

    if (typeof priority !== 'number' || priority < 1 || priority > 100)
      throw new AppError('Priority must be 1-100', 400, 'validation_failed');

    if (!['product', 'category', 'all'].includes(appliesToType))
      throw new AppError('Invalid applies_to type', 400, 'validation_failed');

    const result = await pool.query(
      `INSERT INTO product_pricing_rules
         (business_id, rule_name, rule_type, description, priority,
          applies_to, applies_to_id, conditions_json, pricing_adjustment,
          start_date, end_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        businessId, name.trim(), type, description.trim(), priority,
        appliesToType, appliesTo || null,
        JSON.stringify(conditions), JSON.stringify(adjustment),
        startDate || null, endDate || null,
      ]
    );

    logger.info('Product pricing rule created', { ruleId: result.rows[0].id, businessId });
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    logger.error('businessProductPricingController.createPricingRule', { error });
    next(error);
  }
}

// ── Update pricing rule ───────────────────────────────────────────────────────
async function updatePricingRule(req, res, next) {
  try {
    const { businessId, ruleId } = req.params;
    const { name, description, priority, conditions, adjustment, isActive } = req.body;

    const sets = [];
    const params = [ruleId, businessId];
    const p = () => `$${params.length}`;

    if (name !== undefined)        { params.push(name.trim());               sets.push(`rule_name = ${p()}`); }
    if (description !== undefined) { params.push(description.trim());        sets.push(`description = ${p()}`); }
    if (priority !== undefined)    { params.push(priority);                  sets.push(`priority = ${p()}`); }
    if (conditions !== undefined)  { params.push(JSON.stringify(conditions));sets.push(`conditions_json = ${p()}`); }
    if (adjustment !== undefined)  { params.push(JSON.stringify(adjustment));sets.push(`pricing_adjustment = ${p()}`); }
    if (isActive !== undefined)    { params.push(isActive);                  sets.push(`is_active = ${p()}`); }

    if (!sets.length) throw new AppError('No updates provided', 400, 'validation_failed');

    const result = await pool.query(
      `UPDATE product_pricing_rules SET ${sets.join(', ')}, updated_at = now()
       WHERE id = $1 AND business_id = $2 RETURNING *`,
      params
    );
    if (!result.rows.length) throw new AppError('Rule not found', 404, 'not_found');

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    logger.error('businessProductPricingController.updatePricingRule', { error });
    next(error);
  }
}

// ── Delete pricing rule ───────────────────────────────────────────────────────
async function deletePricingRule(req, res, next) {
  try {
    const { businessId, ruleId } = req.params;

    await pool.query(
      'DELETE FROM product_pricing_rules WHERE id = $1 AND business_id = $2',
      [ruleId, businessId]
    );

    res.json({ success: true, message: 'Rule deleted' });
  } catch (error) {
    logger.error('businessProductPricingController.deletePricingRule', { error });
    next(error);
  }
}

// ── Calculate final price ─────────────────────────────────────────────────────
async function calculatePrice(req, res, next) {
  try {
    const { businessId } = req.params;
    const { productId, quantity = 1, customerId } = req.body;

    if (!productId) throw new AppError('Product ID required', 400, 'validation_failed');

    const productResult = await pool.query(
      'SELECT price_cents, category FROM business_products WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL',
      [productId, businessId]
    );
    if (!productResult.rows.length) throw new AppError('Product not found', 404, 'not_found');

    const basePrice = productResult.rows[0].price_cents / 100;
    const category  = productResult.rows[0].category;

    const rulesResult = await pool.query(
      `SELECT id, rule_type, conditions_json, pricing_adjustment
       FROM product_pricing_rules
       WHERE business_id = $1 AND is_active = true
         AND (applies_to = 'all'
              OR (applies_to = 'product'  AND applies_to_id = $2)
              OR (applies_to = 'category' AND applies_to_id = $3))
         AND (start_date IS NULL OR start_date <= now())
         AND (end_date   IS NULL OR end_date   >= now())
       ORDER BY priority ASC`,
      [businessId, productId, category]
    );

    let finalPrice = basePrice;
    const appliedRules = [];

    for (const rule of rulesResult.rows) {
      const adj = rule.pricing_adjustment;
      const cond = rule.conditions_json || {};

      // Volume check
      if (rule.rule_type === 'volume' && cond.minQuantity && quantity < cond.minQuantity) continue;

      if (adj.type === 'percentage')  finalPrice *= (1 - adj.value / 100);
      else if (adj.type === 'fixed')  finalPrice  = Math.max(0, finalPrice - adj.value);
      else if (adj.type === 'multiplier') finalPrice *= adj.value;

      appliedRules.push({ ruleId: rule.id, type: rule.rule_type, adjustment: adj });
    }

    finalPrice = Math.max(0, finalPrice);

    res.json({
      success: true,
      data: {
        productId,
        basePrice,
        finalPrice:  parseFloat(finalPrice.toFixed(2)),
        totalPrice:  parseFloat((finalPrice * quantity).toFixed(2)),
        quantity,
        savings:     parseFloat((basePrice - finalPrice).toFixed(2)),
        appliedRules,
      },
    });
  } catch (error) {
    logger.error('businessProductPricingController.calculatePrice', { error });
    next(error);
  }
}

// ── Bulk pricing tiers ────────────────────────────────────────────────────────
async function setBulkPricingTiers(req, res, next) {
  try {
    const { businessId, productId } = req.params;
    const { tiers } = req.body;

    if (!Array.isArray(tiers) || !tiers.length)
      throw new AppError('Tiers array required', 400, 'validation_failed');

    const productCheck = await pool.query(
      'SELECT id FROM business_products WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL',
      [productId, businessId]
    );
    if (!productCheck.rows.length) throw new AppError('Product not found', 404, 'not_found');

    await withTransaction(pool, async (client) => {
      await client.query('DELETE FROM product_bulk_tiers WHERE product_id = $1', [productId]);
      for (const tier of tiers) {
        if (!tier.minQuantity || typeof tier.discountPercent !== 'number')
          throw new AppError('Each tier requires minQuantity and discountPercent', 400, 'validation_failed');
        await client.query(
          'INSERT INTO product_bulk_tiers (product_id, min_quantity, discount_percent) VALUES ($1,$2,$3)',
          [productId, tier.minQuantity, tier.discountPercent]
        );
      }
    });

    res.json({ success: true, message: `Set ${tiers.length} tier(s)` });
  } catch (error) {
    logger.error('businessProductPricingController.setBulkPricingTiers', { error });
    next(error);
  }
}

async function getBulkPricingTiers(req, res, next) {
  try {
    const { businessId, productId } = req.params;

    const productCheck = await pool.query(
      'SELECT id FROM business_products WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL',
      [productId, businessId]
    );
    if (!productCheck.rows.length) throw new AppError('Product not found', 404, 'not_found');

    const result = await pool.query(
      'SELECT min_quantity, discount_percent FROM product_bulk_tiers WHERE product_id = $1 ORDER BY min_quantity ASC',
      [productId]
    );

    res.json({
      success: true,
      data: result.rows.map(t => ({
        minQuantity:     parseInt(t.min_quantity),
        discountPercent: parseFloat(t.discount_percent),
      })),
    });
  } catch (error) {
    logger.error('businessProductPricingController.getBulkPricingTiers', { error });
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
