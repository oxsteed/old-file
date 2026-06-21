-- One operator may have only one open POS shift at a restaurant. This makes
-- drawer ownership deterministic for orders, payments, and cash events.
WITH ranked_open_shifts AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY restaurant_id, staff_user_id
           ORDER BY opened_at DESC, id DESC
         ) AS open_rank
    FROM restaurant_pos_shifts
   WHERE status = 'open' AND staff_user_id IS NOT NULL
)
UPDATE restaurant_pos_shifts s
   SET status = 'closed',
       closed_at = COALESCE(s.closed_at, NOW()),
       metadata = s.metadata || '{"closedByMigration":"338_restaurant_pos_shift_integrity"}'::jsonb
  FROM ranked_open_shifts ranked
 WHERE s.id = ranked.id AND ranked.open_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurant_pos_one_open_shift_per_staff
  ON restaurant_pos_shifts (restaurant_id, staff_user_id)
  WHERE status = 'open' AND staff_user_id IS NOT NULL;
