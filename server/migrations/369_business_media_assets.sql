-- Migration 369: Durable business profile media fallback.
--
-- Public profile images normally live in configured S3-compatible object
-- storage. This table keeps image uploads functional and persistent when an
-- object store is temporarily unavailable or not configured. Profile rows
-- store only a short public URL, never a large base64 payload.

BEGIN;

CREATE TABLE IF NOT EXISTS business_media_assets (
  id            UUID PRIMARY KEY,
  business_id   INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  kind          VARCHAR(20) NOT NULL,
  content_type  VARCHAR(100) NOT NULL,
  content       BYTEA NOT NULL,
  size_bytes    INTEGER NOT NULL,
  sha256        VARCHAR(64) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT business_media_assets_kind_check CHECK (kind IN ('logo', 'cover')),
  CONSTRAINT business_media_assets_size_check CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  UNIQUE (business_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_business_media_assets_business
  ON business_media_assets(business_id);

COMMIT;
