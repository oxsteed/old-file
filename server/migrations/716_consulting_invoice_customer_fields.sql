-- Manual consulting invoices may not map to an existing user account.

ALTER TABLE consulting_invoices
  ALTER COLUMN user_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_consulting_invoices_customer_email_lower
  ON consulting_invoices (LOWER(TRIM(customer_email)))
  WHERE customer_email IS NOT NULL;
