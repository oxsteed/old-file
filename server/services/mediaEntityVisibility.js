'use strict';

// Public Media entity checks are deliberately centralized so entity search,
// linked cards, locality ranking, and actor pages cannot drift apart.
function publicHelperSql(profile = 'hp', user = 'u') {
  return `COALESCE(${profile}.is_listed, TRUE) = TRUE
    AND COALESCE(${profile}.is_hidden_by_admin, FALSE) = FALSE
    AND ${user}.deleted_at IS NULL AND ${user}.is_active = TRUE AND ${user}.is_banned = FALSE
    AND COALESCE(${user}.is_verified, FALSE) = TRUE`;
}

function publicBusinessSql(business = 'b', user = null) {
  const owner = user ? `AND ${user}.deleted_at IS NULL AND ${user}.is_active = TRUE AND ${user}.is_banned = FALSE` : '';
  return `COALESCE(${business}.is_listed, TRUE) = TRUE
    AND COALESCE(${business}.is_hidden_by_admin, FALSE) = FALSE
    AND ${business}.deleted_at IS NULL AND ${business}.is_active = TRUE
    AND COALESCE(${business}.is_business_verified, FALSE) = TRUE ${owner}`;
}

function publicRestaurantSql(restaurant = 'r', user = null) {
  const owner = user ? `AND ${user}.deleted_at IS NULL AND ${user}.is_active = TRUE AND ${user}.is_banned = FALSE` : '';
  return `COALESCE(${restaurant}.discovery_status, 'visible') = 'visible'
    AND COALESCE(${restaurant}.is_hidden_by_admin, FALSE) = FALSE
    AND ${restaurant}.status = 'active'
    AND COALESCE(${restaurant}.is_verified, FALSE) = TRUE ${owner}`;
}

function publicActorSql(actor = 'a') {
  return `CASE
    WHEN ${actor}.actor_type = 'helper' THEN EXISTS (
      SELECT 1 FROM helper_profiles media_public_hp
      JOIN users media_public_hu ON media_public_hu.id = media_public_hp.user_id
      WHERE media_public_hp.user_id = ${actor}.owner_user_id
        AND ${publicHelperSql('media_public_hp', 'media_public_hu')})
    WHEN ${actor}.actor_type = 'business' THEN EXISTS (
      SELECT 1 FROM businesses media_public_b
      JOIN users media_public_bu ON media_public_bu.id = media_public_b.user_id
      WHERE media_public_b.id = ${actor}.business_id
        AND ${publicBusinessSql('media_public_b', 'media_public_bu')})
    WHEN ${actor}.actor_type = 'restaurant' THEN EXISTS (
      SELECT 1 FROM food_restaurants media_public_r
      JOIN users media_public_ru ON media_public_ru.id = media_public_r.owner_user_id
      WHERE media_public_r.id = ${actor}.restaurant_id
        AND ${publicRestaurantSql('media_public_r', 'media_public_ru')})
    ELSE FALSE END`;
}

module.exports = { publicHelperSql, publicBusinessSql, publicRestaurantSql, publicActorSql };
