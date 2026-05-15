// Dynamic pricing engine controller
// Calculate prices based on 5 strategies: time, demand, volume, customer segment, seasonal

const pool = require('../db');
const { AppError } = require('../utils/apiError');
const logger = require('../utils/logger');

// Main pricing calculation
async function calculatePrice(req, res, next) {
  try {
    const { businessId, serviceId } = req.params;
    const { booking_date, booking_time, customer_id, quantity = 1 } = req.query;

    if (!booking_date || !booking_time) {
      return next(new AppError('Booking date and time are required', 400));
    }

    // Get service
    const serviceResult = await pool.query(
      'SELECT * FROM business_services WHERE id = $1 AND business_id = $2',
      [serviceId, businessId]
    );

    if (!serviceResult.rows.length) {
      return next(new AppError('Service not found', 404));
    }

    const service = serviceResult.rows[0];
    let finalPrice = service.base_price_cents;
    const appliedRules = [];
    const calculation = { base_price: service.base_price_cents, modifiers: [] };

    // 1. Get all active pricing rules for this service, ordered by priority
    const rulesResult = await pool.query(
      `SELECT * FROM service_price_rules
       WHERE business_id = $1 AND (service_id = $2 OR service_id IS NULL)
       AND is_enabled = true
       AND rule_type IN ('time', 'demand', 'volume', 'segment', 'seasonal')
       ORDER BY priority ASC`,
      [businessId, serviceId]
    );

    // 2. Apply time-based pricing
    const timeRules = rulesResult.rows.filter(r => r.rule_type === 'time');
    for (const rule of timeRules) {
      const timeModifier = await applyTimePricing(rule, booking_date, booking_time);
      if (timeModifier) {
        finalPrice = applyPriceModifier(finalPrice, timeModifier);
        calculation.modifiers.push({ type: 'time', ...timeModifier });
        appliedRules.push(rule.id);
      }
    }

    // 3. Apply demand-based pricing (surge)
    const demandRules = rulesResult.rows.filter(r => r.rule_type === 'demand');
    for (const rule of demandRules) {
      const demandModifier = await applyDemandPricing(serviceId, booking_date, booking_time, rule);
      if (demandModifier) {
        finalPrice = applyPriceModifier(finalPrice, demandModifier);
        calculation.modifiers.push({ type: 'demand', ...demandModifier });
        appliedRules.push(rule.id);
      }
    }

    // 4. Apply volume-based pricing
    const volumeRules = rulesResult.rows.filter(r => r.rule_type === 'volume');
    for (const rule of volumeRules) {
      const volumeModifier = await applyVolumePricing(customer_id, serviceId, quantity, rule);
      if (volumeModifier) {
        finalPrice = applyPriceModifier(finalPrice, volumeModifier);
        calculation.modifiers.push({ type: 'volume', ...volumeModifier });
        appliedRules.push(rule.id);
      }
    }

    // 5. Apply customer segment pricing (loyalty)
    const segmentRules = rulesResult.rows.filter(r => r.rule_type === 'segment');
    if (customer_id) {
      for (const rule of segmentRules) {
        const segmentModifier = await applyCustomerSegmentPricing(customer_id, serviceId, rule);
        if (segmentModifier) {
          finalPrice = applyPriceModifier(finalPrice, segmentModifier);
          calculation.modifiers.push({ type: 'segment', ...segmentModifier });
          appliedRules.push(rule.id);
        }
      }
    }

    // 6. Apply seasonal pricing (highest priority)
    const seasonalRules = rulesResult.rows.filter(r => r.rule_type === 'seasonal');
    for (const rule of seasonalRules) {
      const seasonalPrice = await applySeasonalPricing(rule, booking_date);
      if (seasonalPrice !== null) {
        finalPrice = seasonalPrice;
        calculation.modifiers.push({ type: 'seasonal', price: seasonalPrice });
        appliedRules.push(rule.id);
        break; // Seasonal overrides all
      }
    }

    // Apply price constraints (min/max)
    const constraints = await pool.query(
      'SELECT * FROM service_price_constraints WHERE service_id = $1',
      [serviceId]
    );

    if (constraints.rows.length > 0) {
      const constraint = constraints.rows[0];
      if (constraint.min_price_cents && finalPrice < constraint.min_price_cents) {
        finalPrice = constraint.min_price_cents;
        calculation.constrained = true;
      }
      if (constraint.max_price_cents && finalPrice > constraint.max_price_cents) {
        finalPrice = constraint.max_price_cents;
        calculation.constrained = true;
      }
    }

    // Log calculation
    await pool.query(
      `INSERT INTO service_price_calculations
       (service_id, customer_id, booking_date, booking_time, base_price_cents, final_price_cents, calculation_details, applied_rules)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [serviceId, customer_id || null, booking_date, booking_time, service.base_price_cents, finalPrice, JSON.stringify(calculation), appliedRules]
    );

    res.json({
      base_price_cents: service.base_price_cents,
      final_price_cents: finalPrice,
      price_difference_cents: finalPrice - service.base_price_cents,
      modifiers: calculation.modifiers,
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

// Helper functions for different pricing strategies

async function applyTimePricing(rule, bookingDate, bookingTime) {
  const timeRulesResult = await pool.query(
    'SELECT * FROM service_price_time_rules WHERE rule_id = $1',
    [rule.id]
  );

  const dateObj = new Date(bookingDate);
  const dayOfWeek = dateObj.getUTCDay();

  for (const timeRule of timeRulesResult.rows) {
    if (timeRule.day_of_week !== null && timeRule.day_of_week !== dayOfWeek) continue;
    if (timeRule.start_time && timeRule.end_time) {
      if (bookingTime >= timeRule.start_time && bookingTime <= timeRule.end_time) {
        return {
          multiplier: timeRule.price_multiplier,
          modifier: timeRule.price_modifier_cents,
          description: timeRule.description
        };
      }
    }
  }

  return null;
}

async function applyDemandPricing(serviceId, bookingDate, bookingTime, rule) {
  // Calculate availability percentage
  const appointmentsResult = await pool.query(
    `SELECT COUNT(*) FROM business_appointments
     WHERE service_id = $1 AND DATE(start_time) = $2 AND status != 'cancelled'`,
    [serviceId, bookingDate]
  );

  const availabilityPercent = 50; // Simplified - calculate real availability

  const demandRulesResult = await pool.query(
    'SELECT * FROM service_price_demand_rules WHERE rule_id = $1',
    [rule.id]
  );

  for (const demandRule of demandRulesResult.rows) {
    if (availabilityPercent <= demandRule.availability_threshold_percent) {
      return {
        multiplier: demandRule.price_multiplier,
        modifier: demandRule.price_modifier_cents,
        description: demandRule.description
      };
    }
  }

  return null;
}

async function applyVolumePricing(customerId, serviceId, quantity, rule) {
  const volumeRulesResult = await pool.query(
    'SELECT * FROM service_price_volume_rules WHERE rule_id = $1 ORDER BY min_quantity DESC',
    [rule.id]
  );

  for (const volRule of volumeRulesResult.rows) {
    if (quantity >= volRule.min_quantity && (!volRule.max_quantity || quantity <= volRule.max_quantity)) {
      return {
        multiplier: volRule.price_multiplier,
        modifier: volRule.price_modifier_cents,
        description: volRule.description
      };
    }
  }

  return null;
}

async function applyCustomerSegmentPricing(customerId, serviceId, rule) {
  const segmentRulesResult = await pool.query(
    'SELECT * FROM service_price_customer_segment_rules WHERE rule_id = $1',
    [rule.id]
  );

  // Check customer loyalty tier/segment
  const customerResult = await pool.query(
    'SELECT * FROM customer_business_profile WHERE customer_id = $1',
    [customerId]
  );

  if (!customerResult.rows.length) return null;

  const customer = customerResult.rows[0];

  for (const segRule of segmentRulesResult.rows) {
    if (segRule.segment_type === 'returning' && customer.lifetime_bookings > 0) {
      return {
        multiplier: segRule.price_multiplier,
        modifier: segRule.price_modifier_cents,
        description: segRule.description
      };
    }
    if (segRule.segment_type === 'loyalty_tier' && customer.loyalty_tier === segRule.segment_name) {
      return {
        multiplier: segRule.price_multiplier,
        modifier: segRule.price_modifier_cents,
        description: segRule.description
      };
    }
  }

  return null;
}

async function applySeasonalPricing(rule, bookingDate) {
  const seasonalRulesResult = await pool.query(
    'SELECT * FROM service_price_seasonal_rules WHERE rule_id = $1',
    [rule.id]
  );

  const dateObj = new Date(bookingDate);

  for (const seasonalRule of seasonalRulesResult.rows) {
    const startDate = new Date(seasonalRule.start_date);
    const endDate = new Date(seasonalRule.end_date);

    if (dateObj >= startDate && dateObj <= endDate) {
      if (seasonalRule.fixed_price_cents) {
        return seasonalRule.fixed_price_cents;
      }
    }
  }

  return null;
}

function applyPriceModifier(basePrice, modifier) {
  if (modifier.multiplier) {
    return Math.round(basePrice * modifier.multiplier);
  }
  if (modifier.modifier) {
    return basePrice + modifier.modifier;
  }
  return basePrice;
}

module.exports = {
  calculatePrice,
  createPricingRule,
  listPricingRules,
  updatePricingRule,
  deletePricingRule
};
