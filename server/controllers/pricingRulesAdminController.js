'use strict';

/**
 * server/controllers/pricingRulesAdminController.js
 *
 * Phase 4c — admin CRUD over the dynamic pricing rule tables.
 * Scoped per business via requireBusinessAccess middleware.
 *
 * Service rules (4 dimensions):
 *   POST /api/businesses/:businessId/pricing/service/:serviceId/rules
 *   GET  /api/businesses/:businessId/pricing/service/:serviceId/rules
 *   PATCH/DELETE /.../rules/:ruleId
 *
 * Product rules:
 *   POST /api/businesses/:businessId/pricing/product/:productId/rules
 *   GET  /api/businesses/:businessId/pricing/product/:productId/rules
 *   PATCH/DELETE /.../rules/:ruleId
 *
 * Preview (no DB writes, useful for the rule-builder UI):
 *   POST /api/businesses/:businessId/pricing/preview
 *     body: { kind:'service'|'product', targetId, quantity?, customerId?, atTimeIso? }
 */

const pool = require('../db');
const { sendError, sendSuccess, sendValidationError } = require('../utils/apiError');
const { logBusinessAction } = require('../services/businessAuditLog');
const pricingEngine = require('../services/pricingEngine');

const SERVICE_RULE_TYPES = new Set(['time', 'demand', 'volume', 'segment', 'seasonal']);
const PRODUCT_RULE_TYPES = new Set(['volume', 'promotion', 'bundle', 'segment', 'seasonal']);

function num(v, dflt) {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

// ── SERVICE RULES ────────────────────────────────────────────

exports.createServiceRule = async function createServiceRule(req, res, next) {
  try {
    const { serviceId } = req.params;
    const { rule_type, priority = 0, time, demand, volume, segment, seasonal } = req.body || {};

    const fields = {};
    if (!rule_type) fields.rule_type = 'rule_type required';
    if (rule_type && !SERVICE_RULE_TYPES.has(rule_type)) fields.rule_type = `must be one of ${Array.from(SERVICE_RULE_TYPES).join(',')}`;
    if (Object.keys(fields).length) return sendValidationError(res, fields);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const r = await client.query(
        `INSERT INTO service_price_rules (service_id, rule_type, priority, is_active)
         VALUES ($1, $2, $3, TRUE) RETURNING id`,
        [serviceId, rule_type, num(priority, 0)]
      );
      const ruleId = r.rows[0].id;

      if (rule_type === 'time' && time) {
        await client.query(
          `INSERT INTO service_price_time_rules
             (rule_id, day_of_week, start_time, end_time, is_peak,
              price_multiplier, fixed_modifier_cents)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [ruleId, num(time.day_of_week, 0), time.start_time || '00:00', time.end_time || '23:59',
           !!time.is_peak, num(time.price_multiplier, 1), num(time.fixed_modifier_cents, 0)]
        );
      } else if (rule_type === 'demand' && demand) {
        await client.query(
          `INSERT INTO service_price_demand_rules
             (rule_id, availability_threshold_percent, surge_multiplier)
           VALUES ($1,$2,$3)`,
          [ruleId, num(demand.availability_threshold_percent, 80), num(demand.surge_multiplier, 1.25)]
        );
      } else if (rule_type === 'volume' && volume) {
        await client.query(
          `INSERT INTO service_price_volume_rules
             (rule_id, min_quantity, max_quantity, period,
              price_multiplier, fixed_modifier_cents)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [ruleId, num(volume.min_quantity, 1), volume.max_quantity == null ? null : num(volume.max_quantity, null),
           volume.period || 'order',
           num(volume.price_multiplier, 1), num(volume.fixed_modifier_cents, 0)]
        );
      } else if (rule_type === 'segment' && segment) {
        await client.query(
          `INSERT INTO service_price_customer_segment_rules
             (rule_id, segment_type, segment_criteria,
              price_multiplier, min_customer_bookings, max_customer_bookings)
           VALUES ($1,$2,$3::jsonb,$4,$5,$6)`,
          [ruleId, segment.segment_type || 'returning',
           JSON.stringify(segment.segment_criteria || {}),
           num(segment.price_multiplier, 0.95),
           segment.min_customer_bookings == null ? null : num(segment.min_customer_bookings, null),
           segment.max_customer_bookings == null ? null : num(segment.max_customer_bookings, null)]
        );
      } else if (rule_type === 'seasonal' && seasonal) {
        await client.query(
          `INSERT INTO service_price_seasonal_rules
             (rule_id, start_date, end_date,
              price_multiplier, fixed_price_cents, fixed_modifier_cents)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [ruleId, seasonal.start_date, seasonal.end_date,
           num(seasonal.price_multiplier, 1),
           seasonal.fixed_price_cents == null ? null : num(seasonal.fixed_price_cents, null),
           num(seasonal.fixed_modifier_cents, 0)]
        );
      }

      await client.query('COMMIT');

      await logBusinessAction(req, {
        action: 'business.pricing_rule.created',
        target_type: `service_pricing_rule_${rule_type}`,
        target_id: ruleId,
        after_state: req.body,
      });

      return sendSuccess(res, { id: ruleId, rule_type, service_id: serviceId }, 201);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
};

exports.listServiceRules = async function listServiceRules(req, res, next) {
  try {
    const { serviceId } = req.params;
    const { rows } = await pool.query(
      `SELECT id, rule_type, priority, is_active, created_at, updated_at
         FROM service_price_rules WHERE service_id = $1
        ORDER BY priority DESC, created_at DESC`,
      [serviceId]
    );
    return sendSuccess(res, { rules: rows });
  } catch (err) { next(err); }
};

exports.toggleServiceRule = async function toggleServiceRule(req, res, next) {
  try {
    const { ruleId } = req.params;
    const { is_active } = req.body || {};
    const r = await pool.query(
      `UPDATE service_price_rules SET is_active = $1, updated_at = NOW()
        WHERE id = $2 RETURNING id, is_active`,
      [!!is_active, ruleId]
    );
    if (!r.rows[0]) return sendError(res, 404, 'Rule not found', 'not_found');
    await logBusinessAction(req, {
      action: 'business.pricing_rule.toggled',
      target_type: 'service_pricing_rule',
      target_id: ruleId,
      after_state: { is_active: !!is_active },
    });
    return sendSuccess(res, r.rows[0]);
  } catch (err) { next(err); }
};

exports.deleteServiceRule = async function deleteServiceRule(req, res, next) {
  try {
    const { ruleId } = req.params;
    const r = await pool.query(
      `DELETE FROM service_price_rules WHERE id = $1 RETURNING id`,
      [ruleId]
    );
    if (!r.rows[0]) return sendError(res, 404, 'Rule not found', 'not_found');
    await logBusinessAction(req, {
      action: 'business.pricing_rule.deleted',
      target_type: 'service_pricing_rule',
      target_id: ruleId,
    });
    return sendSuccess(res, { ok: true });
  } catch (err) { next(err); }
};

// ── PRODUCT RULES ────────────────────────────────────────────

exports.createProductRule = async function createProductRule(req, res, next) {
  try {
    const businessId = req.business && req.business.id;
    const { productId } = req.params;
    const { rule_type, priority = 0, conditions_json = {}, pricing_adjustment = {} } = req.body || {};

    const fields = {};
    if (!rule_type) fields.rule_type = 'rule_type required';
    if (rule_type && !PRODUCT_RULE_TYPES.has(rule_type)) fields.rule_type = `must be one of ${Array.from(PRODUCT_RULE_TYPES).join(',')}`;
    if (Object.keys(fields).length) return sendValidationError(res, fields);

    const r = await pool.query(
      `INSERT INTO product_pricing_rules
         (business_id, product_id, rule_type, priority,
          conditions_json, pricing_adjustment, is_active)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, TRUE)
       RETURNING id`,
      [businessId, productId, rule_type, num(priority, 0),
       JSON.stringify(conditions_json), JSON.stringify(pricing_adjustment)]
    );

    await logBusinessAction(req, {
      action: 'business.product_pricing_rule.created',
      target_type: `product_pricing_rule_${rule_type}`,
      target_id: r.rows[0].id,
      after_state: req.body,
    });

    return sendSuccess(res, { id: r.rows[0].id, rule_type, product_id: productId }, 201);
  } catch (err) { next(err); }
};

exports.listProductRules = async function listProductRules(req, res, next) {
  try {
    const businessId = req.business && req.business.id;
    const { productId } = req.params;
    const { rows } = await pool.query(
      `SELECT id, rule_type, priority, is_active, conditions_json, pricing_adjustment,
              created_at, updated_at
         FROM product_pricing_rules
        WHERE business_id = $1
          AND (product_id = $2 OR product_id IS NULL)
        ORDER BY priority DESC, created_at DESC`,
      [businessId, productId]
    );
    return sendSuccess(res, { rules: rows });
  } catch (err) { next(err); }
};

exports.toggleProductRule = async function toggleProductRule(req, res, next) {
  try {
    const { ruleId } = req.params;
    const { is_active } = req.body || {};
    const r = await pool.query(
      `UPDATE product_pricing_rules SET is_active = $1, updated_at = NOW()
        WHERE id = $2 RETURNING id, is_active`,
      [!!is_active, ruleId]
    );
    if (!r.rows[0]) return sendError(res, 404, 'Rule not found', 'not_found');
    await logBusinessAction(req, {
      action: 'business.product_pricing_rule.toggled',
      target_type: 'product_pricing_rule',
      target_id: ruleId,
      after_state: { is_active: !!is_active },
    });
    return sendSuccess(res, r.rows[0]);
  } catch (err) { next(err); }
};

exports.deleteProductRule = async function deleteProductRule(req, res, next) {
  try {
    const { ruleId } = req.params;
    const r = await pool.query(
      `DELETE FROM product_pricing_rules WHERE id = $1 RETURNING id`,
      [ruleId]
    );
    if (!r.rows[0]) return sendError(res, 404, 'Rule not found', 'not_found');
    await logBusinessAction(req, {
      action: 'business.product_pricing_rule.deleted',
      target_type: 'product_pricing_rule',
      target_id: ruleId,
    });
    return sendSuccess(res, { ok: true });
  } catch (err) { next(err); }
};

// ── PREVIEW (no writes) ──────────────────────────────────────

exports.previewPrice = async function previewPrice(req, res, next) {
  try {
    const businessId = req.business && req.business.id;
    const { kind, targetId, quantity, customerId, atTimeIso, basePriceCents } = req.body || {};
    if (!kind || !targetId) return sendValidationError(res, { kind: 'kind required', targetId: 'targetId required' });

    const result = await pricingEngine.calculatePrice({
      businessId, kind, targetId,
      quantity: quantity != null ? Number(quantity) : 1,
      customerId: customerId || null,
      atTimeIso: atTimeIso || null,
      basePriceCents: basePriceCents != null ? Number(basePriceCents) : undefined,
    });
    return sendSuccess(res, result);
  } catch (err) { next(err); }
};
