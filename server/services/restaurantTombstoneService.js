'use strict';

/**
 * Ledger-safe restaurant tombstone completion.
 *
 * Deleting a business tombstones the businesses row (is_active = FALSE,
 * deleted_at = NOW()), and public restaurant reads already filter on
 * b.deleted_at IS NULL, so a deleted business's restaurants vanish from
 * public lists and profiles. But the food_restaurants rows themselves keep
 * their live status, so any managed or direct path that reads the restaurant
 * row without the business join (menu loads, kiosk, order flows keyed on
 * restaurant_id) would still treat the restaurant as usable.
 *
 * This closes that gap without touching the ledger: suspending the
 * restaurant rows of a tombstoned business changes no ledger row (ledger
 * rows reference restaurant_id, which still exists) and deletes nothing,
 * so the food_customer_wallet_ledger no-delete rule is never engaged.
 * Draft restaurants are left alone (a draft is not usable anyway), and
 * already-suspended rows are untouched. If the business is ever restored,
 * restaurants stay suspended until the owner explicitly re-activates them:
 * fail closed, never silently re-list a deleted store.
 *
 * @param {object} client - pg client/pool with .query
 * @param {number} businessId
 * @returns {Promise<number[]>} ids of the suspended restaurants
 */
async function suspendRestaurantsForBusiness(client, businessId) {
  const { rows } = await client.query(
    `UPDATE food_restaurants
        SET status = 'suspended',
            accepts_online_orders = FALSE,
            accepts_in_store_orders = FALSE,
            updated_at = NOW()
      WHERE business_id = $1
        AND status IN ('active', 'paused')
      RETURNING id`,
    [businessId]
  );
  return rows.map((r) => r.id);
}

module.exports = { suspendRestaurantsForBusiness };
