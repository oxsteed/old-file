-- Migration 296: Align business marketing schema with controller/UI actions.

ALTER TABLE business_broadcasts
  ADD COLUMN IF NOT EXISTS message TEXT,
  ADD COLUMN IF NOT EXISTS channel VARCHAR(30) NOT NULL DEFAULT 'email',
  ADD COLUMN IF NOT EXISTS audience VARCHAR(100) NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE business_broadcasts
SET message = COALESCE(message, body)
WHERE message IS NULL;

ALTER TABLE business_broadcasts
  ALTER COLUMN message SET NOT NULL;

ALTER TABLE business_broadcasts
  DROP CONSTRAINT IF EXISTS bb_status_check;

ALTER TABLE business_broadcasts
  ADD CONSTRAINT bb_status_check CHECK (status IN ('draft','scheduled','sent'));

ALTER TABLE business_promo_codes
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE business_promo_codes
SET expires_at = COALESCE(expires_at, valid_until::timestamptz)
WHERE expires_at IS NULL AND valid_until IS NOT NULL;

CREATE TABLE IF NOT EXISTS business_featured_placement_requests (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  requested_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
  category VARCHAR(160),
  zip VARCHAR(20),
  note TEXT,
  source VARCHAR(80) NOT NULL DEFAULT 'promote_page',
  status VARCHAR(30) NOT NULL DEFAULT 'requested',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bfpr_status_check CHECK (status IN ('requested','contacted','approved','declined','closed')),
  UNIQUE (business_id)
);

CREATE INDEX IF NOT EXISTS idx_bfpr_status ON business_featured_placement_requests(status, created_at DESC);
