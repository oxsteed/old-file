-- Migration 940: partner feed operations, conversion adjustments and offer
-- card feedback (Demand & Sales Engine, track 5 completion).
-- Additive only. Applied migrations 916-935 are untouched.
--
-- Why each change exists:
-- * partner_feeds.schedule_hours / last_error: the nightly import needs a
--   per-feed cadence and a durable place to surface the last failure.
-- * partner_feed_runs: "items missing for 2 consecutive runs" (spec 13.3)
--   needs an auditable run history, not just last_run_at.
-- * marketplace_products.feed_absent_runs: per-item absence counter driving
--   the two-absent-runs availability rule.
-- * affiliate_conversions.assisted / assisted_helper_id: spec 13.1 requires
--   helper-assisted sales to be recorded as assisted only, never counted as
--   engine conversions.
-- * affiliate_conversions.fraud_flags + 'flagged' status: postback sanity
--   checks (spec 13.1, affiliateAntiFraudService patterns) hold suspicious
--   conversions out of the payable pipeline for finance review.
-- * offer_feedback_events: in-app offer card impressions (>= 1s visible) and
--   "Not relevant" / "Too many offers" feedback (spec 16.1).

ALTER TABLE partner_feeds
  ADD COLUMN IF NOT EXISTS schedule_hours INTEGER NOT NULL DEFAULT 24
    CHECK (schedule_hours BETWEEN 1 AND 168),
  ADD COLUMN IF NOT EXISTS last_error TEXT;

CREATE TABLE IF NOT EXISTS partner_feed_runs (
  id BIGSERIAL PRIMARY KEY,
  feed_id INTEGER NOT NULL REFERENCES partner_feeds(id),
  partner_id INTEGER NOT NULL REFERENCES affiliate_partners(id),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'succeeded', 'failed')),
  rows_seen INTEGER NOT NULL DEFAULT 0,
  rows_upserted INTEGER NOT NULL DEFAULT 0,
  rows_deactivated INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
CREATE INDEX IF NOT EXISTS partner_feed_runs_feed_idx
  ON partner_feed_runs(feed_id, started_at DESC);

ALTER TABLE marketplace_products
  ADD COLUMN IF NOT EXISTS feed_absent_runs INTEGER NOT NULL DEFAULT 0;

ALTER TABLE affiliate_conversions
  ADD COLUMN IF NOT EXISTS assisted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS assisted_helper_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS fraud_flags JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Widen the conversion status check to admit the fraud hold state. The
-- constraint name is looked up dynamically because it was created inline.
DO $$
DECLARE
  cname TEXT;
BEGIN
  SELECT con.conname INTO cname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'affiliate_conversions'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) LIKE '%''pending''%''approved''%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE affiliate_conversions DROP CONSTRAINT %I', cname);
  END IF;
  ALTER TABLE affiliate_conversions
    ADD CONSTRAINT affiliate_conversions_status_check
    CHECK (status IN ('pending', 'approved', 'reversed', 'paid', 'flagged'));
END $$;

CREATE TABLE IF NOT EXISTS offer_feedback_events (
  id BIGSERIAL PRIMARY KEY,
  delivery_id BIGINT NOT NULL REFERENCES offer_campaign_deliveries(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('impression', 'feedback')),
  reason TEXT CHECK (reason IN ('not_relevant', 'too_many')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS offer_feedback_events_delivery_idx
  ON offer_feedback_events(delivery_id, kind, created_at DESC);
