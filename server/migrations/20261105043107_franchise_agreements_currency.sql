-- Franchise agreement currency (franchise currency reporting fix).
--
-- franchise_agreements.initial_fee_cents was summed in money-overview
-- reporting with no currency at all, so fees in different currencies were
-- silently added together as dollars. This adds the currency the fee is
-- denominated in. No FX conversion anywhere: reporting scopes by currency
-- and headlines the USD rows only; other currencies surface as a separate
-- per-currency breakdown.
--
-- Backfill: the owning program's default_currency, reached through the
-- agreement's application (franchise_applications.program_id). A program
-- default that is not a clean 3-letter code backfills to USD rather than
-- failing the migration. New rows default to USD; the creation path copies
-- the program default and the admin upsert accepts a validated code.

ALTER TABLE IF EXISTS franchise_agreements
  ADD COLUMN IF NOT EXISTS currency CHAR(3) NOT NULL DEFAULT 'USD';

UPDATE franchise_agreements fa
   SET currency = CASE
     WHEN fp.default_currency ~ '^[A-Za-z]{3}$'
       THEN UPPER(fp.default_currency)
     ELSE 'USD'
   END
  FROM franchise_applications fap
  JOIN franchise_programs fp ON fp.id = fap.program_id
 WHERE fa.application_id = fap.id
   AND fa.currency = 'USD';

CREATE INDEX IF NOT EXISTS idx_franchise_agreements_currency
  ON franchise_agreements (currency);
