-- Migration 911: restaurant display pairings (Track B).
--
-- Wall displays (queue board, kiosk, kitchen screen) are public, no-login
-- pages shown on TVs. A TV must never need a staff login, so pairing works
-- like a Chromecast-style claim flow:
--   1. The TV calls POST /api/restaurant/displays/pairing-code with its
--      restaurant id and shows the returned 6-character code large.
--   2. The TV polls POST /api/restaurant/displays/status with the code.
--   3. The restaurant owner enters the code + a label (e.g. "Dining room TV")
--      in the Displays tab of the merchant dashboard, which claims it and
--      receives a random pairing token (returned once).
--   4. The TV's status poll returns the token exactly once
--      (token_delivered_at), stores it locally, and heartbeats with it.
--
-- Security: only SHA-256 hashes of codes and tokens are stored here. The raw
-- code and the raw token are never persisted and must never be logged.
-- Codes are single-use for claiming and expire after 10 minutes.

CREATE TABLE IF NOT EXISTS display_pairings (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  -- SHA-256 hex of the 6-character human-typable code. Kept after claim so
  -- the TV's status poll can deliver the token; claims are single-use via
  -- paired_at IS NULL, enforced at claim time with a conditional UPDATE.
  code_hash TEXT NOT NULL,
  -- SHA-256 hex of the random pairing token issued at claim time. Used as
  -- the heartbeat Authorization: Bearer credential of this display.
  pairing_token_hash TEXT,
  -- The raw token, encrypted with the server ENCRYPTION_KEY, held in escrow
  -- so the TV's status poll can pick it up exactly once. Nulled out on first
  -- delivery; never logged.
  pairing_token_encrypted TEXT,
  -- Set when the token is first delivered to the TV's status poll. The token
  -- is delivered exactly once, so guessing the short code after delivery
  -- reveals nothing.
  token_delivered_at TIMESTAMPTZ,
  label TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  paired_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  -- Set by the owner ("refresh now" in the fleet panel); the next heartbeat
  -- consumes it so the TV reloads its data.
  refresh_requested_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT display_pairings_code_hash_format CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT display_pairings_token_hash_format CHECK (pairing_token_hash IS NULL OR pairing_token_hash ~ '^[0-9a-f]{64}$'),
  -- A pairing is either an unclaimed code or a claimed display, never both.
  -- The encrypted token escrow exists only between claim and first delivery.
  CONSTRAINT display_pairings_claim_state CHECK (
    (paired_at IS NULL AND pairing_token_hash IS NULL AND pairing_token_encrypted IS NULL AND token_delivered_at IS NULL)
    OR (paired_at IS NOT NULL AND pairing_token_hash IS NOT NULL
        AND (token_delivered_at IS NULL OR pairing_token_encrypted IS NULL))
  )
);

CREATE INDEX IF NOT EXISTS display_pairings_restaurant_id
  ON display_pairings(restaurant_id);

-- Unclaimed-code lookup at claim/status time.
CREATE UNIQUE INDEX IF NOT EXISTS display_pairings_code_hash
  ON display_pairings(code_hash);

-- Heartbeat token lookup.
CREATE INDEX IF NOT EXISTS display_pairings_token_hash
  ON display_pairings(pairing_token_hash) WHERE pairing_token_hash IS NOT NULL;
