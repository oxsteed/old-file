-- Everything-ON order (Emile, 2026-11-28 ~01:51 EST, "No boundaries,
-- everything ON", D-752): credit payments are legally cleared by default.
-- Migration 762 created payment_country_policies with
-- credit_payment_legal_cleared DEFAULT FALSE; this flips the default and
-- marks every existing country row cleared. The Credit rail itself still
-- needs FEATURE_RAIL_CREDIT / FEATURE_PAYMENT_RAILS set in Coolify
-- (Emile's action); this migration only clears the legal gate. Additive
-- and idempotent: re-running changes nothing.
ALTER TABLE payment_country_policies
  ALTER COLUMN credit_payment_legal_cleared SET DEFAULT TRUE;

UPDATE payment_country_policies
  SET credit_payment_legal_cleared = TRUE
  WHERE credit_payment_legal_cleared IS DISTINCT FROM TRUE;
