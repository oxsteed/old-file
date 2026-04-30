-- Migration 148: Legal Document Audit Log
-- Complete audit trail for compliance and dispute resolution

CREATE TABLE IF NOT EXISTS legal_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What changed
  action_type VARCHAR(50) NOT NULL,  -- 'document_created', 'section_edited', 'version_published', 'user_accepted', 'approval_requested', etc.
  resource_type VARCHAR(50) NOT NULL,  -- 'document', 'section', 'version', 'acceptance', 'approval'
  resource_id UUID,

  -- Details
  document_id UUID REFERENCES legal_documents(id),
  section_id UUID REFERENCES legal_document_sections(id),
  user_id UUID REFERENCES users(id),

  -- What changed
  old_values JSONB,  -- Previous values
  new_values JSONB,  -- New values
  change_description TEXT,

  -- Context
  ip_address VARCHAR(45),
  user_agent TEXT,
  session_id VARCHAR(255),

  -- Timestamp
  created_at TIMESTAMP DEFAULT NOW(),

  CONSTRAINT valid_action_type CHECK (action_type IN (
    'document_created',
    'document_updated',
    'document_published',
    'document_archived',
    'section_created',
    'section_updated',
    'section_deleted',
    'version_created',
    'version_published',
    'version_archived',
    'user_accepted',
    'user_reaccepted',
    'approval_requested',
    'approval_approved',
    'approval_rejected',
    'approval_revisions_requested',
    'translation_created',
    'translation_reviewed',
    'translation_published',
    'notification_sent',
    'notification_opened',
    'notification_clicked',
    'rollback_performed',
    'diff_viewed'
  )),

  CONSTRAINT valid_resource_type CHECK (resource_type IN (
    'document',
    'section',
    'version',
    'acceptance',
    'approval',
    'translation',
    'notification'
  ))
);

CREATE INDEX idx_legal_audit_log_document_id ON legal_audit_log(document_id);
CREATE INDEX idx_legal_audit_log_user_id ON legal_audit_log(user_id);
CREATE INDEX idx_legal_audit_log_action_type ON legal_audit_log(action_type);
CREATE INDEX idx_legal_audit_log_created_at ON legal_audit_log(created_at);
CREATE INDEX idx_legal_audit_log_resource ON legal_audit_log(resource_type, resource_id);

-- Search index for compliance queries
CREATE INDEX idx_legal_audit_log_search ON legal_audit_log USING GIN(new_values);

-- Jurisdiction-specific legal holds (for disputes)
CREATE TABLE IF NOT EXISTS legal_compliance_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES legal_documents(id) ON DELETE CASCADE,

  -- Hold details
  hold_reason VARCHAR(100) NOT NULL,  -- 'litigation', 'regulatory_review', 'dispute_resolution', 'policy_review'
  held_until TIMESTAMP NOT NULL,
  description TEXT,

  -- Who placed the hold
  placed_by UUID NOT NULL REFERENCES users(id),
  placed_at TIMESTAMP DEFAULT NOW(),

  -- Notification
  notify_admins BOOLEAN DEFAULT TRUE,

  CONSTRAINT valid_hold_reason CHECK (hold_reason IN (
    'litigation',
    'regulatory_review',
    'dispute_resolution',
    'policy_review'
  ))
);

CREATE INDEX idx_legal_compliance_holds_document_id ON legal_compliance_holds(document_id);
CREATE INDEX idx_legal_compliance_holds_held_until ON legal_compliance_holds(held_until);

-- Dispute resolution tracking
CREATE TABLE IF NOT EXISTS legal_dispute_references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Document version in dispute
  document_id UUID NOT NULL REFERENCES legal_documents(id),
  version_number INT NOT NULL,

  -- Dispute details
  dispute_id UUID NOT NULL,  -- Reference to dispute table
  dispute_reason VARCHAR(255),

  -- Resolution
  resolved_at TIMESTAMP,
  resolution_notes TEXT,

  -- Audit
  created_at TIMESTAMP DEFAULT NOW(),
  resolved_by UUID REFERENCES users(id)
);

CREATE INDEX idx_legal_dispute_references_document_id ON legal_dispute_references(document_id);
CREATE INDEX idx_legal_dispute_references_dispute_id ON legal_dispute_references(dispute_id);

-- Data retention & archival policy
CREATE TABLE IF NOT EXISTS legal_data_retention (
  document_id UUID PRIMARY KEY REFERENCES legal_documents(id) ON DELETE CASCADE,

  -- Retention policy
  retain_until TIMESTAMP,  -- When to archive
  archive_method VARCHAR(50) NOT NULL DEFAULT 'cold_storage',  -- 'cold_storage', 'delete', 'anonymize'

  -- Backup
  backup_location VARCHAR(255),  -- S3 path, etc.
  backup_created_at TIMESTAMP,

  -- Audit
  archived_at TIMESTAMP,
  archived_by UUID REFERENCES users(id),

  CONSTRAINT valid_archive_method CHECK (archive_method IN ('cold_storage', 'delete', 'anonymize'))
);

CREATE INDEX idx_legal_data_retention_retain_until ON legal_data_retention(retain_until);
