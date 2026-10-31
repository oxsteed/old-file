-- Ledger-safe deletion finalize marker (recommendation track 10).
--
-- Admin user deletion soft-deletes the account and schedules permanent
-- deletion 30 days out (migration 165). There is no hard-delete executor,
-- and there must never be one for accounts with ledger history: the
-- food_customer_wallet_ledger no-delete rule swallows the ON DELETE CASCADE,
-- so a hard DELETE of users or food_restaurants fails schema-wide with a
-- referential-integrity error instead of removing anything.
--
-- The ledger-safe completion is anonymization, not removal: when the
-- schedule matures, finalizeScheduledDeletions() runs the established
-- erasure (pseudonymized account, scrubbed PII, financial records kept and
-- linked only to the pseudonymized account) and stamps this column. A set
-- value means the account must never be reinstated (restoreUser refuses it).
-- Ledger rows are never updated or deleted by this flow.

ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_finalized_at TIMESTAMPTZ;
