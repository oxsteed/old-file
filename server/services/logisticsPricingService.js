'use strict';
/**
 * Logistics Pricing Engine
 * Computes stackable landed cost for a given product + lane + quantity.
 * Layers (in application order):
 *   1. product cost
 *   2. origin handling fee
 *   3. sourcing fee
 *   4. OxSteed markup
 *   5. freight estimate
 *   6. customs / admin fee
 *   7. warehouse fee
 *   8. split-fulfillment fee (pooled only)
 *   9. last-mile fee
 *  10. risk surcharge
 *
 * Markup control layers (highest priority wins):
 *   global → lane → category → supplier → campaign → admin_override → super_override
 */

const pool = require('../db');
const logger = require('../utils/logger');

// Simple 60-second in-process cache for fee/markup rules
let _rulesCache = null;
let _rulesCacheAt = 0;
const CACHE_TTL_MS = 60_000;

async function loadRules() {
  const now = Date.now();
  if (_rulesCache && now - _rulesCacheAt < CACHE_TTL_MS) return _rulesCache;
  const [markups, fees] = await Promise.all([
    pool.query(`SELECT * FROM markup_rules WHERE is_active = TRUE ORDER BY priority ASC`),
    pool.query(`SELECT * FROM fee_rules    WHERE is_active = TRUE ORDER BY priority ASC`),
  ]);
  _rulesCache = { markups: markups.rows, fees: fees.rows };
  _rulesCacheAt = now;
  return _rulesCache;
}

function invalidateCache() {
  _rulesCache = null;
}

/**
 * Resolve effective markup % for a given context.
 * Returns decimal (e.g. 0.20 = 20%).
 */
function resolveMarkup(markups, { laneId, category, supplierId, campaignId, scope } = {}) {
  // Start with global default
  let effective = 0.15;
  const SCOPE_PRIORITY = { global: 0, lane: 1, category: 2, supplier: 3, campaign: 4, admin_override: 5, super_override: 6 };

  // Apply in priority order (lowest first, each override replaces previous for matching scope)
  const relevant = markups
    .filter(r => {
      if (r.scope === 'global') return true;
      if (r.scope === 'lane'     && r.scope_id === laneId)     return true;
      if (r.scope === 'category' && r.category === category)   return true;
      if (r.scope === 'supplier' && r.scope_id === supplierId) return true;
      if (r.scope === 'campaign' && r.scope_id === campaignId) return true;
      if (r.scope === 'admin_override' || r.scope === 'super_override') return true;
      return false;
    })
    .sort((a, b) => SCOPE_PRIORITY[a.scope] - SCOPE_PRIORITY[b.scope]);

  for (const rule of relevant) {
    if (rule.markup_pct !== null) effective = parseFloat(rule.markup_pct);
  }
  return effective;
}

/**
 * Resolve a specific fee amount in cents for a given fee type + context.
 * If both pct_of_product and amount_cents are set, they stack.
 */
function resolveFee(fees, feeType, productCostCents, { laneId, category } = {}) {
  const relevant = fees.filter(f => {
    if (f.fee_type !== feeType) return false;
    if (f.scope === 'global') return true;
    if (f.scope === 'lane' && f.lane_id === laneId) return true;
    if (f.scope === 'category' && f.category === category) return true;
    return false;
  });

  // Sum all matching (stacking model)
  let total = 0;
  for (const fee of relevant) {
    total += (fee.amount_cents || 0);
    total += Math.round(productCostCents * (parseFloat(fee.pct_of_product) || 0));
  }
  // Clamp if max_cents is set
  const max = relevant.find(f => f.max_cents)?.max_cents;
  if (max) total = Math.min(total, max);
  return total;
}

/**
 * Main pricing function.
 * All monetary inputs in USD. Returns breakdown + totals.
 */
async function calculateLandedCost({
  unitProductCostUSD,
  qty,
  laneId,
  supplierId,
  category,
  campaignId,
  freightEstUSD = 0,    // per-unit freight estimate if known
  isPooled = false,
  manualOverrides = {},
}) {
  try {
    const { markups, fees } = await loadRules();

    const productCostCents = Math.round(unitProductCostUSD * 100);
    const totalProductCents = productCostCents * qty;

    const markupPct = manualOverrides.markupPct != null
      ? manualOverrides.markupPct
      : resolveMarkup(markups, { laneId, category, supplierId, campaignId });

    const originHandlingCents  = resolveFee(fees, 'origin_handling',  productCostCents, { laneId, category });
    const sourcingFeeCents     = resolveFee(fees, 'sourcing',          productCostCents, { laneId, category });
    const markupCents          = Math.round(productCostCents * markupPct);
    const freightCents         = freightEstUSD ? Math.round(freightEstUSD * 100) : resolveFee(fees, 'freight_est', productCostCents, { laneId, category });
    const customsAdminCents    = resolveFee(fees, 'customs_admin',     productCostCents, { laneId, category });
    const warehouseCents       = resolveFee(fees, 'warehouse',         productCostCents, { laneId, category });
    const splitFulfillmentCents= isPooled ? resolveFee(fees, 'split_fulfillment', productCostCents, { laneId, category }) : 0;
    const lastMileCents        = resolveFee(fees, 'last_mile',         productCostCents, { laneId, category });
    const riskSurchargeCents   = resolveFee(fees, 'risk_surcharge',    productCostCents, { laneId, category });

    const unitLandedCents =
      productCostCents +
      originHandlingCents +
      sourcingFeeCents +
      markupCents +
      freightCents +
      customsAdminCents +
      warehouseCents +
      splitFulfillmentCents +
      lastMileCents +
      riskSurchargeCents;

    const totalLandedCents = unitLandedCents * qty;

    const toUSD = c => +(c / 100).toFixed(4);

    return {
      qty,
      unitCost: {
        product:          toUSD(productCostCents),
        originHandling:   toUSD(originHandlingCents),
        sourcingFee:      toUSD(sourcingFeeCents),
        markup:           toUSD(markupCents),
        freight:          toUSD(freightCents),
        customsAdmin:     toUSD(customsAdminCents),
        warehouse:        toUSD(warehouseCents),
        splitFulfillment: toUSD(splitFulfillmentCents),
        lastMile:         toUSD(lastMileCents),
        riskSurcharge:    toUSD(riskSurchargeCents),
        landed:           toUSD(unitLandedCents),
      },
      totals: {
        product:  toUSD(totalProductCents),
        landed:   toUSD(totalLandedCents),
      },
      markupPct,
    };
  } catch (err) {
    logger.error('logisticsPricingService.calculateLandedCost failed', { err: err.message });
    // Fallback: return product cost only
    const unit = parseFloat(unitProductCostUSD) || 0;
    return {
      qty,
      unitCost: { product: unit, landed: unit },
      totals: { product: unit * qty, landed: unit * qty },
      markupPct: 0,
      fallback: true,
    };
  }
}

module.exports = { calculateLandedCost, resolveMarkup, resolveFee, invalidateCache, loadRules };
