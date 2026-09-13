-- Migration 510: preserve the signing-key version used for each Credit entry.
--
-- Existing entries were signed with the original application secret. They are
-- labeled v1 so a later key rotation can retain the old key for verification
-- without rewriting or weakening historical ledger evidence.

ALTER TABLE oxsteed_credit_transaction_entries
  ADD COLUMN IF NOT EXISTS hash_key_version VARCHAR(64) NOT NULL DEFAULT 'v1';

ALTER TABLE oxsteed_credit_transaction_entries
  DROP CONSTRAINT IF EXISTS oxsteed_credit_entry_hash_key_version_check;

ALTER TABLE oxsteed_credit_transaction_entries
  ADD CONSTRAINT oxsteed_credit_entry_hash_key_version_check
  CHECK (hash_key_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$');
