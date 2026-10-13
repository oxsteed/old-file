BEGIN;

-- 820: Polymorphic review reporting (P2-8-F18, P2-8-F19).
-- review_reports / review_moderation_log were product-review-only
-- (review_id UUID FK to product_reviews). Business and food reviews have
-- BIGINT ids in their own tables, so reporting them needs a discriminator
-- plus per-type nullable reference columns.

-- ── review_reports ──────────────────────────────────────────────
ALTER TABLE review_reports
  ADD COLUMN IF NOT EXISTS review_type VARCHAR(20) NOT NULL DEFAULT 'product';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_review_reports_type') THEN
    ALTER TABLE review_reports
      ADD CONSTRAINT chk_review_reports_type
      CHECK (review_type IN ('product', 'business', 'food'));
  END IF;
END $$;

ALTER TABLE review_reports
  ADD COLUMN IF NOT EXISTS business_review_id BIGINT
    REFERENCES business_reviews(id) ON DELETE CASCADE;
ALTER TABLE review_reports
  ADD COLUMN IF NOT EXISTS food_review_id BIGINT
    REFERENCES food_reviews(id) ON DELETE CASCADE;

-- review_id stays the product-review reference; it is nullable now so a
-- single report row references exactly one review of its declared type.
ALTER TABLE review_reports ALTER COLUMN review_id DROP NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_review_reports_single_target') THEN
    ALTER TABLE review_reports
      ADD CONSTRAINT chk_review_reports_single_target
      CHECK (num_nonnulls(review_id, business_review_id, food_review_id) = 1);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_review_reports_type
  ON review_reports(review_type);
CREATE INDEX IF NOT EXISTS idx_review_reports_business_review
  ON review_reports(business_review_id) WHERE business_review_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_review_reports_food_review
  ON review_reports(food_review_id) WHERE food_review_id IS NOT NULL;

-- ── review_moderation_log ───────────────────────────────────────
ALTER TABLE review_moderation_log
  ADD COLUMN IF NOT EXISTS review_type VARCHAR(20) NOT NULL DEFAULT 'product';
ALTER TABLE review_moderation_log
  ADD COLUMN IF NOT EXISTS business_review_id BIGINT
    REFERENCES business_reviews(id) ON DELETE CASCADE;
ALTER TABLE review_moderation_log
  ADD COLUMN IF NOT EXISTS food_review_id BIGINT
    REFERENCES food_reviews(id) ON DELETE CASCADE;
ALTER TABLE review_moderation_log ALTER COLUMN review_id DROP NOT NULL;

-- ── business_reviews: moderation + owner-response support ───────
-- is_hidden / report_count give admins a working hide path for reported
-- business reviews (P2-8-F18). response already exists (migration 078).
ALTER TABLE business_reviews
  ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE business_reviews
  ADD COLUMN IF NOT EXISTS report_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE business_reviews
  ADD COLUMN IF NOT EXISTS moderation_reason VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_business_reviews_hidden
  ON business_reviews(business_id) WHERE is_hidden = TRUE;

-- ── food_reviews: respond / dispute support (P2-8-F19) ──────────
ALTER TABLE food_reviews
  ADD COLUMN IF NOT EXISTS response TEXT;
ALTER TABLE food_reviews
  ADD COLUMN IF NOT EXISTS responded_at TIMESTAMPTZ;
ALTER TABLE food_reviews
  ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE food_reviews
  ADD COLUMN IF NOT EXISTS report_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE food_reviews
  ADD COLUMN IF NOT EXISTS moderation_reason VARCHAR(255);

COMMIT;
