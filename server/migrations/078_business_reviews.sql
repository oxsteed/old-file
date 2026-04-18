-- ── Phase 6: Business Reviews & Testimonials System ───────────────────────────
-- Enables customers to leave reviews on completed jobs, building social proof
-- and providing feedback to businesses.

-- ── 1. business_reviews table ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_reviews (
  id                BIGSERIAL       PRIMARY KEY,
  business_id       INTEGER         NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id       BIGINT          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lead_id           BIGINT          REFERENCES business_leads(id) ON DELETE SET NULL,  -- Which lead/job this review is for
  rating            SMALLINT        NOT NULL CHECK (rating >= 1 AND rating <= 5),      -- Star rating 1-5
  testimonial       TEXT            NOT NULL,                                         -- Written review (up to 500 chars, validated on client)
  response          TEXT,                                                             -- Optional business response
  created_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ     NOT NULL DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_business_reviews_business_id ON business_reviews(business_id);
CREATE INDEX IF NOT EXISTS idx_business_reviews_customer_id ON business_reviews(customer_id);
CREATE INDEX IF NOT EXISTS idx_business_reviews_lead_id ON business_reviews(lead_id);
CREATE INDEX IF NOT EXISTS idx_business_reviews_rating ON business_reviews(rating);
CREATE INDEX IF NOT EXISTS idx_business_reviews_created_at ON business_reviews(created_at DESC);

-- Partial index: only show published/approved reviews (when moderation is added later)
CREATE INDEX IF NOT EXISTS idx_business_reviews_active ON business_reviews(business_id, created_at DESC);

-- Unique constraint: one review per customer per lead (prevent duplicate reviews)
CREATE UNIQUE INDEX IF NOT EXISTS idx_business_reviews_unique_customer_lead
  ON business_reviews(customer_id, lead_id)
  WHERE lead_id IS NOT NULL;

-- ── 2. Helper function to recalculate review stats (avg rating, count) ──────────
-- Called after a new review is inserted or updated
CREATE OR REPLACE FUNCTION recalculate_business_review_stats(business_id_param INTEGER)
RETURNS TABLE(avg_rating NUMERIC, review_count BIGINT) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ROUND(AVG(rating)::NUMERIC, 2) as avg_rating,
    COUNT(*)::BIGINT as review_count
  FROM business_reviews
  WHERE business_id = business_id_param;
END;
$$ LANGUAGE plpgsql;

-- ── 3. Trigger to update updated_at on review changes ────────────────────────
CREATE OR REPLACE FUNCTION update_business_review_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_business_review_timestamp ON business_reviews;
CREATE TRIGGER trigger_business_review_timestamp
BEFORE UPDATE ON business_reviews
FOR EACH ROW
EXECUTE FUNCTION update_business_review_timestamp();
