'use strict';

// Entity-level verification belongs to the represented entity, not to any
// verified business or restaurant the owner happens to have.
function verifiedActorSql(actor = 'a') {
  return `CASE
    WHEN ${actor}.actor_type = 'helper' THEN EXISTS (
      SELECT 1 FROM helper_profiles hp JOIN users hu ON hu.id = hp.user_id
       WHERE hp.user_id = ${actor}.owner_user_id AND hu.is_verified = TRUE
         AND hu.is_active = TRUE AND hu.is_banned = FALSE AND hu.deleted_at IS NULL)
    WHEN ${actor}.actor_type = 'business' THEN EXISTS (
      SELECT 1 FROM businesses b WHERE b.id = ${actor}.business_id
        AND b.user_id = ${actor}.owner_user_id AND b.deleted_at IS NULL
        AND b.is_active = TRUE AND b.is_business_verified = TRUE
        AND EXISTS (SELECT 1 FROM users bu WHERE bu.id = ${actor}.owner_user_id
          AND bu.deleted_at IS NULL AND bu.is_active = TRUE AND bu.is_banned = FALSE))
    WHEN ${actor}.actor_type = 'restaurant' THEN EXISTS (
      SELECT 1 FROM food_restaurants r WHERE r.id = ${actor}.restaurant_id
        AND r.owner_user_id = ${actor}.owner_user_id
        AND r.status <> 'suspended' AND r.is_verified = TRUE
        AND EXISTS (SELECT 1 FROM users ru WHERE ru.id = ${actor}.owner_user_id
          AND ru.deleted_at IS NULL AND ru.is_active = TRUE AND ru.is_banned = FALSE))
    ELSE FALSE END`;
}
module.exports = { verifiedActorSql };
