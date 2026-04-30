-- Migration 146: Legal Document Sections
-- Break documents into searchable, versionable sections
-- Enables section-level edits, diffs, and change tracking

CREATE TABLE IF NOT EXISTS legal_document_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES legal_documents(id) ON DELETE CASCADE,

  -- Section metadata
  section_key VARCHAR(100) NOT NULL,  -- 'helper_liability', 'payment_terms', 'data_retention', etc.
  title VARCHAR(255) NOT NULL,
  description TEXT,

  -- Content
  content TEXT NOT NULL,
  content_html TEXT,  -- For rich formatting (markdown converted to HTML)

  -- Organization
  section_order INT DEFAULT 0,  -- Order on /terms page
  is_collapsible BOOLEAN DEFAULT FALSE,  -- Can user collapse this section

  -- Configuration
  requires_explicit_acceptance BOOLEAN DEFAULT FALSE,  -- Force checkbox for this section
  is_critical BOOLEAN DEFAULT FALSE,  -- Changes trigger email notification
  affects_transactions BOOLEAN DEFAULT FALSE,  -- Affects existing transactions

  -- Audit trail
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),

  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMP DEFAULT NOW(),

  CONSTRAINT unique_section_per_doc UNIQUE(document_id, section_key)
);

CREATE INDEX idx_legal_document_sections_document_id ON legal_document_sections(document_id);
CREATE INDEX idx_legal_document_sections_section_key ON legal_document_sections(document_id, section_key);
CREATE INDEX idx_legal_document_sections_order ON legal_document_sections(document_id, section_order);

-- Track changes to individual sections
CREATE TABLE IF NOT EXISTS legal_section_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id UUID NOT NULL REFERENCES legal_document_sections(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES legal_documents(id) ON DELETE CASCADE,

  -- Version details
  version_number INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  content_html TEXT,

  -- What changed
  change_summary TEXT,
  diff_html TEXT,  -- HTML showing before/after with highlights

  -- Publication status
  status VARCHAR(20) NOT NULL,
  effective_date TIMESTAMP,

  -- Audit
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),

  published_by UUID REFERENCES users(id),
  published_at TIMESTAMP,

  CONSTRAINT unique_section_version UNIQUE(section_id, version_number),
  CONSTRAINT valid_section_status CHECK (status IN ('draft', 'pending_review', 'scheduled', 'live', 'archived'))
);

CREATE INDEX idx_legal_section_versions_section_id ON legal_section_versions(section_id);
CREATE INDEX idx_legal_section_versions_document_id ON legal_section_versions(document_id);
CREATE INDEX idx_legal_section_versions_published_at ON legal_section_versions(published_at);

-- Approval workflow tracking
CREATE TABLE IF NOT EXISTS legal_document_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES legal_documents(id) ON DELETE CASCADE,

  -- Who requested approval
  requested_by UUID NOT NULL REFERENCES users(id),
  requested_at TIMESTAMP DEFAULT NOW(),

  -- What changed
  change_summary TEXT,
  changed_sections VARCHAR(100)[],

  -- Approval process
  status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- 'pending', 'approved', 'rejected', 'revisions_requested'
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMP,
  review_comments TEXT,

  -- If approved, when should it go live
  scheduled_publish_date TIMESTAMP,

  CONSTRAINT valid_approval_status CHECK (status IN ('pending', 'approved', 'rejected', 'revisions_requested'))
);

CREATE INDEX idx_legal_document_approvals_document_id ON legal_document_approvals(document_id);
CREATE INDEX idx_legal_document_approvals_status ON legal_document_approvals(status);
CREATE INDEX idx_legal_document_approvals_requested_at ON legal_document_approvals(requested_at);

-- Track when documents were sent to users
CREATE TABLE IF NOT EXISTS legal_change_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES legal_documents(id) ON DELETE CASCADE,

  -- Notification details
  notification_type VARCHAR(50) NOT NULL,  -- 'update_notification', 'reacceptance_required', 'critical_change'
  subject_line VARCHAR(255),
  email_body TEXT,

  -- Distribution
  sent_at TIMESTAMP,
  recipients_count INT DEFAULT 0,
  delivered_count INT DEFAULT 0,
  failed_count INT DEFAULT 0,

  -- Configuration
  send_to_segment VARCHAR(50),  -- 'all_users', 'helpers_only', 'customers_only', 'new_users_after_date'
  requires_user_action BOOLEAN DEFAULT FALSE,

  -- Audit
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),

  CONSTRAINT valid_notification_type CHECK (notification_type IN ('update_notification', 'reacceptance_required', 'critical_change'))
);

CREATE INDEX idx_legal_change_notifications_document_id ON legal_change_notifications(document_id);
CREATE INDEX idx_legal_change_notifications_sent_at ON legal_change_notifications(sent_at);

-- Track notification delivery (per-user)
CREATE TABLE IF NOT EXISTS legal_notification_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id UUID NOT NULL REFERENCES legal_change_notifications(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Delivery status
  sent_at TIMESTAMP,
  delivered_at TIMESTAMP,
  opened_at TIMESTAMP,
  clicked_at TIMESTAMP,
  failed_reason TEXT,

  -- User action
  user_accepted_at TIMESTAMP,
  user_dismissed_at TIMESTAMP,

  CONSTRAINT unique_notification_per_user UNIQUE(notification_id, user_id)
);

CREATE INDEX idx_legal_notification_tracking_notification_id ON legal_notification_tracking(notification_id);
CREATE INDEX idx_legal_notification_tracking_user_id ON legal_notification_tracking(user_id);
CREATE INDEX idx_legal_notification_tracking_delivered_at ON legal_notification_tracking(delivered_at);
