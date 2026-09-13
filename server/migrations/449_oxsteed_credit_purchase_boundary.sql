-- Migration 449: fail closed on untraceable or inactive Credit purchases.
--
-- Application validation remains responsible for customer entitlements,
-- limits, geography, and the emergency rail flag. This database guard adds a
-- final boundary for direct SQL and future services: a purchase must point to
-- an active partner agreement and a durable order/reference record.

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_purchase_boundary()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  agreement_status VARCHAR(24);
  partner_status VARCHAR(24);
  restaurant_status VARCHAR(24);
  agreement_starts_at TIMESTAMPTZ;
  agreement_ends_at TIMESTAMPTZ;
BEGIN
  IF NEW.transaction_type <> 'purchase' THEN
    RETURN NEW;
  END IF;

  IF NULLIF(BTRIM(NEW.reference_id), '') IS NULL THEN
    RAISE EXCEPTION 'OxSteed Credit purchases require an order or reference id'
      USING ERRCODE = '23514';
  END IF;

  SELECT a.status, p.status, fr.status, a.starts_at, a.ends_at
    INTO agreement_status, partner_status, restaurant_status,
         agreement_starts_at, agreement_ends_at
    FROM oxsteed_credit_partner_agreements a
    JOIN oxsteed_credit_partners p ON p.id = a.partner_id
    JOIN food_restaurants fr ON fr.id = p.restaurant_id
   WHERE a.id = NEW.agreement_id
     AND a.partner_id = NEW.partner_id;

  IF NOT FOUND
     OR agreement_status <> 'active'
     OR partner_status <> 'active'
     OR restaurant_status <> 'active'
     OR agreement_starts_at > NOW()
     OR (agreement_ends_at IS NOT NULL AND agreement_ends_at <= NOW()) THEN
    RAISE EXCEPTION 'OxSteed Credit purchases require an active partner agreement'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_purchase_boundary_guard ON oxsteed_credit_transactions;

CREATE TRIGGER oxsteed_credit_purchase_boundary_guard
  BEFORE INSERT OR UPDATE OF transaction_type, partner_id, agreement_id, reference_id
  ON oxsteed_credit_transactions
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_purchase_boundary();
