-- D21: Amazon-specific campaign mapping and immutable report-import evidence.
ALTER TABLE offer_campaigns
  ADD COLUMN IF NOT EXISTS amazon_tracking_tag TEXT
    CHECK (amazon_tracking_tag IS NULL OR amazon_tracking_tag ~ '^[A-Za-z0-9-]{1,64}$');
CREATE TABLE IF NOT EXISTS amazon_associate_reports (
  id BIGSERIAL PRIMARY KEY,
  report_ref TEXT NOT NULL UNIQUE,
  content_sha256 CHAR(64) NOT NULL,
  row_count INTEGER NOT NULL CHECK (row_count >= 0),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb
);
