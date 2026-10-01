-- Migration 642: OxSteed Credit restaurant conversion allowlist.
--
-- Emile's requirement: OxSteed controls which restaurants' credit may be
-- converted INTO OxSteed Credit (from_restaurant direction), so the platform
-- only allows conversion out where it controls the underlying cash, not the
-- restaurant owner.
--
-- Table restaurant_credit_conversion_policy is a per-restaurant allowlist:
-- a row with allow_restaurant_to_oxsteed switched on enables from_restaurant
-- conversions for that restaurant. Default-deny is the point: a missing
-- row means NOT enabled (no seed rows enable anything), and the conversion
-- service fails closed with 403 credit_conversion_restaurant_not_enabled.
--
-- The to_restaurant direction (OxSteed -> restaurant) is gated separately
-- on an active row in oxsteed_credit_partners, mirroring the food checkout
-- oxsteed_credit charge path; this table does not control it.
--
-- Idempotent: guarded CREATE TABLE / DO blocks with to_regclass checks.

DO $$
BEGIN
  IF to_regclass('public.restaurant_credit_conversion_policy') IS NULL THEN
    CREATE TABLE restaurant_credit_conversion_policy (
      restaurant_id BIGINT PRIMARY KEY
        REFERENCES food_restaurants (id) ON DELETE CASCADE,
      allow_restaurant_to_oxsteed BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by_user_id BIGINT NULL
    );
    COMMENT ON TABLE restaurant_credit_conversion_policy IS
      'Per-restaurant allowlist for from_restaurant credit conversions (restaurant credit -> OxSteed Credit). A missing row or FALSE denies the conversion; only OxSteed-controlled restaurants are enabled, via maker-checker admin approval.';
  END IF;
END;
$$;
