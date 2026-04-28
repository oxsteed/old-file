-- Phase 5: Create moderation_queue table for admin review management

BEGIN;

CREATE TABLE IF NOT EXISTS moderation_queue (
  id SERIAL PRIMARY KEY,
  type VARCHAR(50) NOT NULL, -- 'review_flag', 'user_report', 'content_flag'
  target_id TEXT NOT NULL,
  target_type VARCHAR(50) NOT NULL, -- 'review', 'user', 'job'
  reported_by UUID REFERENCES users(id),
  reason TEXT NOT NULL,
  status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'reviewed', 'resolved', 'dismissed'
  assigned_to UUID REFERENCES users(id) NULL,
  resolution TEXT NULL,
  resolved_by UUID REFERENCES users(id) NULL,
  resolved_at TIMESTAMPTZ NULL,
  priority VARCHAR(10) DEFAULT 'normal', -- 'low', 'normal', 'high', 'urgent'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_moderation_status ON moderation_queue(status);
CREATE INDEX IF NOT EXISTS idx_moderation_type ON moderation_queue(type);
CREATE INDEX IF NOT EXISTS idx_moderation_priority ON moderation_queue(priority);

-- Admin activity log for audit trail
CREATE TABLE IF NOT EXISTS admin_activity_log (
  id SERIAL PRIMARY KEY,
  admin_id UUID REFERENCES users(id) NOT NULL,
  action VARCHAR(100) NOT NULL,
  target_type VARCHAR(50) NOT NULL,
  target_id TEXT NOT NULL,
  details JSONB NULL,
  ip_address VARCHAR(45) NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMIT;
