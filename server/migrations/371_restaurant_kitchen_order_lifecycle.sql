-- Migration 371: Canonical kitchen order lifecycle and idempotent audit trail.
-- Public order status remains backward compatible while kitchen_stage tracks
-- acknowledgement, station work, expo quality check, and guest handoff.

ALTER TABLE food_orders
  ADD COLUMN IF NOT EXISTS kitchen_stage VARCHAR(32) NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS kitchen_acknowledged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS preparation_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS quality_check_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS handed_off_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS handed_off_by UUID REFERENCES users(id) ON DELETE SET NULL;

DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT conname INTO constraint_name
    FROM pg_constraint
   WHERE conrelid = 'food_orders'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%kitchen_stage%'
   LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE food_orders DROP CONSTRAINT %I', constraint_name);
  END IF;

  ALTER TABLE food_orders
    ADD CONSTRAINT food_orders_kitchen_stage_check
    CHECK (kitchen_stage IN ('new','acknowledged','preparing','quality_check','ready','handed_off','cancelled'));
END $$;

UPDATE food_orders
   SET kitchen_stage = CASE status
     WHEN 'accepted' THEN 'acknowledged'
     WHEN 'preparing' THEN 'preparing'
     WHEN 'ready' THEN 'ready'
     WHEN 'completed' THEN 'handed_off'
     WHEN 'cancelled' THEN 'cancelled'
     WHEN 'refunded' THEN 'cancelled'
     ELSE 'new'
   END
 WHERE kitchen_stage = 'new' AND status <> 'received';

UPDATE food_orders
   SET kitchen_acknowledged_at = COALESCE(kitchen_acknowledged_at, accepted_at),
       preparation_started_at = CASE
         WHEN status IN ('preparing','ready','completed')
           THEN COALESCE(preparation_started_at, accepted_at, updated_at)
         ELSE preparation_started_at
       END,
       quality_check_at = CASE
         WHEN status IN ('ready','completed')
           THEN COALESCE(quality_check_at, ready_at, updated_at)
         ELSE quality_check_at
       END,
       handed_off_at = CASE
         WHEN status = 'completed'
           THEN COALESCE(handed_off_at, completed_at, updated_at)
         ELSE handed_off_at
       END;

ALTER TABLE restaurant_kitchen_events
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(160);

CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurant_kitchen_events_idempotency
  ON restaurant_kitchen_events(restaurant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_food_orders_kitchen_stage
  ON food_orders(restaurant_id, kitchen_stage, created_at DESC);
