"use strict";
const CANONICAL = Object.freeze({
  customer: "customer",
  helper: "helper",
  broker: "broker",
  business: "business",
  business_owner: "business",
  business_manager: "business",
  restaurant: "restaurant",
  restaurant_owner: "restaurant",
  restaurant_manager: "restaurant",
});
function canonicalRole(role) {
  return CANONICAL[role] || null;
}
const ROLE_SQL =
  "CASE WHEN u.role IN ('business_owner','business_manager') THEN 'business' WHEN u.role IN ('restaurant_owner','restaurant_manager') THEN 'restaurant' ELSE u.role END";
module.exports = { canonicalRole, ROLE_SQL };
