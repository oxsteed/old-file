-- Migration 655: dual-posting backfill queue for rail-disabled periods.
--
-- When the OxSteed Credit rail is disabled, food-wallet writes fail OPEN:
-- the wallet mutation proceeds and the central-journal mirror is queued
-- here in the same transaction (atomic with the wallet write). When the
-- rail is re-enabled, a sweeper replays pending rows through
-- postFoodWalletDualEntry, which resolves to the same deterministic
-- idempotency key, so replays can never double-post.
--
-- This is distinct from the operator freeze (credit_rail_frozen), which
-- still fails closed: a freeze means "do not move money", while a disabled
-- rail means "the central journal is not authoritative right now".

CREATE TABLE IF NOT EXISTS credit_dual_posting_backfill (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key  TEXT NOT NULL UNIQUE,
  ledger_entry_id  TEXT NOT NULL,
  restaurant_id    TEXT NOT NULL,
  customer_id      TEXT,
  currency_code    TEXT NOT NULL,
  amount_cents     BIGINT NOT NULL CHECK (amount_cents > 0),
  entry_type       TEXT NOT NULL,
  reference_type   TEXT NOT NULL,
  reference_id     TEXT,
  actor_type       TEXT NOT NULL DEFAULT 'system',
  actor_user_id    UUID,
  created_by_user_id UUID,
  correlation_id   TEXT,
  request_ip       TEXT,
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'processed', 'failed')),
  attempts         INT NOT NULL DEFAULT 0,
  last_error       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_credit_dual_posting_backfill_pending
  ON credit_dual_posting_backfill (created_at)
  WHERE status = 'pending';
