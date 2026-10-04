-- Migration 678: provisional credit tracking on OxSteed Credit disputes.
--
-- The published error-resolution policy promises provisional credit while a
-- dispute is under review (10-business-day investigation window). Provisional
-- credit is issued as a compensating adjustment that keeps the dispute open;
-- this column tracks the cumulative provisional amount per dispute so the
-- final resolution compensation cap can account for it and double issuance
-- is impossible.

ALTER TABLE oxsteed_credit_disputes
  ADD COLUMN IF NOT EXISTS provisional_credit_cents BIGINT NOT NULL DEFAULT 0
    CHECK (provisional_credit_cents >= 0);
