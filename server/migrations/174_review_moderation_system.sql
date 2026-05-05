-- Migration 174: Review Moderation & Reporting System
-- Allows users to report reviews and admins to moderate/remove them

CREATE TABLE IF NOT EXISTS review_reports (
  id BIGSERIAL PRIMARY KEY,
  review_id UUID NOT NULL REFERENCES product_reviews(id) ON DELETE CASCADE,
  reported_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Report details
  reason VARCHAR(50) NOT NULL, -- false_review, inappropriate_language, spam, off_topic, unrelated_to_product, harassment
  description TEXT,

  -- Status
  status VARCHAR(20) DEFAULT 'open', -- open, under_review, resolved, dismissed

  -- Admin review
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  admin_notes TEXT,
  resolution_action VARCHAR(50), -- removed, hidden, warned_reviewer, no_action

  -- Timestamps
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Track review moderation history
CREATE TABLE IF NOT EXISTS review_moderation_log (
  id BIGSERIAL PRIMARY KEY,
  review_id UUID NOT NULL REFERENCES product_reviews(id) ON DELETE CASCADE,
  action VARCHAR(50) NOT NULL, -- hidden, removed, warning_issued, flagged
  reason TEXT,
  performed_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add columns to product_reviews for moderation tracking
ALTER TABLE product_reviews
ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS is_removed BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS moderation_reason VARCHAR(255),
ADD COLUMN IF NOT EXISTS report_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ;

-- Indexes for query performance
CREATE INDEX IF NOT EXISTS idx_review_reports_review ON review_reports(review_id);
CREATE INDEX IF NOT EXISTS idx_review_reports_reporter ON review_reports(reported_by);
CREATE INDEX IF NOT EXISTS idx_review_reports_status ON review_reports(status) WHERE status IN ('open', 'under_review');
CREATE INDEX IF NOT EXISTS idx_review_reports_submitted ON review_reports(submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_moderation_log_review ON review_moderation_log(review_id);
CREATE INDEX IF NOT EXISTS idx_review_moderation_log_created ON review_moderation_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_reviews_hidden ON product_reviews(is_hidden) WHERE is_hidden = true;
CREATE INDEX IF NOT EXISTS idx_product_reviews_removed ON product_reviews(is_removed) WHERE is_removed = true;
