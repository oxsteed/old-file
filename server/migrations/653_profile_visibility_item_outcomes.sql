-- Migration 653: durable per-item outcomes for bulk profile visibility.
-- A request-level idempotency claim prevents concurrent starts, but a lost
-- response after one item commits must also be replayable without reapplying
-- that item's profile mutation or audit record.

CREATE TABLE IF NOT EXISTS bulk_visibility_idempotency_items (
  idempotency_key TEXT NOT NULL,
  item_index INTEGER NOT NULL CHECK (item_index >= 0),
  profile_type TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (idempotency_key, item_index),
  CONSTRAINT bulk_visibility_item_key_fk
    FOREIGN KEY (idempotency_key)
    REFERENCES bulk_visibility_idempotency (idempotency_key)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bulk_visibility_items_profile
  ON bulk_visibility_idempotency_items (profile_type, profile_id, created_at DESC);
