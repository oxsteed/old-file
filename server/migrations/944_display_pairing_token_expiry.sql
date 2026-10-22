-- Migration 944: display pairing token expiry and rotation (franchise
-- review F-27).
--
-- Pairing tokens for wall displays previously never expired: a token copied
-- off a TV worked forever. Following the restaurant_app_devices pattern
-- (migration 786), display pairing tokens now get a bounded 90-day lifetime,
-- verified on every token check, and are rotated on heartbeat before they
-- lapse. The previous token hash is kept for a short grace window so a
-- display that misses the rotation response keeps working until its
-- original expiry.

ALTER TABLE display_pairings
  ADD COLUMN IF NOT EXISTS pairing_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pairing_token_hash_prev TEXT,
  ADD COLUMN IF NOT EXISTS pairing_token_prev_expires_at TIMESTAMPTZ;

-- Existing paired displays get a full lifetime from this migration; their
-- next heartbeats adopt the rotation cycle.
UPDATE display_pairings
   SET pairing_token_expires_at = NOW() + INTERVAL '90 days'
 WHERE paired_at IS NOT NULL
   AND pairing_token_hash IS NOT NULL
   AND pairing_token_expires_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_display_pairings_token_expiry
  ON display_pairings (pairing_token_expires_at)
  WHERE paired_at IS NOT NULL AND pairing_token_hash IS NOT NULL;
