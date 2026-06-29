-- Store the currency used for each business invoice.
-- Existing invoices are backfilled from the owning business when that column
-- exists, otherwise USD is used. Keep this migration defensive because older
-- production databases may not have every Business Hub table/column yet.

DO $$
BEGIN
  IF to_regclass('public.business_invoices') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE business_invoices
    ADD COLUMN IF NOT EXISTS currency_code VARCHAR(3);

  IF to_regclass('public.businesses') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'businesses'
         AND column_name = 'currency_code'
     ) THEN
    UPDATE business_invoices bi
       SET currency_code = COALESCE(NULLIF(b.currency_code, ''), 'USD')
      FROM businesses b
     WHERE bi.business_id = b.id
       AND (bi.currency_code IS NULL OR bi.currency_code = '');
  END IF;

  ALTER TABLE business_invoices
    ALTER COLUMN currency_code SET DEFAULT 'USD';

  UPDATE business_invoices
     SET currency_code = 'USD'
   WHERE currency_code IS NULL OR currency_code = '';

  ALTER TABLE business_invoices
    ALTER COLUMN currency_code SET NOT NULL;
END $$;
