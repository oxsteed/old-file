-- Bind historical actors only when their original handle identifies an owned
-- entity. Never guess an entity from the owner's other verification flags.
WITH unambiguous AS (
  SELECT a.id AS actor_id, MIN(b.id) AS entity_id
    FROM media_actors a JOIN businesses b ON b.user_id = a.owner_user_id
   WHERE a.actor_type = 'business' AND a.business_id IS NULL
     AND (a.handle = 'business-' || b.id::text OR a.handle = b.profile_slug)
   GROUP BY a.id HAVING COUNT(*) = 1
)
UPDATE media_actors a SET business_id = exact.entity_id
  FROM unambiguous exact WHERE a.id = exact.actor_id AND a.business_id IS NULL;

WITH unambiguous AS (
  SELECT a.id AS actor_id, MIN(r.id) AS entity_id
    FROM media_actors a JOIN food_restaurants r ON r.owner_user_id = a.owner_user_id
   WHERE a.actor_type = 'restaurant' AND a.restaurant_id IS NULL
     AND (a.handle = 'restaurant-' || r.id::text OR a.handle = r.slug)
   GROUP BY a.id HAVING COUNT(*) = 1
)
UPDATE media_actors a SET restaurant_id = r.id, business_id = r.business_id
  FROM unambiguous exact JOIN food_restaurants r ON r.id = exact.entity_id
 WHERE a.id = exact.actor_id AND a.restaurant_id IS NULL;
