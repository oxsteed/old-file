-- Migration 499: bind restaurant-operated Credit refunds to merchant access.
--
-- The API checks restaurant permissions before an order refund, but the
-- ledger should enforce the same accountability if another job or SQL path
-- writes a transaction directly. Historical rows that cannot be proven from
-- current ownership or membership records remain visible with an explicit
-- legacy marker.

ALTER TABLE oxsteed_credit_transactions
  ADD COLUMN IF NOT EXISTS restaurant_staff_evidence_legacy BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE oxsteed_credit_transactions t
   SET restaurant_staff_evidence_legacy = TRUE
 WHERE t.restaurant_staff_evidence_legacy = FALSE
   AND t.transaction_type = 'refund'
   AND t.actor_type = 'restaurant_staff'
   AND NOT EXISTS (
     SELECT 1
       FROM oxsteed_credit_partners p
       JOIN food_restaurants fr ON fr.id = p.restaurant_id
       LEFT JOIN businesses b ON b.id = p.business_id
       JOIN users u ON u.id = t.actor_user_id
      WHERE p.id = t.partner_id
        AND u.is_active = TRUE
        AND (
          b.user_id = u.id
          OR fr.owner_user_id = u.id
          OR EXISTS (
            SELECT 1
              FROM business_members bm
             WHERE bm.business_id = p.business_id
               AND bm.member_id = u.id
               AND bm.status = 'active'
          )
        )
   );

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_restaurant_staff_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  actor_is_valid BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.restaurant_staff_evidence_legacy THEN
    RAISE EXCEPTION 'New restaurant-operated OxSteed Credit refunds cannot use legacy staff evidence'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.restaurant_staff_evidence_legacy
     AND NOT NEW.restaurant_staff_evidence_legacy THEN
    RAISE EXCEPTION 'Legacy restaurant staff evidence cannot be cleared'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.transaction_type = 'refund'
     AND NEW.actor_type = 'restaurant_staff'
     AND NOT NEW.restaurant_staff_evidence_legacy THEN
    SELECT EXISTS (
      SELECT 1
        FROM oxsteed_credit_partners p
        JOIN food_restaurants fr ON fr.id = p.restaurant_id
        LEFT JOIN businesses b ON b.id = p.business_id
        JOIN users u ON u.id = NEW.actor_user_id
       WHERE p.id = NEW.partner_id
         AND u.is_active = TRUE
         AND (
           b.user_id = u.id
           OR fr.owner_user_id = u.id
           OR EXISTS (
             SELECT 1
               FROM business_members bm
              WHERE bm.business_id = p.business_id
                AND bm.member_id = u.id
                AND bm.status = 'active'
           )
         )
    ) INTO actor_is_valid;

    IF NOT actor_is_valid THEN
      RAISE EXCEPTION 'Restaurant-operated OxSteed Credit refunds require an active merchant operator'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_restaurant_staff_evidence_guard ON oxsteed_credit_transactions;

CREATE TRIGGER oxsteed_credit_restaurant_staff_evidence_guard
  BEFORE INSERT OR UPDATE OF transaction_type, actor_type, actor_user_id,
    partner_id, restaurant_staff_evidence_legacy
  ON oxsteed_credit_transactions
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_restaurant_staff_evidence();
