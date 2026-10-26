-- D21 Amazon Associates wiring.
--
-- An Amazon offer is an ordinary affiliate_product offer whose partner has
-- network 'amazon_associates'. This table pins the offer to one ASIN on one
-- Amazon marketplace host so the refresh job can re-read price and
-- availability through the Product Advertising API. Amazon's terms require
-- displayed product data to be at most 24 hours old: delivery and the
-- redirect refuse an Amazon offer whose item is unavailable or stale.
CREATE TABLE IF NOT EXISTS amazon_offer_items (
  offer_id BIGINT PRIMARY KEY REFERENCES offers(id) ON DELETE CASCADE,
  asin TEXT NOT NULL CHECK (asin ~ '^[A-Z0-9]{10}$'),
  marketplace_host TEXT NOT NULL,
  title TEXT,
  price_minor BIGINT CHECK (price_minor IS NULL OR price_minor >= 0),
  currency CHAR(3),
  available BOOLEAN NOT NULL DEFAULT FALSE,
  unavailable_reason TEXT,
  last_refreshed_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS amazon_offer_items_refresh_idx
  ON amazon_offer_items (last_refreshed_at NULLS FIRST);
-- Tracking tags identify a campaign in Amazon's reports. New campaigns are
-- refused a tag another campaign already uses (application check); report
-- rows whose tag maps to more than one historical campaign stay unmapped
-- rather than being guessed. Non-unique so existing data can never block
-- this migration.
CREATE INDEX IF NOT EXISTS offer_campaigns_amazon_tracking_tag_idx
  ON offer_campaigns (amazon_tracking_tag) WHERE amazon_tracking_tag IS NOT NULL;
