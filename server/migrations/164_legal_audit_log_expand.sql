-- Migration 164: Legal Audit Log (Expanded)
-- Tracks all legal document and CCPA actions for compliance audit trails
-- Includes action type, actor ID, resource tracking, and metadata

DO $$
BEGIN
  -- Create or update legal_audit_log table
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'legal_audit_log') THEN
    CREATE TABLE legal_audit_log (
      id BIGSERIAL PRIMARY KEY,
      action_type VARCHAR(50) NOT NULL,
      document_type VARCHAR(100),
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      actor_role VARCHAR(50),
      resource_id VARCHAR(255),
      resource_type VARCHAR(50),
      status VARCHAR(30),
      ip_address INET,
      user_agent TEXT,
      metadata JSONB,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- Create indexes for efficient audit log queries
    CREATE INDEX idx_legal_audit_action_type ON legal_audit_log(action_type);
    CREATE INDEX idx_legal_audit_resource_id ON legal_audit_log(resource_id);
    CREATE INDEX idx_legal_audit_created_at ON legal_audit_log(created_at DESC);
    CREATE INDEX idx_legal_audit_actor_id ON legal_audit_log(actor_id);
    CREATE INDEX idx_legal_audit_user_id ON legal_audit_log(user_id);
    CREATE INDEX idx_legal_audit_action_user ON legal_audit_log(action_type, user_id);

    RAISE NOTICE 'Created legal_audit_log table with 6 indexes';
  ELSE
    RAISE NOTICE 'legal_audit_log table already exists';
  END IF;
END $$;
