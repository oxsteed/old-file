BEGIN;

-- 830: Job-review reporting (P2-8-F18).
-- The polymorphic reporting from migration 820 covered product, business and
-- food reviews. Job reviews live in `reviews` (UUID ids, reviewer_id column),
-- so reporting them needs the same discriminator + reference-column treatment.
-- Moderation actions reuse the business/food convention (is_hidden +
-- moderation_reason); the legacy flagged/removed columns from migration 025
-- are unwritten and left untouched.

-- ── review_reports ──────────────────────────────────────────────
ALTER TABLE review_reports
  ADD COLUMN IF NOT EXISTS job_review_id UUID REFERENCES reviews(id) ON DELETE CASCADE;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_review_reports_type') THEN
    ALTER TABLE review_reports DROP CONSTRAINT chk_review_reports_type;
  END IF;
END $$;
ALTER TABLE review_reports
  ADD CONSTRAINT chk_review_reports_type
  CHECK (review_type IN ('product', 'business', 'food', 'job'));

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_review_reports_single_target') THEN
    ALTER TABLE review_reports DROP CONSTRAINT chk_review_reports_single_target;
  END IF;
END $$;
ALTER TABLE review_reports
  ADD CONSTRAINT chk_review_reports_single_target
  CHECK (num_nonnulls(review_id, business_review_id, food_review_id, job_review_id) = 1);

CREATE INDEX IF NOT EXISTS idx_review_reports_job_review
  ON review_reports(job_review_id) WHERE job_review_id IS NOT NULL;

-- ── review_moderation_log ───────────────────────────────────────
ALTER TABLE review_moderation_log
  ADD COLUMN IF NOT EXISTS job_review_id UUID REFERENCES reviews(id) ON DELETE CASCADE;

-- ── reviews: moderation support (mirrors 820's business/food columns) ──
ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS report_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS moderation_reason VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_reviews_hidden
  ON reviews(reviewee_id) WHERE is_hidden = TRUE;

COMMIT;
