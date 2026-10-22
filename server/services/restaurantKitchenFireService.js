'use strict';

// F-04: fire-on-pay kitchen ticket mode for the POS checkout.
//
// A restaurant (or an individual store) can choose whether the kitchen
// ticket fires when the order is created ('on_send', the historical
// behavior) or only after a payment lands ('on_pay'). In on_pay mode the
// order row is created with kitchen_ticket_fired_at NULL, no printer
// jobs are enqueued, and the KDS queue board hides the ticket until the
// first payment reconciles, at which point the ticket fires exactly
// once (the printer-job idempotency key makes re-firing a no-op).

const KITCHEN_FIRE_MODES = new Set(['on_send', 'on_pay']);
const KITCHEN_FIRE_MODE_DEFAULT = 'on_send';

function normalizeKitchenFireMode(value) {
  const mode = value === null || value === undefined || value === ''
    ? null
    : String(value).trim().toLowerCase().replace(/-/g, '_');
  if (mode === null) return null;
  return KITCHEN_FIRE_MODES.has(mode) ? mode : null;
}

function safeJsonSettings(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// Store column wins; NULL inherits the restaurant-level settings key;
// anything unrecognized falls back to the default (fail closed to the
// historical fire-on-send behavior).
function resolveKitchenFireMode({ locationRow = null, restaurantSettings = null } = {}) {
  const storeMode = normalizeKitchenFireMode(locationRow?.kitchen_fire_mode);
  if (storeMode) return storeMode;
  const settings = safeJsonSettings(restaurantSettings);
  const brandMode = normalizeKitchenFireMode(
    settings.kitchenFireMode ?? settings.kitchen_fire_mode
  );
  return brandMode || KITCHEN_FIRE_MODE_DEFAULT;
}

// Fire the kitchen ticket for an order exactly once: enqueue the printer
// jobs and stamp kitchen_ticket_fired_at. Safe to call repeatedly; the
// conditional UPDATE and the printer-job idempotency key make a second
// fire a no-op. Returns { fired, jobs }.
async function fireKitchenTicketForOrder(client, { orderId, restaurantId, createdBy = null }) {
  const { enqueueKitchenPrinterJobs } = require('./restaurantKitchenPrinterService');
  const { rows: [order] } = await client.query(
    `UPDATE food_orders
        SET kitchen_ticket_fired_at = COALESCE(kitchen_ticket_fired_at, NOW()),
            updated_at = NOW()
      WHERE id = $1 AND restaurant_id = $2
      RETURNING id`,
    [orderId, restaurantId]
  );
  if (!order) return { fired: false, jobs: [] };
  const jobs = await enqueueKitchenPrinterJobs(client, { restaurantId, orderId, createdBy });
  return { fired: true, jobs };
}

module.exports = {
  KITCHEN_FIRE_MODES,
  KITCHEN_FIRE_MODE_DEFAULT,
  normalizeKitchenFireMode,
  resolveKitchenFireMode,
  fireKitchenTicketForOrder,
};
