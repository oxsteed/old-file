-- 832_food_orders_partially_refunded_status.sql
-- ADM-003: admin partial refunds write payment_status='partially_refunded'
-- but the CHECK constraint (migration 305) only allowed
-- ('unpaid','requires_payment','paid','failed','refunded'), so every partial
-- refund 500'd after the money moved. Extend the constraint to include the
-- new status. The constraint was created inline in 305, so its name is the
-- Postgres auto-name food_orders_payment_status_check.
-- Also backfill: any rows that somehow carry an out-of-constraint value are
-- left untouched (the drop+re-add validates existing rows; if a legacy DB
-- has a violating row the migration fails loudly instead of corrupting data).

DO $$
BEGIN
  ALTER TABLE food_orders DROP CONSTRAINT IF EXISTS food_orders_payment_status_check;
  ALTER TABLE food_orders
    ADD CONSTRAINT food_orders_payment_status_check
    CHECK (payment_status IN ('unpaid','requires_payment','paid','failed','refunded','partially_refunded'));
END $$;
