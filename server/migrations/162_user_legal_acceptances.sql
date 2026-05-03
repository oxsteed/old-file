-- Migration 162: User Legal Acceptances Tracking
-- Tracks when users accept legal documents (T&C, contractor agreements, dispute policies, etc.)
-- Used for compliance and audit purposes

DO $$
BEGIN
  -- Create user_legal_acceptances table if not exists
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_legal_acceptances') THEN
    CREATE TABLE user_legal_acceptances (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      document_type VARCHAR(100) NOT NULL,
      version_number INT NOT NULL,
      first_name VARCHAR(255) NOT NULL,
      last_name VARCHAR(255) NOT NULL,
      ip_address VARCHAR(45),
      user_agent TEXT,
      accepted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    -- Create indexes for efficient lookups
    CREATE INDEX idx_user_legal_acceptances_user_id
      ON user_legal_acceptances(user_id);

    CREATE INDEX idx_user_legal_acceptances_document_type
      ON user_legal_acceptances(document_type);

    CREATE INDEX idx_user_legal_acceptances_accepted_at
      ON user_legal_acceptances(accepted_at);

    CREATE INDEX idx_user_legal_acceptances_document_user
      ON user_legal_acceptances(document_type, user_id);

    RAISE NOTICE 'Created user_legal_acceptances table';
  ELSE
    RAISE NOTICE 'user_legal_acceptances table already exists';
  END IF;
END $$;
