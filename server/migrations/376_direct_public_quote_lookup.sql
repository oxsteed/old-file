-- Migration 376: Public Direct quote lookup
-- Adds a public-safe quote reference, ZIP lookup support, and email
-- verification challenges so customers can view updates without signing in.

ALTER TABLE quote_requests
  ADD COLUMN IF NOT EXISTS public_reference VARCHAR(40),
  ADD COLUMN IF NOT EXISTS service_zip_code VARCHAR(20);

UPDATE quote_requests
   SET public_reference = COALESCE(
     NULLIF(public_reference, ''),
     'DQ-' || upper(substr(md5(random()::text || clock_timestamp()::text || id::text), 1, 24))
   )
 WHERE public_reference IS NULL
    OR public_reference = '';

ALTER TABLE quote_requests
  ALTER COLUMN public_reference SET DEFAULT ('DQ-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 24)));

ALTER TABLE quote_requests
  ALTER COLUMN public_reference SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_quote_requests_public_reference
  ON quote_requests (public_reference);

CREATE INDEX IF NOT EXISTS idx_quote_requests_service_zip_code
  ON quote_requests (service_zip_code);

CREATE INDEX IF NOT EXISTS idx_quote_requests_public_reference_created
  ON quote_requests (public_reference, created_at DESC);

CREATE TABLE IF NOT EXISTS direct_quote_lookup_challenges (
  id BIGSERIAL PRIMARY KEY,
  quote_request_id BIGINT NOT NULL REFERENCES quote_requests(id) ON DELETE CASCADE,
  challenge_token VARCHAR(120) NOT NULL UNIQUE,
  code_hash VARCHAR(128) NOT NULL,
  zip_code VARCHAR(20) NOT NULL,
  email_address VARCHAR(255) NOT NULL,
  code_expires_at TIMESTAMP NOT NULL,
  verified_at TIMESTAMP,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_direct_quote_lookup_challenges_request_created
  ON direct_quote_lookup_challenges (quote_request_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_direct_quote_lookup_challenges_token
  ON direct_quote_lookup_challenges (challenge_token);

CREATE INDEX IF NOT EXISTS idx_direct_quote_lookup_challenges_active
  ON direct_quote_lookup_challenges (quote_request_id, code_expires_at DESC)
  WHERE verified_at IS NULL;
