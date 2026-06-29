-- Store the currency used for each business invoice.
-- Existing invoices are backfilled from the owning business so historical records
-- keep matching the business market instead of assuming USD everywhere.

ALTER TABLE business_invoices
  ADD COLUMN IF NOT EXISTS currency_code VARCHAR(3);

UPDATE business_invoices bi
SET currency_code = COALESCE(NULLIF(b.currency_code, ''), 'USD')
FROM businesses b
WHERE bi.business_id = b.id
  AND (bi.currency_code IS NULL OR bi.currency_code = '');

ALTER TABLE business_invoices
  ALTER COLUMN currency_code SET DEFAULT 'USD';

UPDATE business_invoices
SET currency_code = 'USD'
WHERE currency_code IS NULL OR currency_code = '';

ALTER TABLE business_invoices
  ALTER COLUMN currency_code SET NOT NULL;
