-- Prevent direct SQL and overlooked application paths from resurrecting
-- terminal food orders. Refunds remain an explicit terminal transition.
CREATE OR REPLACE FUNCTION enforce_food_order_terminal_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'refunded' AND NEW.status <> 'refunded' THEN
    RAISE EXCEPTION 'refunded food order cannot be reopened'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.status = 'completed' AND NEW.status NOT IN ('completed', 'refunded') THEN
    RAISE EXCEPTION 'completed food order cannot move backward'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.status = 'cancelled' AND NEW.status NOT IN ('cancelled', 'refunded') THEN
    RAISE EXCEPTION 'cancelled food order cannot be reopened'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.payment_status = 'refunded' AND NEW.payment_status <> 'refunded' THEN
    RAISE EXCEPTION 'refunded food order payment cannot be reopened'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS food_order_terminal_integrity_guard ON food_orders;
CREATE TRIGGER food_order_terminal_integrity_guard
  BEFORE UPDATE OF status, payment_status ON food_orders
  FOR EACH ROW
  EXECUTE FUNCTION enforce_food_order_terminal_integrity();
