-- Migration 941: backfill restaurant timezones from their primary location
-- or business (franchise review F-01).
--
-- Why: every restaurant created on the web was stored with timezone 'UTC'
-- (the onboarding form never sent one and the Business Hub path never copied
-- businesses.timezone), so open/closed checks, queue-number day resets and
-- daily reports ran on UTC for stores everywhere else. Creation paths now
-- capture and validate a real IANA timezone; this migration repairs the
-- rows that already exist, using the best on-file evidence first:
--   1. the primary location's timezone (restaurant_locations, migration 319)
--   2. the owning business's timezone, when it is not itself 'UTC'
-- Restaurants with no non-UTC evidence stay 'UTC' for the owner to confirm
-- in settings. Only rows still on 'UTC' are touched.

UPDATE food_restaurants fr
   SET timezone = COALESCE(
         (SELECT l.timezone
            FROM restaurant_locations l
           WHERE l.restaurant_id = fr.id
             AND l.is_primary = TRUE
             AND l.timezone IS NOT NULL
             AND l.timezone <> ''
             AND l.timezone <> 'UTC'
           LIMIT 1),
         (SELECT b.timezone
            FROM businesses b
           WHERE b.id = fr.business_id
             AND b.timezone IS NOT NULL
             AND b.timezone <> ''
             AND b.timezone <> 'UTC'
           LIMIT 1),
         fr.timezone
       ),
       updated_at = NOW()
 WHERE fr.timezone = 'UTC'
   AND (
     EXISTS (
       SELECT 1
         FROM restaurant_locations l
        WHERE l.restaurant_id = fr.id
          AND l.is_primary = TRUE
          AND l.timezone IS NOT NULL
          AND l.timezone <> ''
          AND l.timezone <> 'UTC'
     )
     OR EXISTS (
       SELECT 1
         FROM businesses b
        WHERE b.id = fr.business_id
          AND b.timezone IS NOT NULL
          AND b.timezone <> ''
          AND b.timezone <> 'UTC'
     )
   );
