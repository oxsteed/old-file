-- Migration 517: replace the original inline account checks after adding
-- partner reserve accounts in migration 514.
--
-- PostgreSQL assigned generated names to the inline checks from migration
-- 421. Migration 514 replaced only the explicitly named constraints, leaving
-- those older checks active and making every new partner_reserve account fail.

ALTER TABLE oxsteed_credit_accounts
  DROP CONSTRAINT IF EXISTS oxsteed_credit_accounts_check;

ALTER TABLE oxsteed_credit_accounts
  DROP CONSTRAINT IF EXISTS oxsteed_credit_accounts_check1;

ALTER TABLE oxsteed_credit_accounts
  ADD CONSTRAINT oxsteed_credit_accounts_balance_owner_check
  CHECK (
    balance_cents >= 0
    OR account_type IN ('partner_payable', 'partner_reserve', 'platform_treasury', 'platform_revenue')
  );

ALTER TABLE oxsteed_credit_accounts
  ADD CONSTRAINT oxsteed_credit_accounts_owner_check
  CHECK (
    (account_type = 'customer_wallet' AND customer_id IS NOT NULL AND partner_id IS NULL)
    OR (account_type IN ('partner_payable', 'partner_reserve') AND customer_id IS NULL AND partner_id IS NOT NULL)
    OR (account_type IN ('platform_treasury', 'platform_revenue') AND customer_id IS NULL AND partner_id IS NULL)
  );
