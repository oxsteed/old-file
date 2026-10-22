-- Background-jobs audit (findings G1/G2): partner feed price-sanity
-- quarantine. Items whose feed price moved more than
-- PARTNER_FEED_PRICE_RATIO (default 5x) versus the live catalog price, or
-- that arrive at <= 0, are quarantined instead of overwriting live prices.
-- The quarantine list is stored on the run for admin review; an admin
-- applies it explicitly via POST /partners/feeds/:id/quarantine/apply.
ALTER TABLE partner_feed_runs
  ADD COLUMN IF NOT EXISTS rows_quarantined INTEGER NOT NULL DEFAULT 0;
ALTER TABLE partner_feed_runs
  ADD COLUMN IF NOT EXISTS quarantine_report JSONB NOT NULL DEFAULT '[]'::jsonb;
