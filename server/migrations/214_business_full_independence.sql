-- Migration 214: Full business independence
--
-- Decouples businesses from their owner's helper_profile across four axes that
-- were still coupled after migrations 075 and 212:
--
--   1. Service area  - businesses.service_lat / service_lng
--   2. Reviews       - businesses keep their own avg_rating / total_reviews
--                      (populated from business_reviews via a trigger), plus
--                      business_reviews.helper_id so we can credit the helper
--                      who actually did the work
--   3. Bookings      - booking_requests.business_id so customers can book a
--                      business directly without choosing a specific helper
--   4. Payments      - businesses.stripe_account_id so each business can have
--                      its own Stripe Connect account
--
-- Backfill is conservative: existing rows are left alone unless we have a safe
-- value to copy in.

-- ─── 1. Service-area coords on businesses ────────────────────────────────────
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS service_lat DECIMAL(10,7),
  ADD COLUMN IF NOT EXISTS service_lng DECIMAL(10,7),
  ADD COLUMN IF NOT EXISTS service_city  VARCHAR(120),
  ADD COLUMN IF NOT EXISTS service_state VARCHAR(120);

-- Index for geo radius search (only when coords present)
CREATE INDEX IF NOT EXISTS idx_businesses_service_geo
  ON businesses(service_lat, service_lng)
  WHERE service_lat IS NOT NULL AND service_lng IS NOT NULL;

-- Backfill: copy from owner's helper_profile where the business has no geo yet
UPDATE businesses b
SET    service_lat = hp.service_lat,
       service_lng = hp.service_lng,
       service_city  = COALESCE(b.service_city,  hp.service_city),
       service_state = COALESCE(b.service_state, hp.service_state)
FROM   helper_profiles hp
WHERE  hp.user_id = b.user_id
  AND  b.service_lat IS NULL
  AND  hp.service_lat IS NOT NULL;

-- ─── 2. Own review aggregates + helper_id on business_reviews ────────────────
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS avg_rating           DECIMAL(3,2)  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_reviews        INTEGER       NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completed_jobs_count INTEGER       NOT NULL DEFAULT 0;

ALTER TABLE business_reviews
  ADD COLUMN IF NOT EXISTS helper_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS job_id    UUID REFERENCES jobs(id)  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_business_reviews_helper
  ON business_reviews(helper_id) WHERE helper_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_business_reviews_job
  ON business_reviews(job_id) WHERE job_id IS NOT NULL;

-- Function: refresh aggregate stats on businesses for a given business_id
CREATE OR REPLACE FUNCTION refresh_business_review_aggregates(p_business_id INTEGER)
RETURNS VOID AS $$
BEGIN
  UPDATE businesses
     SET avg_rating    = COALESCE((SELECT ROUND(AVG(rating)::numeric, 2) FROM business_reviews WHERE business_id = p_business_id), 0),
         total_reviews = COALESCE((SELECT COUNT(*)                              FROM business_reviews WHERE business_id = p_business_id), 0)
   WHERE id = p_business_id;
END;
$$ LANGUAGE plpgsql;

-- Trigger: keep aggregates in sync as reviews are inserted/updated/deleted
CREATE OR REPLACE FUNCTION trg_business_reviews_sync_aggregates()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    PERFORM refresh_business_review_aggregates(OLD.business_id);
    RETURN OLD;
  END IF;
  PERFORM refresh_business_review_aggregates(NEW.business_id);
  IF (TG_OP = 'UPDATE' AND OLD.business_id <> NEW.business_id) THEN
    PERFORM refresh_business_review_aggregates(OLD.business_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_business_reviews_aggregates ON business_reviews;
CREATE TRIGGER trg_business_reviews_aggregates
  AFTER INSERT OR UPDATE OR DELETE ON business_reviews
  FOR EACH ROW
  EXECUTE FUNCTION trg_business_reviews_sync_aggregates();

-- One-time backfill: compute aggregates for every existing business
UPDATE businesses b
SET    avg_rating    = sub.avg_rating,
       total_reviews = sub.total_reviews
FROM   (
  SELECT business_id,
         ROUND(AVG(rating)::numeric, 2) AS avg_rating,
         COUNT(*)                       AS total_reviews
  FROM   business_reviews
  GROUP  BY business_id
) sub
WHERE  b.id = sub.business_id;

-- ─── 3. Bookings can target a business ───────────────────────────────────────
-- booking_requests.business_id (nullable - personal helper bookings still work)
ALTER TABLE booking_requests
  ADD COLUMN IF NOT EXISTS business_id INTEGER
  REFERENCES businesses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_booking_requests_business
  ON booking_requests(business_id)
  WHERE business_id IS NOT NULL;

-- ─── 4. Per-business Stripe Connect ──────────────────────────────────────────
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS stripe_account_id   VARCHAR(255),
  ADD COLUMN IF NOT EXISTS stripe_charges_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS stripe_payouts_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS stripe_account_status  VARCHAR(40);  -- 'pending' | 'restricted' | 'active' | 'rejected'

CREATE UNIQUE INDEX IF NOT EXISTS idx_businesses_stripe_account
  ON businesses(stripe_account_id)
  WHERE stripe_account_id IS NOT NULL;

-- ─── 5. is_listed independence ───────────────────────────────────────────────
-- A business should be visible as long as `is_active = TRUE`. The current
-- public-profile query gates on `helper_profiles.is_listed` - we'll remove
-- that gate at the application layer in this same change. To future-proof,
-- mirror the helper-side flag onto businesses for owner control.
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS is_listed BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_businesses_listed
  ON businesses(is_listed) WHERE is_active = TRUE;

COMMENT ON COLUMN businesses.is_listed             IS 'Whether the business appears in public discovery. Independent of the owner''s helper_profiles.is_listed.';
COMMENT ON COLUMN businesses.stripe_account_id     IS 'Per-business Stripe Connect account. Independent of the owner''s personal Connect account.';
COMMENT ON COLUMN businesses.avg_rating            IS 'Average rating across business_reviews. Kept in sync by trg_business_reviews_aggregates.';
COMMENT ON COLUMN booking_requests.business_id     IS 'Optional FK so customers can book a business directly without choosing a specific helper.';
COMMENT ON COLUMN business_reviews.helper_id       IS 'Helper who actually performed the work being reviewed. Used to credit individual team members.';
