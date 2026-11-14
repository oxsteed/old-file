-- Domain 6 finding 2 (2026-11-13): fresh-auth step-up events are single-use.
--
-- A TOTP proof minted one logistics_fresh_auth_events row that authorized
-- unlimited same-purpose actions for the whole 15-minute TTL window
-- (including multiple super-admin password-sets). The middleware now
-- consumes the event on first use: the lookup only considers unconsumed
-- events and stamps consumed_at atomically in the same statement, so
-- concurrent replays of one proof cannot both pass.
--
-- Events are never deleted: consumed_at keeps the audit trail of which
-- proof authorized which action (the approve service already records the
-- event's auth_hash on its decision row).
ALTER TABLE logistics_fresh_auth_events
  ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_fresh_auth_user_unconsumed
  ON logistics_fresh_auth_events (user_id, purpose, completed_at DESC)
  WHERE consumed_at IS NULL;
