-- 877_logistics_credit_surface.sql
-- Phase 3 (logistics refactor): OxSteed Credit spend surface for logistics.
--
-- Adds the 'logistics' participant type and the 'logistics' spend surface
-- to credit_participants. A logistics participant is anchored to a
-- business_id that an admin explicitly enrolls as the OxSteed logistics
-- collection entity (partner row with restaurant_id NULL, business_id set);
-- it is NEVER a restaurant participant and there is no default merchant.
-- The participant only becomes payable once it is active, Didit-verified,
-- its partner is active, and 'logistics' is in allowed_surfaces (all
-- enforced by creditParticipantService / creditSpendAdapter at spend time).
--
-- Additive: rewrites the three CHECK constraints from migration 725 as
-- supersets (existing rows remain valid).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credit_participants_participant_type_check') THEN
    ALTER TABLE credit_participants DROP CONSTRAINT credit_participants_participant_type_check;
  END IF;
END $$;

ALTER TABLE credit_participants
  ADD CONSTRAINT credit_participants_participant_type_check
  CHECK (participant_type IN (
    'restaurant', 'business', 'helper', 'subscription_merchant', 'qr_merchant',
    'delivery_merchant', 'consulting_seller', 'invoice_seller',
    'product_seller', 'rental_seller', 'logistics'
  ));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credit_participants_allowed_surfaces_check') THEN
    ALTER TABLE credit_participants DROP CONSTRAINT credit_participants_allowed_surfaces_check;
  END IF;
END $$;

ALTER TABLE credit_participants
  ADD CONSTRAINT credit_participants_allowed_surfaces_check
  CHECK (allowed_surfaces <@ ARRAY[
    'food_online', 'food_pos', 'chat', 'jobs', 'direct', 'qr',
    'subscriptions', 'delivery', 'consulting', 'invoices',
    'products', 'rentals', 'logistics'
  ]::TEXT[]);

-- Subject-linkage CHECK (auto-named credit_participants_check in 725).
-- A logistics participant is subject-bound to exactly one business_id,
-- exactly like 'business' / 'delivery_merchant'.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credit_participants_check') THEN
    ALTER TABLE credit_participants DROP CONSTRAINT credit_participants_check;
  END IF;
END $$;

ALTER TABLE credit_participants
  ADD CONSTRAINT credit_participants_check
  CHECK (
    (participant_type = 'restaurant'
      AND restaurant_id IS NOT NULL AND business_id IS NULL AND user_id IS NULL)
    OR (participant_type IN ('business', 'delivery_merchant', 'logistics')
      AND business_id IS NOT NULL AND restaurant_id IS NULL AND user_id IS NULL)
    OR (participant_type IN ('helper', 'consulting_seller')
      AND user_id IS NOT NULL AND restaurant_id IS NULL AND business_id IS NULL)
    OR (participant_type IN ('subscription_merchant', 'qr_merchant', 'invoice_seller', 'product_seller', 'rental_seller')
      AND (
        (business_id IS NOT NULL AND restaurant_id IS NULL AND user_id IS NULL)
        OR (user_id IS NOT NULL AND restaurant_id IS NULL AND business_id IS NULL)
      ))
  );

COMMENT ON COLUMN credit_participants.participant_type IS
  'logistics = the admin-enrolled OxSteed logistics collection entity (business_id). Never a restaurant participant; no default merchant.';

-- The agreement state guard (migration 479) inner-joins food_restaurants,
-- which makes an active agreement impossible for partners with
-- restaurant_id NULL (the logistics collection entity). Keep the exact
-- invariant for restaurant-anchored partners; for NULL-restaurant partners
-- only the partner's own active status is required.
CREATE OR REPLACE FUNCTION validate_oxsteed_credit_agreement_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  partner_status VARCHAR(24);
  partner_restaurant_id BIGINT;
  restaurant_status VARCHAR(24);
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status
     AND NOT (
       (OLD.status = 'draft' AND NEW.status IN ('pending_approval', 'terminated'))
       OR (OLD.status = 'pending_approval' AND NEW.status IN ('draft', 'active', 'terminated'))
       OR (OLD.status = 'active' AND NEW.status IN ('suspended', 'expired', 'terminated'))
       OR (OLD.status = 'suspended' AND NEW.status IN ('active', 'terminated'))
       OR (OLD.status = 'expired' AND NEW.status = 'terminated')
     ) THEN
    RAISE EXCEPTION 'Invalid OxSteed Credit agreement status transition'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'active' THEN
    SELECT p.status, p.restaurant_id, fr.status
      INTO partner_status, partner_restaurant_id, restaurant_status
      FROM oxsteed_credit_partners p
      LEFT JOIN food_restaurants fr ON fr.id = p.restaurant_id
     WHERE p.id = NEW.partner_id;

    IF partner_status IS DISTINCT FROM 'active'
       OR (partner_restaurant_id IS NOT NULL AND restaurant_status IS DISTINCT FROM 'active') THEN
      RAISE EXCEPTION 'Active OxSteed Credit agreements require an active partner and restaurant'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- The purchase boundary guard (migration 449) inner-joins food_restaurants,
-- which rejects purchases for partners with restaurant_id NULL (the
-- logistics collection entity). Same treatment: LEFT JOIN, restaurant
-- activity required only when the partner has a restaurant.
CREATE OR REPLACE FUNCTION validate_oxsteed_credit_purchase_boundary()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  agreement_status VARCHAR(24);
  partner_status VARCHAR(24);
  partner_restaurant_id BIGINT;
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

  SELECT a.status, p.status, p.restaurant_id, fr.status, a.starts_at, a.ends_at
    INTO agreement_status, partner_status, partner_restaurant_id, restaurant_status,
         agreement_starts_at, agreement_ends_at
    FROM oxsteed_credit_partner_agreements a
    JOIN oxsteed_credit_partners p ON p.id = a.partner_id
    LEFT JOIN food_restaurants fr ON fr.id = p.restaurant_id
   WHERE a.id = NEW.agreement_id
     AND a.partner_id = NEW.partner_id;

  IF NOT FOUND
     OR agreement_status <> 'active'
     OR partner_status <> 'active'
     OR (partner_restaurant_id IS NOT NULL AND restaurant_status <> 'active')
     OR agreement_starts_at > NOW()
     OR (agreement_ends_at IS NOT NULL AND agreement_ends_at <= NOW()) THEN
    RAISE EXCEPTION 'OxSteed Credit purchases require an active partner agreement'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
