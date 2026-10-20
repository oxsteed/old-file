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
// The user_role enum has no business or restaurant values (it is customer,
// helper, helper_pro, broker, admin, super_admin, employee), so comparing
// u.role to a business role name throws at execution time. Business and
// restaurant audiences are ownership-derived instead: a user is a business
// audience when they own a businesses row and a restaurant audience when
// they own a food_restaurants row. helper_pro is the paid helper tier and
// canonicalizes to helper. Restaurant wins over business when a user owns
// both; this expression is a grouping label for segments, clusters and
// rate priors, never an authorization input.
const ROLE_SQL =
  "CASE WHEN EXISTS(SELECT 1 FROM food_restaurants _r WHERE _r.owner_user_id=u.id) THEN 'restaurant' WHEN EXISTS(SELECT 1 FROM businesses _b WHERE _b.user_id=u.id) THEN 'business' WHEN u.role='helper_pro' THEN 'helper' ELSE u.role::text END";
module.exports = { canonicalRole, ROLE_SQL };
