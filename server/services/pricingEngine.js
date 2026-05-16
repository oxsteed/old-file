'use strict';

/**
 * server/services/pricingEngine.js
 *
 * Phase 4 — runtime evaluator for the dynamic pricing rule tables.
 *
 * Inputs:
 *   {
 *     businessId,           // INT
 *     kind: 'service'|'product',
 *     targetId,             // service id (INT) or business_product id (UUID)
 *     basePriceCents,       // optional override; otherwise pulled from row
 *     quantity = 1,
 *     customerId,           // optional, used for segment classification
 *     atTimeIso,            // optional, default = now (used for time/seasonal rules)
 *   }
 *
 * Output:
 *   {
 *     basePriceCents,
 *     adjustedPriceCents,
 *     applied: [
 *       { ruleId, ruleType, name, kind: 'multiplier'|'fixed'|'modifier', value, beforeCents, afterCents }
 *     ],
 *     segment,              // resolved customer segment
 *     demand,               // 0..1 fraction (1=fully booked / out of stock)
 *     constraints: { min, max, applied: bool }
 *   }
 *
 * Tables consumed (created by migrations 222 + 218):
 *   service_price_rules, service_price_time_rules, service_price_demand_rules,
 *   service_price_volume_rules, service_price_customer_segment_rules,
 *   service_price_seasonal_rules, service_price_constraints
 *   product_pricing_rules
 *
 * Failure mode: if any rule lookup errors, the engine logs and falls back
 * to the base price unchanged. Pricing must never block a sale outright.
 */

const pool = require('../db');
const logger = require('../utils/logger');
const { getCustomerSegment, computeDemandSignal } = require('./pricingSignals');

const DOW_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function roundCents(n) { return Math.max(0, Math.round(Number(n) || 0)); }
function toIso(d) { return d instanceof Date ? d.toISOString() : new Date(d).toISOString(); }
function timeOfDayMinutes(d) { return d.getUTCHours() * 60 + d.getUTCMinutes(); }
function withinTimeWindow(now, startStr, endStr) {
  const t = timeOfDayMinutes(now);
  const [sH, sM] = String(startStr || '00:00').split(':').map(Number);
  const [eH, eM] = String(endStr   || '23:59').split(':').map(Number);
  const s = sH * 60 + (sM || 0);
  const e = eH * 60 + (eM || 0);
  return t >= s && t < e;
}

async function _loadServiceBasePrice(businessId, serviceId) {
  const { rows } = await pool.query(
    `SELECT base_price_cents FROM business_services WHERE id = $1 AND business_id = $2`,
    [serviceId, businessId]
  );
  return rows[0] ? Number(rows[0].base_price_cents) : null;
}

async function _loadProductBasePrice(businessId, productId) {
  const { rows } = await pool.query(
    `SELECT price_cents FROM business_products WHERE id = $1 AND business_id = $2`,
    [productId, businessId]
  );
  return rows[0] ? Number(rows[0].price_cents) : null;
}

async function _loadServiceConstraints(serviceId) {
  try {
    const { rows } = await pool.query(
      `SELECT min_price_cents, max_price_cents
         FROM service_price_constraints WHERE service_id = $1 LIMIT 1`,
      [serviceId]
    );
    return rows[0] || null;
  } catch { return null; }
}

async function _loadServiceRules(serviceId) {
  // Load rule tree. Each query is wrapped because some envs may not have
  // these tables yet (the schema lives in migration 222).
  const safe = (q, p) => pool.query(q, p).then(r => r.rows).catch(() => []);
  const [rules, timeRules, demandRules, volumeRules, segRules, seasonalRules] = await Promise.all([
    safe(`SELECT id, rule_type, priority, is_active FROM service_price_rules
           WHERE service_id = $1 AND is_active = TRUE
           ORDER BY priority DESC`, [serviceId]),
    safe(`SELECT rule_id, day_of_week, start_time, end_time, is_peak,
                 price_multiplier, fixed_modifier_cents
            FROM service_price_time_rules`, []),
    safe(`SELECT rule_id, availability_threshold_percent, surge_multiplier
            FROM service_price_demand_rules`, []),
    safe(`SELECT rule_id, min_quantity, max_quantity, period,
                 price_multiplier, fixed_modifier_cents
            FROM service_price_volume_rules`, []),
    safe(`SELECT rule_id, segment_type, segment_criteria,
                 price_multiplier, min_customer_bookings, max_customer_bookings
            FROM service_price_customer_segment_rules`, []),
    safe(`SELECT rule_id, start_date, end_date, price_multiplier,
                 fixed_price_cents, fixed_modifier_cents
            FROM service_price_seasonal_rules`, []),
  ]);
  // index children by rule_id
  const byRule = (arr) => {
    const m = new Map();
    for (const r of arr) {
      const list = m.get(r.rule_id) || [];
      list.push(r);
      m.set(r.rule_id, list);
    }
    return m;
  };
  return {
    rules,
    time:    byRule(timeRules),
    demand:  byRule(demandRules),
    volume:  byRule(volumeRules),
    segment: byRule(segRules),
    seasonal: byRule(seasonalRules),
  };
}

async function _loadProductRules(businessId, productId) {
  const safe = (q, p) => pool.query(q, p).then(r => r.rows).catch(() => []);
  return safe(
    `SELECT id, rule_type, priority, conditions_json, pricing_adjustment, is_active
       FROM product_pricing_rules
      WHERE business_id = $1 AND (product_id = $2 OR product_id IS NULL)
        AND is_active = TRUE
      ORDER BY priority DESC`,
    [businessId, productId]
  );
}

function applyAdjustment(currentCents, adj) {
  // adj = { kind: 'multiplier'|'fixed'|'modifier', value }
  let after = currentCents;
  if (adj.kind === 'multiplier' && Number.isFinite(adj.value)) {
    after = currentCents * adj.value;
  } else if (adj.kind === 'fixed' && Number.isFinite(adj.value)) {
    after = adj.value;
  } else if (adj.kind === 'modifier' && Number.isFinite(adj.value)) {
    after = currentCents + adj.value;
  }
  return roundCents(after);
}

async function priceService(args) {
  const businessId = args.businessId;
  const serviceId = args.targetId;
  const at = args.atTimeIso ? new Date(args.atTimeIso) : new Date();
  const quantity = Math.max(1, Number(args.quantity) || 1);

  let base = args.basePriceCents;
  if (base == null) base = await _loadServiceBasePrice(businessId, serviceId);
  if (base == null) {
    return { error: 'service not found', basePriceCents: 0, adjustedPriceCents: 0, applied: [] };
  }

  const [tree, constraints, segment, demand] = await Promise.all([
    _loadServiceRules(serviceId),
    _loadServiceConstraints(serviceId),
    args.customerId ? getCustomerSegment({ userId: args.customerId, businessId }) : Promise.resolve('new'),
    computeDemandSignal({ kind: 'service', businessId, targetId: serviceId, atTimeIso: toIso(at) }),
  ]);

  let cents = base;
  const applied = [];
  for (const r of tree.rules) {
    let adj = null;
    let name = r.rule_type;

    if (r.rule_type === 'time') {
      const dow = at.getUTCDay();
      const matches = (tree.time.get(r.id) || []).filter(t =>
        Number(t.day_of_week) === dow && withinTimeWindow(at, t.start_time, t.end_time)
      );
      if (matches.length) {
        const t = matches[0];
        if (Number.isFinite(Number(t.price_multiplier)) && Number(t.price_multiplier) !== 1) {
          adj = { kind: 'multiplier', value: Number(t.price_multiplier) };
          name = `time(${DOW_NAMES[dow]} ${t.start_time}-${t.end_time}${t.is_peak ? ' peak' : ''})`;
        } else if (Number.isFinite(Number(t.fixed_modifier_cents)) && Number(t.fixed_modifier_cents) !== 0) {
          adj = { kind: 'modifier', value: Number(t.fixed_modifier_cents) };
        }
      }
    } else if (r.rule_type === 'seasonal') {
      const matches = (tree.seasonal.get(r.id) || []).filter(s =>
        new Date(s.start_date) <= at && at <= new Date(s.end_date)
      );
      if (matches.length) {
        const s = matches[0];
        if (Number.isFinite(Number(s.fixed_price_cents)) && Number(s.fixed_price_cents) > 0) {
          adj = { kind: 'fixed', value: Number(s.fixed_price_cents) };
        } else if (Number.isFinite(Number(s.price_multiplier)) && Number(s.price_multiplier) !== 1) {
          adj = { kind: 'multiplier', value: Number(s.price_multiplier) };
        } else if (Number.isFinite(Number(s.fixed_modifier_cents)) && Number(s.fixed_modifier_cents) !== 0) {
          adj = { kind: 'modifier', value: Number(s.fixed_modifier_cents) };
        }
        name = `seasonal(${String(s.start_date).slice(0,10)}..${String(s.end_date).slice(0,10)})`;
      }
    } else if (r.rule_type === 'volume') {
      const matches = (tree.volume.get(r.id) || []).filter(v =>
        quantity >= Number(v.min_quantity) &&
        (v.max_quantity == null || quantity <= Number(v.max_quantity))
      );
      if (matches.length) {
        const v = matches[0];
        if (Number.isFinite(Number(v.price_multiplier)) && Number(v.price_multiplier) !== 1) {
          adj = { kind: 'multiplier', value: Number(v.price_multiplier) };
        } else if (Number.isFinite(Number(v.fixed_modifier_cents)) && Number(v.fixed_modifier_cents) !== 0) {
          adj = { kind: 'modifier', value: Number(v.fixed_modifier_cents) };
        }
        name = `volume(>=${v.min_quantity})`;
      }
    } else if (r.rule_type === 'demand') {
      const cfgs = tree.demand.get(r.id) || [];
      // Surge fires when demand >= threshold (e.g., 80%)
      const cfg = cfgs.find(c => demand * 100 >= Number(c.availability_threshold_percent));
      if (cfg) {
        adj = { kind: 'multiplier', value: Number(cfg.surge_multiplier) };
        name = `demand(>=${cfg.availability_threshold_percent}%)`;
      }
    } else if (r.rule_type === 'segment') {
      const cfgs = tree.segment.get(r.id) || [];
      const cfg = cfgs.find(c =>
        (c.segment_type === segment) ||
        (c.segment_type === 'any')
      );
      if (cfg && Number.isFinite(Number(cfg.price_multiplier))) {
        adj = { kind: 'multiplier', value: Number(cfg.price_multiplier) };
        name = `segment(${cfg.segment_type})`;
      }
    }

    if (adj) {
      const before = cents;
      cents = applyAdjustment(cents, adj);
      applied.push({
        ruleId: r.id,
        ruleType: r.rule_type,
        name,
        kind: adj.kind,
        value: adj.value,
        beforeCents: before,
        afterCents: cents,
      });
    }
  }

  let constraintApplied = false;
  if (constraints) {
    const lo = constraints.min_price_cents != null ? Number(constraints.min_price_cents) : 0;
    const hi = constraints.max_price_cents != null ? Number(constraints.max_price_cents) : Number.MAX_SAFE_INTEGER;
    const clamped = clamp(cents, lo, hi);
    if (clamped !== cents) {
      applied.push({
        ruleId: null, ruleType: 'constraint', name: 'price-cap',
        kind: 'fixed', value: clamped, beforeCents: cents, afterCents: clamped,
      });
      cents = clamped;
      constraintApplied = true;
    }
  }

  return {
    basePriceCents: base,
    adjustedPriceCents: cents,
    applied,
    segment,
    demand,
    constraints: constraints ? {
      min: constraints.min_price_cents,
      max: constraints.max_price_cents,
      applied: constraintApplied,
    } : null,
  };
}

async function priceProduct(args) {
  const businessId = args.businessId;
  const productId = args.targetId;
  const at = args.atTimeIso ? new Date(args.atTimeIso) : new Date();
  const quantity = Math.max(1, Number(args.quantity) || 1);

  let base = args.basePriceCents;
  if (base == null) base = await _loadProductBasePrice(businessId, productId);
  if (base == null) {
    return { error: 'product not found', basePriceCents: 0, adjustedPriceCents: 0, applied: [] };
  }

  const [rules, segment, demand] = await Promise.all([
    _loadProductRules(businessId, productId),
    args.customerId ? getCustomerSegment({ userId: args.customerId, businessId }) : Promise.resolve('new'),
    computeDemandSignal({ kind: 'product', businessId, targetId: productId, atTimeIso: toIso(at) }),
  ]);

  let cents = base;
  const applied = [];
  for (const r of rules) {
    const cond = r.conditions_json || {};
    const adj = r.pricing_adjustment || {};

    // Common gating
    if (cond.starts_at && new Date(cond.starts_at) > at) continue;
    if (cond.ends_at   && new Date(cond.ends_at)   < at) continue;
    if (cond.segment   && cond.segment !== segment && cond.segment !== 'any') continue;
    if (cond.min_quantity && quantity < Number(cond.min_quantity)) continue;
    if (cond.max_quantity && quantity > Number(cond.max_quantity)) continue;
    if (cond.min_demand_percent != null && demand * 100 < Number(cond.min_demand_percent)) continue;
    if (cond.dow != null) {
      const allowed = Array.isArray(cond.dow) ? cond.dow : [cond.dow];
      if (!allowed.map(Number).includes(at.getUTCDay())) continue;
    }
    if (cond.time_window && Array.isArray(cond.time_window) && cond.time_window.length === 2) {
      if (!withinTimeWindow(at, cond.time_window[0], cond.time_window[1])) continue;
    }

    let normalized = null;
    if (adj.fixed_price_cents != null) normalized = { kind: 'fixed', value: Number(adj.fixed_price_cents) };
    else if (adj.fixed_modifier_cents != null) normalized = { kind: 'modifier', value: Number(adj.fixed_modifier_cents) };
    else if (adj.percent_off != null) normalized = { kind: 'multiplier', value: 1 - Number(adj.percent_off) / 100 };
    else if (adj.price_multiplier != null) normalized = { kind: 'multiplier', value: Number(adj.price_multiplier) };

    if (!normalized) continue;
    const before = cents;
    cents = applyAdjustment(cents, normalized);
    applied.push({
      ruleId: r.id,
      ruleType: r.rule_type,
      name: r.rule_type,
      kind: normalized.kind,
      value: normalized.value,
      beforeCents: before,
      afterCents: cents,
    });
  }

  return {
    basePriceCents: base,
    adjustedPriceCents: cents,
    applied,
    segment,
    demand,
    constraints: null,
  };
}

/** Public entrypoint. */
async function calculatePrice(args) {
  try {
    if (!args || !args.businessId || !args.targetId) {
      throw new Error('businessId and targetId required');
    }
    if (args.kind === 'service') return priceService(args);
    if (args.kind === 'product') return priceProduct(args);
    throw new Error(`unknown kind: ${args.kind}`);
  } catch (err) {
    logger.warn('pricingEngine.calculatePrice failed; returning base unchanged', {
      err: err.message,
      args: { businessId: args && args.businessId, kind: args && args.kind, targetId: args && args.targetId },
    });
    return {
      basePriceCents: args && args.basePriceCents != null ? Number(args.basePriceCents) : 0,
      adjustedPriceCents: args && args.basePriceCents != null ? Number(args.basePriceCents) : 0,
      applied: [],
      segment: 'unknown',
      demand: 0,
      constraints: null,
      error: err.message,
    };
  }
}

module.exports = { calculatePrice, priceService, priceProduct };
