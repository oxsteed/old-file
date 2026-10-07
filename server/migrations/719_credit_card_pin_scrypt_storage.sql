-- Item 21: card PINs move from a fast SHA-256 hash to a memory-hard scrypt
-- hash stored as `$scrypt$N=...,r=...,p=...$<salt hex>$<key hex>` (~190 chars).
-- Widen pin_hash so the new format fits. No data migration: legacy SHA-256
-- hashes keep verifying on the fallback path and are upgraded to scrypt on
-- the next successful PIN verification.
ALTER TABLE oxsteed_credit_cards
  ALTER COLUMN pin_hash TYPE TEXT;
