-- Migration 495: active customer access requires an active Credit agreement.
--
-- An entitlement is the customer-specific side of a partner agreement. It may
-- be suspended or revoked for an inactive agreement, but it must never become
-- spend-capable while the agreement, partner, or restaurant is inactive.

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_entitlement_agreement_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  agreement_status VARCHAR(24);
  partner_status VARCHAR(24);
  restaurant_status VARCHAR(24);
  agreement_end TIMESTAMPTZ;
BEGIN
  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;

  SELECT a.status, a.ends_at, p.status, fr.status
    INTO agreement_status, agreement_end, partner_status, restaurant_status
    FROM oxsteed_credit_partner_agreements a
    JOIN oxsteed_credit_partners p ON p.id = a.partner_id
    JOIN food_restaurants fr ON fr.id = p.restaurant_id
   WHERE a.id = NEW.agreement_id;

  IF agreement_status IS DISTINCT FROM 'active'
     OR partner_status IS DISTINCT FROM 'active'
     OR restaurant_status IS DISTINCT FROM 'active'
     OR (agreement_end IS NOT NULL AND agreement_end <= CURRENT_TIMESTAMP) THEN
    RAISE EXCEPTION 'Active OxSteed Credit entitlements require an active, unexpired agreement and partner'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_entitlement_agreement_state_guard
  ON oxsteed_credit_customer_entitlements;

CREATE TRIGGER oxsteed_credit_entitlement_agreement_state_guard
  BEFORE INSERT OR UPDATE OF status, agreement_id, starts_at, ends_at
  ON oxsteed_credit_customer_entitlements
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_entitlement_agreement_state();
