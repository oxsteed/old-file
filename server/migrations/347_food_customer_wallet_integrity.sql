-- Migration 347: Harden customer restaurant wallets with tamper-evident
-- ledger fields and account-level sequencing metadata.

ALTER TABLE food_customer_wallet_accounts
  ADD COLUMN IF NOT EXISTS ledger_version BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_entry_hash VARCHAR(128),
  ADD COLUMN IF NOT EXISTS last_posted_at TIMESTAMPTZ;

ALTER TABLE food_customer_wallet_ledger
  ADD COLUMN IF NOT EXISTS entry_sequence BIGINT,
  ADD COLUMN IF NOT EXISTS previous_entry_hash VARCHAR(128),
  ADD COLUMN IF NOT EXISTS entry_hash VARCHAR(128),
  ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(120),
  ADD COLUMN IF NOT EXISTS actor_type VARCHAR(40) NOT NULL DEFAULT 'system',
  ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS idx_food_customer_wallet_ledger_sequence
  ON food_customer_wallet_ledger(account_id, entry_sequence)
  WHERE entry_sequence IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_food_customer_wallet_ledger_hash
  ON food_customer_wallet_ledger(entry_hash)
  WHERE entry_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_food_customer_wallet_ledger_reference_guard
  ON food_customer_wallet_ledger(account_id, entry_type, reference_type, reference_id)
  WHERE reference_type IS NOT NULL
    AND reference_id IS NOT NULL;
