-- Domain 8 #16: food_customer_wallet_operator_audit_events is append-only
-- (migration 348 installs food_customer_wallet_operator_audit_no_update /
-- _no_delete, DO INSTEAD NOTHING), so its four ON DELETE SET NULL FKs can
-- never be honored: the rule rewrites the nulling UPDATE and Postgres
-- detects the rewritten RI query, so deleting a user, a business, or a
-- wallet account fails with "referential integrity query ... gave
-- unexpected result" instead of removing anything. Drop the four SET NULL
-- FKs and keep the historical ids without FK enforcement, exactly as
-- 91426 did for the food_customer_wallet_ledger. The restaurant_id FK is
-- NOT touched: migration 624 converted it to RESTRICT, which fails closed
-- with 23503 as designed. Audit rows are never updated or deleted by this
-- change; only the unenforceable constraints go away.

ALTER TABLE food_customer_wallet_operator_audit_events
  DROP CONSTRAINT IF EXISTS food_customer_wallet_operator_audit_events_business_id_fkey;

ALTER TABLE food_customer_wallet_operator_audit_events
  DROP CONSTRAINT IF EXISTS food_customer_wallet_operator_audit_even_wallet_account_id_fkey;

ALTER TABLE food_customer_wallet_operator_audit_events
  DROP CONSTRAINT IF EXISTS food_customer_wallet_operator_audit_events_customer_id_fkey;

ALTER TABLE food_customer_wallet_operator_audit_events
  DROP CONSTRAINT IF EXISTS food_customer_wallet_operator_audit_event_operator_user_id_fkey;
