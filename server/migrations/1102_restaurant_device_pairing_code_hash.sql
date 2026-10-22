-- Auth-audit finding 40: restaurant_app_devices pairing codes were stored in
-- plaintext (migration 335). Mirror the display flow: store only the
-- SHA-256 hash and never persist the raw code.
--
-- Additive and safe to re-run:
--   1. add pairing_code_hash (nullable),
--   2. backfill hashes for still-pending plaintext codes (upper-cased, the
--      same normalization pairDevice applies before matching),
--   3. clear the plaintext codes once hashed.
-- The pairing_code column itself is kept (nullable) for schema history;
-- new rows write NULL there.

ALTER TABLE restaurant_app_devices
  ADD COLUMN IF NOT EXISTS pairing_code_hash VARCHAR(64);

-- pgcrypto is a required extension in this database (see baseline).
UPDATE restaurant_app_devices
   SET pairing_code_hash = encode(digest(UPPER(pairing_code), 'sha256'), 'hex')
 WHERE pairing_code IS NOT NULL
   AND pairing_code_hash IS NULL
   AND status = 'pending'
   AND (pairing_code_expires_at IS NULL OR pairing_code_expires_at > NOW());

UPDATE restaurant_app_devices
   SET pairing_code = NULL
 WHERE pairing_code IS NOT NULL
   AND pairing_code_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_restaurant_app_devices_pairing_hash
  ON restaurant_app_devices (restaurant_id, pairing_code_hash)
  WHERE status = 'pending';
