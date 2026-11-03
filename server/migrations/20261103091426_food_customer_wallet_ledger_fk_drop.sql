-- Same class of issue as migration 088b for platform_ledger.user_id:
-- food_customer_wallet_ledger is append-only (migration 346 rules
-- food_customer_wallet_ledger_no_update / _no_delete, DO INSTEAD NOTHING),
-- so its foreign keys can never be honored on a parent delete:
-- ON DELETE CASCADE issues a child DELETE the rule swallows, and
-- ON DELETE SET NULL issues a child UPDATE the rule swallows, so the
-- parent delete then fails schema-wide with a referential-integrity
-- error instead of removing anything.
--
-- App paths already route wallet holders through retention or the
-- deletion guard and never rely on these cascades, so drop the ledger
-- FKs and keep the historical ids without FK enforcement, exactly as
-- 088b did for platform_ledger. Ledger rows are never updated or
-- deleted by this change; only the unenforceable constraints go away.
-- The wallet account table itself is NOT append-only, so its FKs stay.

ALTER TABLE food_customer_wallet_ledger
  DROP CONSTRAINT IF EXISTS food_customer_wallet_ledger_account_id_fkey;

ALTER TABLE food_customer_wallet_ledger
  DROP CONSTRAINT IF EXISTS food_customer_wallet_ledger_restaurant_id_fkey;

ALTER TABLE food_customer_wallet_ledger
  DROP CONSTRAINT IF EXISTS food_customer_wallet_ledger_customer_id_fkey;

ALTER TABLE food_customer_wallet_ledger
  DROP CONSTRAINT IF EXISTS food_customer_wallet_ledger_created_by_user_id_fkey;
