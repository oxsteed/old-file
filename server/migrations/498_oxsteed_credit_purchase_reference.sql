-- Migration 498: bind food-order Credit purchases to durable order ownership.
--
-- A non-empty reference is not enough to prove what a purchase paid for. New
-- food-order purchases must point to an existing order owned by the debited
-- customer and placed at the partner restaurant. Historical rows that cannot
-- be reconstructed remain visible with an explicit legacy marker.

ALTER TABLE oxsteed_credit_transactions
  ADD COLUMN IF NOT EXISTS purchase_reference_evidence_legacy BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE oxsteed_credit_transactions t
   SET purchase_reference_evidence_legacy = TRUE
 WHERE t.purchase_reference_evidence_legacy = FALSE
   AND t.transaction_type = 'purchase'
   AND t.reference_type = 'food_order'
   AND NOT EXISTS (
     SELECT 1
       FROM food_orders o
       JOIN oxsteed_credit_partners p ON p.id = t.partner_id
      WHERE o.id::TEXT = t.reference_id
        AND o.customer_id IS NOT NULL
        AND o.customer_id = (
          SELECT a.customer_id
            FROM oxsteed_credit_accounts a
           WHERE a.id = t.debit_account_id
             AND a.account_type = 'customer_wallet'
        )
        AND o.restaurant_id = p.restaurant_id
   );

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_purchase_reference()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  customer_id UUID;
  restaurant_id BIGINT;
  order_customer_id UUID;
  order_restaurant_id BIGINT;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.purchase_reference_evidence_legacy THEN
    RAISE EXCEPTION 'New OxSteed Credit purchases cannot use legacy order evidence'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.purchase_reference_evidence_legacy
     AND NOT NEW.purchase_reference_evidence_legacy THEN
    RAISE EXCEPTION 'Legacy Credit purchase reference evidence cannot be cleared'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.transaction_type = 'purchase'
     AND NEW.reference_type = 'food_order'
     AND NOT NEW.purchase_reference_evidence_legacy THEN
    SELECT a.customer_id, p.restaurant_id
      INTO customer_id, restaurant_id
      FROM oxsteed_credit_accounts a
      JOIN oxsteed_credit_partners p ON p.id = NEW.partner_id
     WHERE a.id = NEW.debit_account_id
       AND a.account_type = 'customer_wallet';

    SELECT o.customer_id, o.restaurant_id
      INTO order_customer_id, order_restaurant_id
      FROM food_orders o
     WHERE o.id::TEXT = NEW.reference_id;

    IF order_customer_id IS NULL
       OR customer_id IS NULL
       OR order_customer_id IS DISTINCT FROM customer_id
       OR restaurant_id IS NULL
       OR order_restaurant_id IS DISTINCT FROM restaurant_id THEN
      RAISE EXCEPTION 'OxSteed Credit food-order purchases require matching order ownership'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_purchase_reference_guard ON oxsteed_credit_transactions;

CREATE TRIGGER oxsteed_credit_purchase_reference_guard
  BEFORE INSERT OR UPDATE OF transaction_type, reference_type, reference_id,
    debit_account_id, partner_id, purchase_reference_evidence_legacy
  ON oxsteed_credit_transactions
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_purchase_reference();
