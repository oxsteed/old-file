-- Domain 8 #14: helper_payment_policy_history is append-only (migration 579
-- installs helper_payment_policy_history_no_update / _no_delete,
-- DO INSTEAD NOTHING), so its helper_id REFERENCES users(id) ON DELETE
-- CASCADE can never be honored: the rule rewrites the cascade DELETE and
-- Postgres detects the rewritten RI query, so the helper delete fails with
-- "referential integrity query ... gave unexpected result" instead of
-- removing anything. Drop the FK and keep the historical helper id without
-- FK enforcement, exactly as 088b did for platform_ledger. History rows are
-- never updated or deleted by this change; only the unenforceable
-- constraint goes away.

ALTER TABLE helper_payment_policy_history
  DROP CONSTRAINT IF EXISTS helper_payment_policy_history_helper_id_fkey;
