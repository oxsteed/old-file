-- Migration 163: CCPA Data Request Management
-- Tracks user data access, deletion, and opt-out requests per CCPA regulations
-- Includes 45-day response deadline, admin notes, and fulfillment tracking

DO $$
BEGIN
  -- Create ccpa_data_requests table if not exists
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ccpa_data_requests') THEN
    CREATE TABLE ccpa_data_requests (
      id BIGSERIAL PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      request_type VARCHAR(20) NOT NULL CHECK (request_type IN ('access', 'deletion', 'opt_out')),
      email VARCHAR(255) NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'awaiting_user', 'completed', 'expired', 'denied')),
      submitted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      due_at TIMESTAMP WITH TIME ZONE NOT NULL,
      completed_at TIMESTAMP WITH TIME ZONE,
      fulfilled_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
      admin_notes TEXT,
      fulfillment_date TIMESTAMP WITH TIME ZONE,
      data_provided JSONB DEFAULT '{}',
      denial_reason VARCHAR(500),
      request_notes TEXT,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- Create indexes for efficient queries
    CREATE INDEX idx_ccpa_user_id ON ccpa_data_requests(user_id);
    CREATE INDEX idx_ccpa_status ON ccpa_data_requests(status);
    CREATE INDEX idx_ccpa_due_at ON ccpa_data_requests(due_at);
    CREATE INDEX idx_ccpa_submitted_at ON ccpa_data_requests(submitted_at);
    CREATE INDEX idx_ccpa_request_type ON ccpa_data_requests(request_type);
    CREATE INDEX idx_ccpa_email ON ccpa_data_requests(email);
    CREATE INDEX idx_ccpa_user_type ON ccpa_data_requests(user_id, request_type);

    RAISE NOTICE 'Created ccpa_data_requests table with 7 indexes';
  ELSE
    RAISE NOTICE 'ccpa_data_requests table already exists';
  END IF;
END $$;
