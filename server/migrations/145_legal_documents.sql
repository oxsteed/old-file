-- Migration 145: Legal Documents System
-- Core table for managing legal documents (T&C, Privacy Policy, etc.)

CREATE TABLE IF NOT EXISTS legal_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Document metadata
  category VARCHAR(50) NOT NULL,  -- 'terms_of_service', 'privacy_policy', 'helper_agreement', 'seller_agreement', etc.
  title VARCHAR(255) NOT NULL,
  description TEXT,

  -- Content & versioning
  current_version INT DEFAULT 1,
  current_content TEXT NOT NULL,  -- Latest published version

  -- Status workflow
  status VARCHAR(20) NOT NULL DEFAULT 'draft',  -- 'draft', 'pending_review', 'scheduled', 'live', 'archived'
  effective_date TIMESTAMP,  -- When this version becomes binding
  archived_at TIMESTAMP,  -- When document was archived

  -- Configuration
  requires_reacceptance BOOLEAN DEFAULT FALSE,  -- Force users to re-accept on change
  is_critical BOOLEAN DEFAULT FALSE,  -- Critical changes trigger email notification
  notify_users BOOLEAN DEFAULT FALSE,  -- Whether to email users on publish
  grandfather_existing BOOLEAN DEFAULT TRUE,  -- Don't retroactively apply to old users

  -- Multilingual support
  languages VARCHAR(20)[] DEFAULT ARRAY['en'],  -- Supported languages
  default_language VARCHAR(10) DEFAULT 'en',

  -- Audit trail
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),

  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMP DEFAULT NOW(),

  published_by UUID REFERENCES users(id),
  published_at TIMESTAMP,

  -- Approval workflow
  awaiting_review_since TIMESTAMP,
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMP,
  review_notes TEXT,

  CONSTRAINT valid_category CHECK (category IN ('terms_of_service', 'privacy_policy', 'helper_agreement', 'seller_agreement', 'payment_terms', 'dispute_resolution', 'data_retention', 'background_check_policy', 'fcra_compliance', 'incident_response', 'accessibility_policy')),
  CONSTRAINT valid_status CHECK (status IN ('draft', 'pending_review', 'scheduled', 'live', 'archived'))
);

-- Indexes for common queries
CREATE INDEX idx_legal_documents_category_status ON legal_documents(category, status);
CREATE INDEX idx_legal_documents_effective_date ON legal_documents(effective_date);
CREATE INDEX idx_legal_documents_created_by ON legal_documents(created_by);
CREATE INDEX idx_legal_documents_language ON legal_documents USING GIN(languages);

-- Track document changes in version history
CREATE TABLE IF NOT EXISTS legal_document_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES legal_documents(id) ON DELETE CASCADE,

  -- Version details
  version_number INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,

  -- Change metadata
  change_summary TEXT,  -- What changed in this version
  changed_sections VARCHAR(100)[],  -- Which sections were modified

  -- Status when this version was published
  status VARCHAR(20) NOT NULL,
  effective_date TIMESTAMP,

  -- Audit trail
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),

  published_by UUID REFERENCES users(id),
  published_at TIMESTAMP,

  CONSTRAINT valid_version_status CHECK (status IN ('draft', 'pending_review', 'scheduled', 'live', 'archived')),
  CONSTRAINT unique_version_per_doc UNIQUE(document_id, version_number)
);

CREATE INDEX idx_legal_document_versions_document_id ON legal_document_versions(document_id);
CREATE INDEX idx_legal_document_versions_published_at ON legal_document_versions(published_at);

-- User acceptance tracking
CREATE TABLE IF NOT EXISTS user_legal_acceptances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES legal_documents(id),
  version_number INT NOT NULL,

  -- Acceptance details
  accepted_at TIMESTAMP DEFAULT NOW(),
  ip_address VARCHAR(45),  -- Hashed for privacy
  user_agent TEXT,

  -- Electronic signature (per SEC rules)
  signature_first_name VARCHAR(100),
  signature_last_name VARCHAR(100),
  signature_timestamp TIMESTAMP,

  -- Legal hold (compliance)
  cannot_delete_until TIMESTAMP,  -- For compliance holds

  CONSTRAINT unique_user_version_acceptance UNIQUE(user_id, document_id, version_number)
);

CREATE INDEX idx_user_legal_acceptances_user_id ON user_legal_acceptances(user_id);
CREATE INDEX idx_user_legal_acceptances_document_id ON user_legal_acceptances(document_id);
CREATE INDEX idx_user_legal_acceptances_accepted_at ON user_legal_acceptances(accepted_at);

-- Latest acceptance per user per document (denormalized for performance)
CREATE TABLE IF NOT EXISTS user_legal_acceptances_latest (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES legal_documents(id),
  version_number INT NOT NULL,
  accepted_at TIMESTAMP,

  PRIMARY KEY (user_id, document_id),
  FOREIGN KEY (user_id, document_id, version_number) REFERENCES user_legal_acceptances(user_id, document_id, version_number)
);

CREATE INDEX idx_user_legal_acceptances_latest_document ON user_legal_acceptances_latest(document_id);
