-- Phase 4: Disputes table for conflict resolution
-- Supports dispute lifecycle between poster and helper

CREATE TABLE IF NOT EXISTS disputes (
  id SERIAL PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  payment_id INTEGER REFERENCES payments(id),
  raised_by UUID NOT NULL REFERENCES users(id),
  against_user UUID NOT NULL REFERENCES users(id),
  reason VARCHAR(100) NOT NULL,
  -- quality, no_show, incomplete, overcharge, damage, other
  description TEXT NOT NULL,
  evidence JSONB DEFAULT '[]',
  -- array of { type, url, description }
  status VARCHAR(30) NOT NULL DEFAULT 'open',
  -- open, under_review, resolved_poster, resolved_helper, escalated, closed
  resolution TEXT,
  resolution_type VARCHAR(30),
  -- refund_full, refund_partial, no_refund, mutual_agreement, admin_decision
  resolved_by UUID REFERENCES users(id),
  refund_amount NUMERIC(10, 2),
  admin_notes TEXT,
  opened_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Dispute messages for back-and-forth communication
CREATE TABLE IF NOT EXISTS dispute_messages (
  id SERIAL PRIMARY KEY,
  dispute_id INTEGER NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id),
  message TEXT NOT NULL,
  attachments JSONB DEFAULT '[]',
  is_admin BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_disputes_job_id ON disputes(job_id);
CREATE INDEX IF NOT EXISTS idx_disputes_raised_by ON disputes(raised_by);
CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status);
CREATE INDEX IF NOT EXISTS idx_disputes_payment_id ON disputes(payment_id);
CREATE INDEX IF NOT EXISTS idx_dispute_messages_dispute ON dispute_messages(dispute_id);
