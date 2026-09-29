-- Direct slot holds: sweeper-friendly indexes.
-- Migration 589 used `WHERE expires_at > CURRENT_TIMESTAMP` on a partial index,
-- but CURRENT_TIMESTAMP is STABLE (not IMMUTABLE) and is invalid / unreliable as
-- an index predicate. Rebuild as a plain composite index. The expires_at index
-- already exists for the TTL sweeper (directSlotHoldExpiry job).

DROP INDEX IF EXISTS idx_direct_slot_holds_service_range;

CREATE INDEX IF NOT EXISTS idx_direct_slot_holds_service_range
  ON direct_slot_holds (service_id, starts_at, ends_at);

-- Ensure reserved-user busy lookups stay cheap even when many expired rows linger
-- briefly between sweeper ticks.
DROP INDEX IF EXISTS idx_direct_slot_holds_reserved;
CREATE INDEX IF NOT EXISTS idx_direct_slot_holds_reserved
  ON direct_slot_holds (reserved_user_id, starts_at, ends_at, expires_at);
