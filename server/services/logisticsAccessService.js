'use strict';
/**
 * Logistics access / restriction resolver.
 * Combines logistics_lanes, trade_rules, country_access_rules, and supplier_products
 * restricted_markets / compliance_flags into a single answer for any (user, country,
 * lane, product, category) tuple.
 *
 * Used by user-facing endpoints to filter what a buyer can see/buy and by the
 * compliance dashboard to surface review items.
 */
const pool = require('../db');
const logger = require('../utils/logger');

// 60-second cache for active country/trade rules
let _rulesCache = null;
let _rulesCacheAt = 0;
const CACHE_TTL_MS = 60_000;

async function loadGlobalRules() {
  const now = Date.now();
  if (_rulesCache && now - _rulesCacheAt < CACHE_TTL_MS) return _rulesCache;
  const [tr, car] = await Promise.all([
    pool.query(`SELECT * FROM trade_rules WHERE is_active = TRUE`),
    pool.query(`SELECT * FROM country_access_rules`),
  ]);
  _rulesCache = { tradeRules: tr.rows, countryRules: car.rows };
  _rulesCacheAt = now;
  return _rulesCache;
}

function invalidateCache() { _rulesCache = null; }

/**
 * Evaluate whether a buyer in a country with a given role can buy
 * a product (or category) on a given lane.
 *
 * Returns: { allowed, blockers: [...], warnings: [...], requiresApproval, requiresBusinessVerification, riskTier }
 */
async function evaluateAccess({
  laneId, category, productRestrictedMarkets = [], complianceFlags = [],
  buyerCountry, userRole, isBusinessVerified = false, isResellerApproved = false,
} = {}) {
  const result = {
    allowed: true,
    blockers: [],
    warnings: [],
    requiresApproval: false,
    requiresBusinessVerification: false,
    requiresResellerApproval: false,
    riskTier: 'low',
  };

  try {
    const { tradeRules, countryRules } = await loadGlobalRules();

    // 1. Product-level restricted markets
    if (Array.isArray(productRestrictedMarkets) && productRestrictedMarkets.includes(buyerCountry)) {
      result.allowed = false;
      result.blockers.push({ kind: 'product_restricted_market', country: buyerCountry });
    }

    // 2. Lane lookup
    let lane = null;
    if (laneId) {
      const r = await pool.query('SELECT * FROM logistics_lanes WHERE id = $1', [laneId]);
      lane = r.rows[0] || null;
    }
    if (lane) {
      if (!lane.is_active) {
        result.allowed = false;
        result.blockers.push({ kind: 'lane_inactive' });
      }
      result.riskTier = lane.risk_tier || 'low';
      if (lane.allowed_buyer_countries && lane.allowed_buyer_countries.length > 0 && buyerCountry) {
        if (!lane.allowed_buyer_countries.includes(buyerCountry) && !lane.allowed_buyer_countries.includes('*')) {
          result.allowed = false;
          result.blockers.push({ kind: 'lane_country_not_allowed', country: buyerCountry });
        }
      }
      if (lane.allowed_buyer_roles && lane.allowed_buyer_roles.length > 0 && userRole) {
        if (!lane.allowed_buyer_roles.includes(userRole)) {
          result.allowed = false;
          result.blockers.push({ kind: 'lane_role_not_allowed', role: userRole });
        }
      }
      if (lane.restricted_categories && category && lane.restricted_categories.includes(category)) {
        result.allowed = false;
        result.blockers.push({ kind: 'lane_restricted_category', category });
      }
      if (lane.requires_manual_approval) result.requiresApproval = true;
      if (lane.requires_business_verification) {
        result.requiresBusinessVerification = true;
        if (!isBusinessVerified) {
          result.allowed = false;
          result.blockers.push({ kind: 'business_verification_required' });
        }
      }
      if (lane.requires_reseller_approval) {
        result.requiresResellerApproval = true;
        if (!isResellerApproved) {
          result.allowed = false;
          result.blockers.push({ kind: 'reseller_approval_required' });
        }
      }
    }

    // 3. Trade rules (global + lane-scoped)
    const relevantTradeRules = tradeRules.filter(r =>
      (!r.lane_id || r.lane_id === laneId) &&
      (!r.country_code || r.country_code === buyerCountry) &&
      (!r.category || r.category === category)
    );
    for (const rule of relevantTradeRules) {
      if (rule.severity === 'prohibited') {
        result.allowed = false;
        result.blockers.push({ kind: 'trade_rule', rule_type: rule.rule_type, description: rule.description });
      } else if (rule.severity === 'restricted') {
        result.warnings.push({ kind: 'trade_rule', rule_type: rule.rule_type, description: rule.description });
        result.requiresApproval = true;
      } else if (rule.rule_type === 'business_only' && !isBusinessVerified) {
        result.allowed = false;
        result.blockers.push({ kind: 'business_only', description: rule.description });
      } else if (rule.rule_type === 'manual_review') {
        result.requiresApproval = true;
      }
    }

    // 4. Country access rules (per category)
    if (category && buyerCountry) {
      const row = countryRules.find(r => r.category === category && r.country_code === buyerCountry);
      if (row) {
        if (!row.is_visible) {
          result.allowed = false;
          result.blockers.push({ kind: 'category_not_visible_in_country' });
        }
        if (!row.is_purchasable) {
          result.allowed = false;
          result.blockers.push({ kind: 'category_not_purchasable_in_country' });
        }
        if (row.allowed_buyer_types && row.allowed_buyer_types.length > 0 && userRole) {
          if (!row.allowed_buyer_types.includes(userRole)) {
            result.allowed = false;
            result.blockers.push({ kind: 'buyer_type_not_allowed_for_category' });
          }
        }
        if (row.requires_approval) result.requiresApproval = true;
        if (row.risk_tier && row.risk_tier !== 'low') {
          // Bump risk tier if higher
          const order = { low: 0, managed: 1, restricted: 2, prohibited: 3 };
          if ((order[row.risk_tier] || 0) > (order[result.riskTier] || 0)) {
            result.riskTier = row.risk_tier;
          }
        }
      }
    }

    // 5. Compliance flags from product (informational warnings)
    if (Array.isArray(complianceFlags)) {
      for (const flag of complianceFlags) {
        result.warnings.push({ kind: 'compliance_flag', flag });
      }
    }
  } catch (err) {
    logger.error('logisticsAccessService.evaluateAccess failed', { err: err.message });
    // Fail closed on the gating dimensions, but don't return cryptic errors to caller
    result.allowed = false;
    result.blockers.push({ kind: 'access_eval_error' });
  }

  return result;
}

/**
 * Convenience: filter a list of supplier_products + lane by buyer context.
 * Returns a parallel array of { product, access } so the UI can render disabled cards.
 */
async function annotateProductsForBuyer(products, { buyerCountry, userRole, isBusinessVerified } = {}) {
  const out = [];
  for (const p of products) {
    const access = await evaluateAccess({
      laneId: p.lane_id || null,
      category: p.category,
      productRestrictedMarkets: p.restricted_markets || [],
      complianceFlags: p.compliance_flags || [],
      buyerCountry, userRole, isBusinessVerified,
    });
    out.push({ product: p, access });
  }
  return out;
}

module.exports = { evaluateAccess, annotateProductsForBuyer, invalidateCache };
