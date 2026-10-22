'use strict';

// F-33: automatic prep-time extension under load.
//
// When a store opts in (prep_time_auto_extend_* on restaurant_locations,
// migration 99919), the quoted and promised prep time grows with the number
// of open tickets:
//
//   extension = min(maxMin, max(0, openTickets - thresholdOrders) * perOrderMin)
//
// All three settings default to 0 (disabled), preserving current behavior
// until a manager opts a store in. The manual prep_time_extension_min
// stacks on top; callers add it themselves.
//
// Open tickets are orders in an active kitchen state for the store.
// Scheduled orders whose fire time has not arrived yet do not count: the
// kitchen is not working them. Tickets waiting on payment in fire-on-pay
// mode (F-04) do count: they hit the kitchen within a minute of payment,
// so quoting without them would under-promise during a rush.

const ACTIVE_KITCHEN_STATUSES = ['received', 'accepted', 'preparing', 'ready'];

async function getAutoExtendSettings(db, { restaurantId, locationId }) {
  if (locationId === null || locationId === undefined) return null;
  const { rows: [row] } = await db.query(
    `SELECT prep_time_auto_extend_max_min,
            prep_time_auto_extend_threshold_orders,
            prep_time_auto_extend_per_order_min
       FROM restaurant_locations
      WHERE id = $1 AND restaurant_id = $2`,
    [locationId, restaurantId]
  );
  if (!row) return null;
  return {
    maxMin: Math.max(0, Math.min(240, Number(row.prep_time_auto_extend_max_min) || 0)),
    thresholdOrders: Math.max(0, Math.min(1000, Number(row.prep_time_auto_extend_threshold_orders) || 0)),
    perOrderMin: Math.max(0, Math.min(60, Number(row.prep_time_auto_extend_per_order_min) || 0)),
  };
}

async function countOpenTickets(db, { restaurantId, locationId = null }) {
  const { rows: [row] } = await db.query(
    `SELECT COUNT(*)::int AS open_tickets
       FROM food_orders
      WHERE restaurant_id = $1
        AND ($2::bigint IS NULL OR location_id IS NOT DISTINCT FROM $2::bigint)
        AND status = ANY($3)
        AND (scheduled_for IS NULL OR scheduled_for <= NOW())`,
    [restaurantId, locationId, ACTIVE_KITCHEN_STATUSES]
  );
  return Number(row?.open_tickets || 0);
}

async function computeAutoPrepExtensionMinutes(db, { restaurantId, locationId = null }) {
  const settings = await getAutoExtendSettings(db, { restaurantId, locationId });
  if (!settings || settings.maxMin <= 0 || settings.perOrderMin <= 0) {
    return { extensionMin: 0, openTickets: 0, enabled: false, settings };
  }
  const openTickets = await countOpenTickets(db, { restaurantId, locationId });
  const over = Math.max(0, openTickets - settings.thresholdOrders);
  const extensionMin = Math.min(settings.maxMin, over * settings.perOrderMin);
  return { extensionMin, openTickets, enabled: true, settings };
}

module.exports = {
  ACTIVE_KITCHEN_STATUSES,
  getAutoExtendSettings,
  countOpenTickets,
  computeAutoPrepExtensionMinutes,
};
