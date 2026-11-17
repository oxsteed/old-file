-- OxSteed Invest Track 6 (verifier fixes, 2026-11-17).
--
-- 1. Opportunity status gains 'unsuccessful': the fail-close terminal
--    state for a raise whose target was missed or whose deadline passed
--    (spec section 7/8). Previously the only terminal states were
--    'closed' (funded) and 'cancelled', so an unsuccessful raise had no
--    honest status and its reservations could strand as 'reserved'
--    forever. 'unsuccessful' reuses cancelled_at / cancellation_reason
--    as its terminal timestamp and reason, and carries the same
--    NOT NULL guard the 'cancelled' state has.
-- 2. investment_amendments gains review_note: the reviewer note recorded
--    when an amendment is marked effective or rejected, so the entity
--    can read why (the same shape as the participation-application
--    review_note).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'investment_opportunities_status_check'
       AND conrelid = 'investment_opportunities'::regclass
  ) THEN
    ALTER TABLE investment_opportunities
      DROP CONSTRAINT investment_opportunities_status_check;
    ALTER TABLE investment_opportunities
      ADD CONSTRAINT investment_opportunities_status_check
      CHECK (status IN ('draft', 'submitted', 'under_review', 'approved', 'published', 'paused', 'closing', 'closed', 'cancelled', 'withdrawn', 'unsuccessful'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'investment_opportunities_unsuccessful_check'
       AND conrelid = 'investment_opportunities'::regclass
  ) THEN
    ALTER TABLE investment_opportunities
      ADD CONSTRAINT investment_opportunities_unsuccessful_check
      CHECK (status <> 'unsuccessful' OR cancelled_at IS NOT NULL);
  END IF;
END $$;

ALTER TABLE investment_amendments
  ADD COLUMN IF NOT EXISTS review_note TEXT;
