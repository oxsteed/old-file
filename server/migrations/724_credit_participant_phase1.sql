-- Migration 724: Credit Everywhere Phase 1 — participant enablers.
--
-- 1. allowed_surfaces on partner agreements: which Credit surfaces
--    (food, chat, pos, jobs, qr, subscriptions, ...) this agreement
--    covers. Empty array = no surface restriction beyond the agreement.
-- 2. Relax oxsteed_credit_partners.restaurant_id to nullable: pure
--    business/helper participants need a partner row without a
--    restaurant. The UNIQUE constraint stays (PostgreSQL allows
--    multiple NULLs in a UNIQUE index); existing rows are unaffected.

ALTER TABLE oxsteed_credit_partner_agreements
  ADD COLUMN IF NOT EXISTS allowed_surfaces TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE oxsteed_credit_partners
  ALTER COLUMN restaurant_id DROP NOT NULL;
