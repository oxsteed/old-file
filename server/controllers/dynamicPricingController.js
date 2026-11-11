// Dynamic pricing engine controller
// Calculate prices based on 5 strategies: time, demand, volume, customer segment, seasonal

const pool = require('../db');
const { AppError } = require('../utils/apiError');
const logger = require('../utils/logger');
const pricingEngine = require('../services/pricingEngine');
const { resolvePublicBusinessOwner } = require('../services/businessPublicOwner');

// Main pricing calculation
async function calculatePrice(req, res, next) {
  try {
    const { businessId, serviceId } = req.params;
    const { booking_date, booking_time, customer_id, quantity = 1 } = req.query;

    if (!booking_date || !booking_time) {
      return next(new AppError('Booking date and time are required', 400));
    }
    if (!await resolvePublicBusinessOwner(businessId)) {
      return next(new AppError('Business not found', 404, 'not_found'));
    }

    const atTime = new Date(`${booking_date}T${booking_time}:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(booking_date)) ||
        !/^\d{2}:\d{2}$/.test(String(booking_time)) ||
        Number.isNaN(atTime.getTime())) {
      return next(new AppError('Booking date and time are invalid', 400));
    }
    const atTimeIso = atTime.toISOString();
    const result = await pricingEngine.calculatePrice({
      businessId,
      kind: 'service',
      targetId: serviceId,
      quantity,
      customerId: customer_id || null,
      atTimeIso,
    });

    if (result.error === 'service not found') {
      return next(new AppError('Service not found', 404));
    }

    const appliedRules = result.applied
      .map(rule => rule.ruleId)
      .filter(Boolean);
    await pool.query(
      `INSERT INTO service_price_calculations
       (service_id, customer_id, booking_date, booking_time, base_price_cents, final_price_cents, calculation_details, applied_rules)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [serviceId, customer_id || null, booking_date, booking_time,
       result.basePriceCents, result.adjustedPriceCents, JSON.stringify(result), appliedRules]
    );

    res.json({
      base_price_cents: result.basePriceCents,
      final_price_cents: result.adjustedPriceCents,
      price_difference_cents: result.adjustedPriceCents - result.basePriceCents,
      modifiers: result.applied,
      applied_rules: appliedRules
    });
  } catch (error) {
    logger.error('Error calculating price', { error });
    next(new AppError('Failed to calculate price', 500));
  }
}

// Create pricing rule
async function createPricingRule(req, res, next) {
  try {
    const { businessId } = req.params;
    const { service_id, rule_type, name, rule_config, priority = 100 } = req.body;

    if (!rule_type || !name || !rule_config) {
      return next(new AppError('Rule type, name, and config are required', 400));
    }

    const result = await pool.query(
      `INSERT INTO service_price_rules
       (business_id, service_id, rule_type, name, rule_config, priority, created_by_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [businessId, service_id || null, rule_type, name, JSON.stringify(rule_config), priority, req.user.id]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    logger.error('Error creating pricing rule', { error });
    next(new AppError('Failed to create pricing rule', 500));
  }
}

// List pricing rules
async function listPricingRules(req, res, next) {
  try {
    const { businessId, serviceId } = req.params;

    const query = `
      SELECT * FROM service_price_rules
      WHERE business_id = $1 ${serviceId ? 'AND service_id = $2' : ''}
      ORDER BY priority ASC
    `;

    const params = serviceId ? [businessId, serviceId] : [businessId];
    const result = await pool.query(query, params);

    res.json(result.rows);
  } catch (error) {
    logger.error('Error listing pricing rules', { error });
    next(new AppError('Failed to list pricing rules', 500));
  }
}

// Update pricing rule
async function updatePricingRule(req, res, next) {
  try {
    const { businessId, ruleId } = req.params;
    const { name, rule_config, is_enabled, priority } = req.body;

    let query = 'UPDATE service_price_rules SET ';
    const updates = [];
    const params = [];
    let paramCount = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramCount++}`);
      params.push(name);
    }
    if (rule_config !== undefined) {
      updates.push(`rule_config = $${paramCount++}`);
      params.push(JSON.stringify(rule_config));
    }
    if (is_enabled !== undefined) {
      updates.push(`is_enabled = $${paramCount++}`);
      params.push(is_enabled);
    }
    if (priority !== undefined) {
      updates.push(`priority = $${paramCount++}`);
      params.push(priority);
    }

    if (updates.length === 0) {
      return next(new AppError('No fields to update', 400));
    }

    updates.push('updated_at = NOW()');
    query += updates.join(', ') + ` WHERE id = $${paramCount} AND business_id = $${paramCount + 1} RETURNING *`;
    params.push(ruleId, businessId);

    const result = await pool.query(query, params);

    if (!result.rows.length) {
      return next(new AppError('Rule not found', 404));
    }

    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Error updating pricing rule', { error });
    next(new AppError('Failed to update pricing rule', 500));
  }
}

// Delete pricing rule
async function deletePricingRule(req, res, next) {
  try {
    const { businessId, ruleId } = req.params;

    await pool.query(
      'DELETE FROM service_price_rules WHERE id = $1 AND business_id = $2',
      [ruleId, businessId]
    );

    res.json({ message: 'Rule deleted successfully' });
  } catch (error) {
    logger.error('Error deleting pricing rule', { error });
    next(new AppError('Failed to delete pricing rule', 500));
  }
}

module.exports = {
  calculatePrice,
  createPricingRule,
  listPricingRules,
  updatePricingRule,
  deletePricingRule
};
