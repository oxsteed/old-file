'use strict';

// Listing readiness checklist (Group 11 item 552). Pure function over a
// tool_rentals row as returned by GET /tool-rentals/me: photos present,
// specs complete, pricing set, pickup/delivery options set. A listing is
// "ready" only when every check passes. Deliberately separate from the
// activation status (item 555, D-262): readiness is about completeness,
// activation is about publication.

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function computeListingReadiness(tool = {}) {
  const photos = (Array.isArray(tool.image_gallery)
    && tool.image_gallery.some((url) => hasText(url)))
    || hasText(tool.image_url);
  const specs = ['name', 'category', 'description', 'brand', 'model', 'condition']
    .every((key) => hasText(tool[key]));
  const dailyRate = Number(tool.daily_rate);
  const pricing = Number.isFinite(dailyRate) && dailyRate > 0
    && (tool.requires_deposit !== true || Number(tool.deposit_amount) > 0);
  const fulfillment = tool.pickup_only === true || tool.delivery_available === true;
  const checks = { photos, specs, pricing, fulfillment };
  const missing = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([key]) => key);
  return { ready: missing.length === 0, checks, missing };
}

module.exports = { computeListingReadiness };
