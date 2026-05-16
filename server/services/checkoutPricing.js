'use strict';

/**
 * server/services/checkoutPricing.js
 *
 * Phase 4d — bridges the pricingEngine into checkout pipelines.
 *
 * The legacy cart pulls a static `mp.price_cents` from marketplace_products.
 * For business-source items (source_business_id IS NOT NULL) we want to
 * apply that business's dynamic pricing rules at the moment of checkout
 * without rewriting the whole flow.
 *
 * Usage from cartCheckoutController:
 *
 *   const { applyDynamicPricingToCartItems } = require('../services/checkoutPricing');
 *   const repriced = await applyDynamicPricingToCartItems({
 *     items: cartItemRows,        // each row: { product_id, business_product_id, source_business_id, price_cents, quantity, ... }
 *     customerId: req.user && req.user.id,
 *   });
 *   // repriced[i].adjusted_price_cents reflects the engine output
 *   // repriced[i].applied is the audit trail (rules that fired)
 *
 * Items with no source_business_id get pass-through pricing.
 */

const pricingEngine = require('./pricingEngine');
const logger = require('../utils/logger');

async function applyDynamicPricingToCartItems({ items, customerId, atTimeIso }) {
  if (!Array.isArray(items) || items.length === 0) return [];

  const out = [];
  for (const item of items) {
    const businessId = item.source_business_id;
    const businessProductId = item.business_product_id;
    const basePrice = Number(item.price_cents) || 0;

    if (!businessId || !businessProductId) {
      // Non-business item (Home Depot affiliate, internal) — keep as-is.
      out.push({
        ...item,
        adjusted_price_cents: basePrice,
        applied: [],
        priced_by: 'static',
      });
      continue;
    }

    try {
      const result = await pricingEngine.calculatePrice({
        businessId,
        kind: 'product',
        targetId: businessProductId,
        basePriceCents: basePrice,
        quantity: Number(item.quantity) || 1,
        customerId: customerId || null,
        atTimeIso: atTimeIso || null,
      });
      out.push({
        ...item,
        adjusted_price_cents: result.adjustedPriceCents,
        applied: result.applied,
        segment: result.segment,
        demand: result.demand,
        priced_by: 'engine',
      });
    } catch (err) {
      logger.warn('checkout pricing engine failed; falling back to base', {
        businessProductId, err: err.message,
      });
      out.push({
        ...item,
        adjusted_price_cents: basePrice,
        applied: [],
        priced_by: 'static_fallback',
      });
    }
  }
  return out;
}

/**
 * Wrap a service booking price calc. Used by booking confirmation /
 * Stripe PaymentIntent creation so the upfront amount reflects rules.
 */
async function priceServiceBooking({ businessId, serviceId, basePriceCents, customerId, atTimeIso }) {
  try {
    return await pricingEngine.calculatePrice({
      businessId,
      kind: 'service',
      targetId: serviceId,
      basePriceCents,
      quantity: 1,
      customerId: customerId || null,
      atTimeIso: atTimeIso || null,
    });
  } catch (err) {
    logger.warn('priceServiceBooking failed; using base', { serviceId, err: err.message });
    return {
      basePriceCents: basePriceCents || 0,
      adjustedPriceCents: basePriceCents || 0,
      applied: [],
      priced_by: 'static_fallback',
    };
  }
}

module.exports = { applyDynamicPricingToCartItems, priceServiceBooking };
