'use strict';

// F-19: chain-grade tax computation for restaurant orders.
//
// The legacy model applied one flat restaurant rate to the discounted
// subtotal. This module adds, without an external tax engine:
//   - per-store tax RULES (restaurant_tax_rules): multiple named rates
//     with a target (line items, the delivery fee, or the service fee).
//     When item rules exist they stack and replace the flat rate; when
//     none exist the per-item tax_rate_bps (migration 967) falls back to
//     the store/restaurant rate, exactly like the legacy behavior.
//   - VAT/GST tax-inclusive pricing mode per store: tax is extracted
//     from the price instead of added on top.
//   - fee taxability flags per store (service_fee_taxable,
//     delivery_fee_taxable): when set, the matching fee carries tax at
//     the fee rules' stacked rate (or the item-rate fallback).
//   - tax-exempt orders: tax is zeroed and the reason is snapshotted.
//
// Every order persists tax_rule_snapshot: the exact rules, rates and
// per-line math that produced its tax, so later rule edits never rewrite
// history. Avalara/Stripe Tax integration is deliberately out of scope.

const TAX_APPLIES_TO = new Set(['items', 'delivery_fee', 'service_fee']);

function clampRateBps(value) {
  const n = Math.round(Number(value) || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10000, n));
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

async function loadStoreTaxRules(db, { restaurantId, locationId = null }) {
  const { rows } = await db.query(
    `SELECT id, name, rate_bps, applies_to
       FROM restaurant_tax_rules
      WHERE restaurant_id = $1
        AND is_active = TRUE
        AND (location_id IS NULL OR location_id = $2::bigint)
      ORDER BY sort_order ASC, id ASC`,
    [restaurantId, locationId]
  );
  return rows
    .filter((row) => TAX_APPLIES_TO.has(row.applies_to))
    .map((row) => ({
      id: Number(row.id),
      name: row.name,
      rateBps: clampRateBps(row.rate_bps),
      appliesTo: row.applies_to,
    }));
}

// restaurantRow carries the store-overlaid fields (useStoreDetails);
// locationRow is the raw store row (may be null when the brand has no
// stores). Explicit store columns win; NULL inherits the brand value.
function resolveStoreTaxPolicy({ locationRow = null, restaurantRow = {}, rules = [] }) {
  const itemRules = [];
  const deliveryFeeRules = [];
  const serviceFeeRules = [];
  for (const rule of rules) {
    if (rule.appliesTo === 'items') itemRules.push(rule);
    else if (rule.appliesTo === 'delivery_fee') deliveryFeeRules.push(rule);
    else if (rule.appliesTo === 'service_fee') serviceFeeRules.push(rule);
  }
  const taxInclusive = firstDefined(locationRow?.tax_inclusive, restaurantRow?.tax_inclusive) === true;
  return {
    taxInclusive,
    defaultRateBps: clampRateBps(firstDefined(locationRow?.tax_rate_bps, restaurantRow?.tax_rate_bps, 0)),
    itemRules,
    deliveryFeeRules,
    serviceFeeRules,
    serviceFeeTaxable: firstDefined(locationRow?.service_fee_taxable, restaurantRow?.service_fee_taxable) === true,
    deliveryFeeTaxable: firstDefined(locationRow?.delivery_fee_taxable, restaurantRow?.delivery_fee_taxable) === true,
  };
}

// Convenience: load the active rules and resolve the policy in one call.
// db is any queryable (pool or transaction client).
async function resolveStoreTaxPolicyForOrder(db, { restaurantId, locationRow = null, restaurantRow = {} }) {
  const locationId = locationRow?.id != null ? Number(locationRow.id) : null;
  const rules = await loadStoreTaxRules(db, { restaurantId, locationId });
  return resolveStoreTaxPolicy({ locationRow, restaurantRow, rules });
}

function stackedRateBps(rules) {
  return clampRateBps(rules.reduce((sum, rule) => sum + Number(rule.rateBps || 0), 0));
}

// Pro-rata discount allocation: proportional per line with the rounding
// remainder on the last line (same convention as the legacy tax helper,
// so snapshots stay comparable).
function allocateLineTaxables(lines, discountCents) {
  const subtotal = lines.reduce((sum, line) => sum + Math.max(0, Number(line.lineTotalCents) || 0), 0);
  const discount = Math.max(0, Math.min(subtotal, Math.round(Number(discountCents) || 0)));
  let remaining = discount;
  return lines.map((line, index) => {
    const lineTotal = Math.max(0, Number(line.lineTotalCents) || 0);
    const share = index === lines.length - 1
      ? Math.min(lineTotal, remaining)
      : Math.min(lineTotal, subtotal > 0 ? Math.round((discount * lineTotal) / subtotal) : 0, remaining);
    remaining -= share;
    return { line, taxableCents: Math.max(0, lineTotal - share) };
  });
}

// Portion of a tax-inclusive amount that is tax.
function extractTax(inclusiveCents, rateBps) {
  if (rateBps <= 0 || inclusiveCents <= 0) return 0;
  return Math.round((inclusiveCents * rateBps) / (10000 + rateBps));
}

function computeOrderTax({
  lines = [],
  discountCents = 0,
  policy,
  serviceFeeCents = 0,
  deliveryFeeCents = 0,
  taxExempt = false,
  taxExemptReason = null,
}) {
  if (!policy) throw new Error('computeOrderTax requires a tax policy');
  const allocated = allocateLineTaxables(lines, discountCents);
  const feeCents = Math.max(0, Math.round(Number(serviceFeeCents) || 0));
  const deliveryCents = Math.max(0, Math.round(Number(deliveryFeeCents) || 0));
  const exempt = taxExempt === true;
  const snapshot = {
    mode: policy.taxInclusive ? 'inclusive' : 'exclusive',
    taxExempt: exempt,
    taxExemptReason: exempt ? (taxExemptReason || null) : null,
    defaultRateBps: policy.defaultRateBps,
    rules: [
      ...policy.itemRules,
      ...policy.serviceFeeRules,
      ...policy.deliveryFeeRules,
    ].map((rule) => ({ id: rule.id, name: rule.name, rateBps: rule.rateBps, appliesTo: rule.appliesTo })),
    lines: [],
    serviceFee: { feeCents, taxable: policy.serviceFeeTaxable, rateBps: 0, taxCents: 0 },
    deliveryFee: { feeCents: deliveryCents, taxable: policy.deliveryFeeTaxable, rateBps: 0, taxCents: 0 },
    computedAt: new Date().toISOString(),
  };
  if (exempt) {
    snapshot.lines = allocated.map(({ line, taxableCents }) => ({
      menuItemId: line.menuItemId ?? line.menu_item_id ?? null,
      taxableCents,
      rateBps: 0,
      taxCents: 0,
      taxExempt: true,
    }));
    return { taxCents: 0, feeTaxCents: 0, totalTaxCents: 0, breakdown: snapshot.lines, snapshot };
  }
  const stackedItemRate = policy.itemRules.length ? stackedRateBps(policy.itemRules) : null;
  let itemTax = 0;
  for (const { line, taxableCents } of allocated) {
    const lineExempt = line.taxExempt === true || line.tax_exempt === true;
    const rateBps = lineExempt
      ? 0
      : stackedItemRate !== null
        ? stackedItemRate
        : clampRateBps(firstDefined(line.taxRateBps, line.tax_rate_bps, policy.defaultRateBps));
    const taxCents = lineExempt || taxableCents <= 0
      ? 0
      : policy.taxInclusive
        ? extractTax(taxableCents, rateBps)
        : Math.round((taxableCents * rateBps) / 10000);
    itemTax += taxCents;
    snapshot.lines.push({
      menuItemId: line.menuItemId ?? line.menu_item_id ?? null,
      taxableCents,
      rateBps,
      taxCents,
      taxExempt: lineExempt,
    });
  }
  // Fee taxes: explicit fee rules win; otherwise the stacked item rate (or
  // the default rate) applies when the fee is flagged taxable.
  const feeRateFor = (feeRules) => (feeRules.length
    ? stackedRateBps(feeRules)
    : stackedItemRate !== null ? stackedItemRate : policy.defaultRateBps);
  let serviceFeeTax = 0;
  let deliveryFeeTax = 0;
  if (policy.serviceFeeTaxable && feeCents > 0) {
    const rateBps = feeRateFor(policy.serviceFeeRules);
    serviceFeeTax = policy.taxInclusive
      ? extractTax(feeCents, rateBps)
      : Math.round((feeCents * rateBps) / 10000);
    snapshot.serviceFee.rateBps = rateBps;
    snapshot.serviceFee.taxCents = serviceFeeTax;
  }
  if (policy.deliveryFeeTaxable && deliveryCents > 0) {
    const rateBps = feeRateFor(policy.deliveryFeeRules);
    deliveryFeeTax = policy.taxInclusive
      ? extractTax(deliveryCents, rateBps)
      : Math.round((deliveryCents * rateBps) / 10000);
    snapshot.deliveryFee.rateBps = rateBps;
    snapshot.deliveryFee.taxCents = deliveryFeeTax;
  }
  return {
    taxCents: itemTax,
    feeTaxCents: serviceFeeTax + deliveryFeeTax,
    totalTaxCents: itemTax + serviceFeeTax + deliveryFeeTax,
    breakdown: snapshot.lines,
    snapshot,
  };
}

// Order total given the computed tax. In inclusive (VAT/GST) mode the tax
// is extracted from prices, never added; in exclusive mode the full tax
// (items + taxable fees) is added on top.
function orderTotalWithTax({ taxableSubtotalCents, tipCents = 0, serviceFeeCents = 0, deliveryFeeCents = 0, tax }) {
  const base = Math.max(0, Math.round(Number(taxableSubtotalCents) || 0));
  const tip = Math.max(0, Math.round(Number(tipCents) || 0));
  const fees = Math.max(0, Math.round(Number(serviceFeeCents) || 0))
    + Math.max(0, Math.round(Number(deliveryFeeCents) || 0));
  const taxAdd = tax.snapshot.mode === 'inclusive' ? 0 : Math.max(0, Math.round(Number(tax.totalTaxCents) || 0));
  return Math.max(0, base + taxAdd + fees + tip);
}

module.exports = {
  TAX_APPLIES_TO,
  clampRateBps,
  loadStoreTaxRules,
  resolveStoreTaxPolicy,
  resolveStoreTaxPolicyForOrder,
  computeOrderTax,
  orderTotalWithTax,
};
